// Detección de degradación sostenida (Flujo A del E90; RF011, RF013, RF018, HU1, HU2).
//
// Cada semana, contra la línea base FIJA del nodo, se obtienen dos valores distintos:
//   - el déficit: cuánto se quedó por debajo de lo esperado, nunca negativo (RF013);
//   - el residuo: el desvío CON signo (desempeño − línea base).
// El residuo alimenta un CUSUM unilateral (hacia abajo) en su forma tabular (Montgomery, 2013):
//
//     S_t = max(0, S_{t-1} + (línea base − desempeño_t) − K)
//
// con K = el margen de la línea base (la distancia de la línea base al límite inferior de su banda de incertidumbre,
// RF012/RF016). Mientras el residuo se mantiene dentro del margen, S no crece (y se descuenta de a poco lo que se
// haya acumulado); cuando lo excede, suma. Si S supera el umbral h, se confirma que la degradación es sostenida y no
// ruido operativo, y S vuelve a cero para no avisar dos veces la misma disrupción. El umbral se expresa en múltiplos
// del margen (h·K) para que sirva a nodos con márgenes distintos, y se calibra aparte (`cusum-calibration.ts`, RF019
// y RF020).
//
// Todo es una función pura de las filas semanales ya guardadas: la detección corre sobre el lote de cada semana
// (RF011) y no hace falta guardar el estado (no es una entidad del modelo de datos).
import type { WeeklyPerformance } from "@/lib/domain/types";

/** Piso del margen, en días: una banda degenerada no debe volver al CUSUM infinitamente sensible. */
const MIN_MARGIN = 0.05;

/** Semanas que una alerta confirmada sigue visible como "alerta" antes de pasar a vigilancia o a normal. */
export const ALERT_HOLD_WEEKS = 4;

/** Fracción del umbral a partir de la cual se muestra "atención": la degradación se está acumulando. */
export const ATTENTION_FRACTION = 0.5;

export type CusumRow = Pick<WeeklyPerformance, "weekStart" | "actualValue" | "baseline" | "baselineLowerBand">;

export interface CusumWeek {
  weekStart: string;
  /** Déficit de la semana (nunca negativo). */
  deficit: number;
  /** Residuo con signo: desempeño − línea base. */
  residual: number;
  /** Acumulado S al cierre de la semana (ya reiniciado a 0 si se confirmó en ella). */
  accumulated: number;
  /** Umbral h·K vigente (en días). */
  threshold: number;
  confirmed: boolean;
}

/** Una degradación sostenida confirmada: desde cuándo se sostiene y cuánto déficit juntó (HU2). */
export interface SustainedEpisode {
  /** Primera semana de la racha que terminó confirmándose. */
  since: string;
  confirmedWeek: string;
  /** Semanas entre el comienzo del desvío y la confirmación, inclusive. */
  weeks: number;
  /** Déficit acumulado en la racha, en días. */
  accumulatedDeficit: number;
  /** Déficit semanal medio de la racha, en días. */
  meanDeficit: number;
}

export interface CusumRun {
  weeks: CusumWeek[];
  episodes: SustainedEpisode[];
  /** La racha abierta al final de la serie (todavía sin confirmar). `since` es null si no hay acumulación. */
  current: { since: string | null; accumulated: number; threshold: number; deficitSoFar: number; weeks: number };
}

/** El margen K de una fila: lo que la línea base se separa del límite inferior de su banda. */
export const marginOf = (row: Pick<CusumRow, "baseline" | "baselineLowerBand">) => Math.max(row.baseline - row.baselineLowerBand, MIN_MARGIN);

/** Corre el CUSUM sobre las filas de UN nodo, en cualquier orden. `h` es el umbral en múltiplos del margen. */
export function runCusum(rows: CusumRow[], h: number): CusumRun {
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const weeks: CusumWeek[] = [];
  const episodes: SustainedEpisode[] = [];

  let accumulated = 0;
  let since: string | null = null;
  let runDeficit = 0;
  let runWeeks = 0;
  let threshold = 0;

  for (const row of sorted) {
    const margin = marginOf(row);
    threshold = h * margin;
    const residual = row.actualValue - row.baseline;
    const deficit = Math.max(0, -residual);

    // S_t = max(0, S_{t-1} + (b − x_t) − K): el residuo se usa con signo, así una semana buena descuenta lo acumulado.
    const stepped = Math.max(0, accumulated + (row.baseline - row.actualValue) - margin);

    if (accumulated === 0 && stepped > 0) {
      // Empieza una racha: es el "desde cuándo" que informa la alerta.
      since = row.weekStart;
      runDeficit = 0;
      runWeeks = 0;
    }
    if (since !== null) {
      runDeficit += deficit;
      runWeeks += 1;
    }
    accumulated = stepped;

    let confirmed = false;
    if (since !== null && accumulated >= threshold) {
      confirmed = true;
      episodes.push({ since, confirmedWeek: row.weekStart, weeks: runWeeks, accumulatedDeficit: runDeficit, meanDeficit: runDeficit / runWeeks });
      // Se reinicia el acumulado: la semana siguiente no vuelve a confirmar una disrupción ya avisada.
      accumulated = 0;
      since = null;
      runDeficit = 0;
      runWeeks = 0;
    } else if (accumulated === 0) {
      since = null;
      runDeficit = 0;
      runWeeks = 0;
    }

    weeks.push({ weekStart: row.weekStart, deficit, residual, accumulated, threshold, confirmed });
  }

  return { weeks, episodes, current: { since, accumulated, threshold, deficitSoFar: runDeficit, weeks: runWeeks } };
}

