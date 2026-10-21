// Calibración del umbral del CUSUM (RF019 y RF020).
//
// El umbral h (en múltiplos del margen de la línea base) se calibra MINIMIZANDO el costo operativo total, en unidades
// de déficit acumulado:
//
//     C(h) = E[retardo(h)] + f · E[F(h)]
//
//   retardo(h)  semanas entre el inicio real de una degradación sostenida y su confirmación. Equivale al déficit
//               acumulado en ese lapso medido en múltiplos del déficit semanal del episodio.
//   F(h)        confirmaciones sin degradación sostenida real, por cada 26 semanas de operación normal.
//   f           costo de una falsa alarma, en semanas de operar degradado (la misma unidad que el costo k de
//               reconfigurar). Es el costo de EVALUAR una reconfiguración innecesaria, no el de reconfigurar, porque el
//               sistema solo recomienda. No es un valor fijo: se barre, y se reporta h*(f) = argmin_h C(h).
//               f = 0 ignora las falsas alarmas; f = k (reconfigurar de verdad) es la cota superior.
//
// La calibración corre sobre el modelo YA ENTRENADO y en un paso aparte del entrenamiento (`scripts/calibrate-cusum.ts`).
import { runCusum, type CusumRow } from "@/lib/domain/degradation";

/** Ventana de operación normal sobre la que se cuentan las falsas alarmas. */
export const FALSE_ALARM_EXPOSURE_WEEKS = 26;

/** Un ensayo: una serie con un tramo normal y, a continuación, un episodio de degradación de duración conocida. */
export interface CalibrationTrial {
  rows: CusumRow[];
  /** Índice de la primera semana del episodio. Antes de él, toda confirmación es una falsa alarma. */
  episodeStart: number;
  /** Semanas del episodio: el retardo de un episodio que no se detecta se acota a este valor. */
  episodeWeeks: number;
}

export interface ThresholdPoint {
  h: number;
  /** Retardo medio, en semanas. */
  delay: number;
  /** Falsas alarmas por cada 26 semanas de operación normal. */
  falseAlarms: number;
  /** Fracción de episodios detectados dentro de su duración. */
  detected: number;
}

/** Evalúa cada umbral candidato sobre todos los ensayos. */
export function evaluateThresholds(trials: CalibrationTrial[], hGrid: number[]): ThresholdPoint[] {
  return hGrid.map((h) => {
    let delaySum = 0;
    let detected = 0;
    let falseAlarms = 0;
    let cleanWeeks = 0;
    for (const trial of trials) {
      const run = runCusum(trial.rows, h);
      const index = new Map(run.weeks.map((w, i) => [w.weekStart, i]));
      const confirmations = run.episodes.map((e) => index.get(e.confirmedWeek) ?? -1);
      falseAlarms += confirmations.filter((i) => i < trial.episodeStart).length;
      cleanWeeks += trial.episodeStart;
      const first = confirmations.find((i) => i >= trial.episodeStart);
      if (first !== undefined && first - trial.episodeStart < trial.episodeWeeks) {
        delaySum += first - trial.episodeStart + 1;
        detected += 1;
      } else {
        delaySum += trial.episodeWeeks;
      }
    }
    return {
      h,
      delay: delaySum / trials.length,
      falseAlarms: (falseAlarms / Math.max(cleanWeeks, 1)) * FALSE_ALARM_EXPOSURE_WEEKS,
      detected: detected / trials.length,
    };
  });
}

export interface OptimalThreshold extends ThresholdPoint {
  f: number;
  cost: number;
}

/** h*(f): el umbral que minimiza C(h) = retardo + f · falsas alarmas. En un empate, el más bajo (detecta antes). */
export function optimalThreshold(points: ThresholdPoint[], f: number): OptimalThreshold {
  let best: OptimalThreshold | null = null;
  for (const p of points) {
    const cost = p.delay + f * p.falseAlarms;
    if (best === null || cost < best.cost - 1e-12) best = { ...p, f, cost };
  }
  if (best === null) throw new RangeError("No hay umbrales para evaluar");
  return best;
}

/** h*(f) para una grilla de f, y el f a partir del cual h* deja de moverse. */
export function thresholdByCost(points: ThresholdPoint[], fGrid: number[]): { table: OptimalThreshold[]; fStable: number | null } {
  const table = fGrid.map((f) => optimalThreshold(points, f));
  const last = table[table.length - 1].h;
  const firstStable = table.find((row, i) => table.slice(i).every((r) => r.h === last));
  return { table, fStable: firstStable && firstStable !== table[0] ? firstStable.f : null };
}

/** h para un costo de falsa alarma cualquiera: interpola entre los puntos de la tabla y no se sale de sus extremos. */
export function interpolateThreshold(table: { f: number; h: number }[], f: number): number {
  if (table.length === 0) throw new RangeError("La tabla de calibración está vacía");
  const sorted = [...table].sort((a, b) => a.f - b.f);
  if (f <= sorted[0].f) return sorted[0].h;
  if (f >= sorted[sorted.length - 1].f) return sorted[sorted.length - 1].h;
  const hi = sorted.findIndex((r) => r.f >= f);
  const [a, b] = [sorted[hi - 1], sorted[hi]];
  return a.h + ((b.h - a.h) * (f - a.f)) / (b.f - a.f);
}