export type DegradationLevel = "normal" | "atencion" | "alerta";

/**
 * Una alerta vigente: el período de degradación que el detector viene confirmando. Mientras el nodo sigue degradado el
 * CUSUM vuelve a confirmar cada pocas semanas (se reinicia al confirmar); acá esas confirmaciones consecutivas son UNA
 * sola alerta, que dice desde cuándo se sostiene el desvío (HU2) y cuánto déficit juntó en total.
 */
export interface ActiveAlert extends SustainedEpisode {
  /** Última semana en que se volvió a confirmar. */
  lastConfirmedWeek: string;
  /** Cuántas veces se confirmó en el período. */
  confirmations: number;
  /** La primera confirmación: es la detección, y de ahí sale la semana de decisión de una simulación (s_r = detección + 1). */
  first: SustainedEpisode;
}

export interface DegradationStatus {
  level: DegradationLevel;
  run: CusumRun;
  /** La alerta vigente (confirmada en las últimas ALERT_HOLD_WEEKS semanas), si hay una. */
  active: ActiveAlert | null;
}

/** Confirmaciones separadas por más de una semana sin acumulación son alertas distintas. */
const MERGE_GAP_WEEKS = 1;

function currentAlert(run: CusumRun): ActiveAlert | null {
  const index = new Map(run.weeks.map((w, i) => [w.weekStart, i]));
  const lastIndex = run.weeks.length - 1;
  const episodes = run.episodes;
  if (episodes.length === 0) return null;
  const latest = episodes[episodes.length - 1];
  if (lastIndex - (index.get(latest.confirmedWeek) ?? -Infinity) >= ALERT_HOLD_WEEKS) return null;

  // Hacia atrás, mientras cada racha empiece enseguida después de la confirmación anterior, es el mismo período.
  let first = episodes.length - 1;
  while (first > 0) {
    const gap = (index.get(episodes[first].since) ?? 0) - (index.get(episodes[first - 1].confirmedWeek) ?? 0) - 1;
    if (gap > MERGE_GAP_WEEKS) break;
    first--;
  }
  const chain = episodes.slice(first);
  const from = index.get(chain[0].since) ?? 0;
  const to = index.get(latest.confirmedWeek) ?? lastIndex;
  const weeks = to - from + 1;
  const accumulatedDeficit = run.weeks.slice(from, to + 1).reduce((sum, w) => sum + w.deficit, 0);
  return {
    since: chain[0].since,
    confirmedWeek: chain[0].confirmedWeek,
    lastConfirmedWeek: latest.confirmedWeek,
    confirmations: chain.length,
    weeks,
    accumulatedDeficit,
    meanDeficit: accumulatedDeficit / weeks,
    first: chain[0],
  };
}

/**
 * Estado actual de un nodo según el CUSUM: "alerta" mientras una degradación confirmada sigue reciente, "atención" si se
 * está acumulando sin llegar al umbral, "normal" si no. Los nodos nunca se marcan por una semana aislada (HU1).
 */
export function degradationStatus(rows: CusumRow[], h: number): DegradationStatus {
  const run = runCusum(rows, h);
  const active = currentAlert(run);
  if (active) return { level: "alerta", run, active };
  if (run.weeks.length > 0 && run.current.threshold > 0 && run.current.accumulated >= ATTENTION_FRACTION * run.current.threshold) {
    return { level: "atencion", run, active: null };
  }
  return { level: "normal", run, active: null };
}

/** Un período en que el nodo estuvo en degradación sostenida: de cuándo se sostuvo el desvío hasta la última confirmación. */
export interface DegradationPeriod {
  from: string;
  to: string;
  /** Primera confirmación del período: es la detección. */
  confirmedWeek: string;
  confirmations: number;
}

/**
 * Todos los períodos de degradación sostenida que el CUSUM confirmó en la serie (HU5): las confirmaciones consecutivas se
 * unen en un solo período, igual que en la alerta vigente.
 */
export function degradationPeriods(rows: CusumRow[], h: number): DegradationPeriod[] {
  const run = runCusum(rows, h);
  const index = new Map(run.weeks.map((w, i) => [w.weekStart, i]));
  const periods: DegradationPeriod[] = [];
  for (const episode of run.episodes) {
    const last = periods[periods.length - 1];
    const gap = last ? (index.get(episode.since) ?? 0) - (index.get(last.to) ?? 0) - 1 : Infinity;
    if (last && gap <= MERGE_GAP_WEEKS) {
      last.to = episode.confirmedWeek;
      last.confirmations += 1;
    } else {
      periods.push({ from: episode.since, to: episode.confirmedWeek, confirmedWeek: episode.confirmedWeek, confirmations: 1 });
    }
  }
  return periods;
}

