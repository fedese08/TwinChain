// Motor de simulación MOCK — placeholder de UI mientras no existe el motor determinístico
// real (Fase 4, backend). Sirve para que las pantallas de escenario/resultado tengan algo
// que mostrar con datos coherentes; el cálculo en sí NO es la propuesta metodológica de la tesis.
//
// Lo que sí respeta, porque son decisiones cerradas del proyecto:
//   - La duración de la disrupción NO es un dato de entrada ni un supuesto: el déficit se
//     sostiene hasta que se reconfigura (ver docs/duracion-de-la-disrupcion.md).
//   - RF012: la línea base viene con banda de incertidumbre (banda_inferior/banda_superior).
//   - RF022 / C23: la reconfiguración es un escalón, nunca una rampa gradual.
//   - RF023 / C36: se corren N réplicas variando los parámetros dentro de la banda.
//   - RF027: el déficit se traslada por arista como una fracción evaluada sobre un RANGO
//     de valores, con el retraso del tiempo_transito, sin inventario ni unidades físicas.
//   - RF029: el resultado se reporta como mediana y rango, nunca como valor único.
import { addDaysIso, addWeeks, startOfWeek, toIsoDate } from "@/lib/mock/dates";
import { createRng } from "@/lib/mock/rng";
import type { DisruptionEvent, KTableRow, SupplyChainEdge, SupplyChainNode, WeeklyPerformance } from "@/lib/mock/types";

/** Semana proyectada, ya agregada sobre las réplicas: valor central (mediana) + rango observado. */
export interface ProjectedWeek {
  weekStart: string;
  baseline: number;
  /** banda_inferior de la línea base proyectada (RF012). */
  baselineLowerBand: number;
  /** banda_superior de la línea base proyectada (RF012). */
  baselineUpperBand: number;
  /** Mediana del valor real proyectado sobre las réplicas. */
  actualValue: number;
  actualValueLow: number;
  actualValueHigh: number;
  /** Mediana del déficit sobre las réplicas. */
  deficit: number;
  deficitLow: number;
  deficitHigh: number;
}

/** Una semana tal como la calcula UNA réplica, antes de agregar. */
interface ReplicaWeek {
  weekStart: string;
  baseline: number;
  actualValue: number;
  deficit: number;
}

/** Parámetros que varían entre réplicas — la "combinación de parámetros" de RF023. */
interface ReplicaParams {
  /** Posición dentro de la banda de incertidumbre de la línea base: 0 = banda_inferior, 1 = banda_superior. */
  baselinePosition: number;
  /** Fracción del déficit que se traslada por cada arista (RF027, barrida dentro de un rango). */
  propagationFraction: number;
}

export const DEFAULT_REPLICATIONS = 30;

// RF027: la fracción trasladada no es un número fijo, se evalúa sobre este rango.
const PROPAGATION_FRACTION_MIN = 0.45;
const PROPAGATION_FRACTION_MAX = 0.65;

const MIN_PROPAGATED_MAGNITUDE = 3;
const MAX_PROPAGATION_HOPS = 6;
const K_MAX = 10;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Resumen de una magnitud sobre las réplicas: mediana + extremos observados (RF029). */
function summarize(values: number[]): { median: number; low: number; high: number } {
  if (values.length === 0) return { median: 0, low: 0, high: 0 };
  return { median: median(values), low: Math.min(...values), high: Math.max(...values) };
}

/** Estadística de la línea base reciente de un nodo, incluida su banda de incertidumbre. */
function recentBaselineStats(history: WeeklyPerformance[]) {
  const sorted = [...history].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const recent = sorted.slice(-4);
  const count = recent.length || 1;
  const sum = (pick: (w: WeeklyPerformance) => number) => recent.reduce((acc, w) => acc + pick(w), 0) / count;
  return {
    lastWeekStart: sorted[sorted.length - 1]?.weekStart ?? toIsoDate(startOfWeek(new Date())),
    baseline: sum((w) => w.baseline),
    lowerBand: sum((w) => w.baselineLowerBand),
    upperBand: sum((w) => w.baselineUpperBand),
  };
}

/**
 * Proyecta una réplica del desempeño semanal de un nodo.
 *
 * **El déficit no se corrige solo.** Una vez que el evento llega al nodo, la caída se sostiene
 * hasta el fin del horizonte: la duración de una disrupción no es un dato de entrada ni un
 * supuesto del motor, es la incógnita que el sistema resuelve. Ver
 * `docs/duracion-de-la-disrupcion.md` — este motor tuvo una rampa de recuperación automática y
 * se sacó a propósito; no volver a agregarla.
 *
 * El único mecanismo que termina con el déficit es `reconfigurationWeekIndex` (RF022): a partir
 * de esa semana el nodo opera reconfigurado y el déficit cae de golpe a cero, como escalón.
 */
function projectReplica(
  history: WeeklyPerformance[],
  nodeEvents: DisruptionEvent[],
  horizonWeeks: number,
  params: ReplicaParams,
  reconfigurationWeekIndex: number | null,
): ReplicaWeek[] {
  const stats = recentBaselineStats(history);
  const baseline = stats.lowerBand + params.baselinePosition * (stats.upperBand - stats.lowerBand);
  const firstProjectedWeek = addWeeks(startOfWeek(new Date(stats.lastWeekStart)), 1);

  const weeks: ReplicaWeek[] = [];
  for (let i = 0; i < horizonWeeks; i++) {
    const weekDate = addWeeks(firstProjectedWeek, i);
    const reconfigured = reconfigurationWeekIndex !== null && i >= reconfigurationWeekIndex;

    let worstDrop = 0;
    if (!reconfigured) {
      for (const event of nodeEvents) {
        const eventWeek = startOfWeek(new Date(event.startDate));
        const weeksSinceOnset = Math.round((weekDate.getTime() - eventWeek.getTime()) / (7 * 86400000));
        // Antes del onset el evento todavía no llegó a este nodo; después, la caída se mantiene
        // en su magnitud completa: no hay recuperación espontánea.
        if (weeksSinceOnset < 0) continue;
        worstDrop = Math.max(worstDrop, event.magnitude);
      }
    }

    const actualValue = Math.max(0, baseline * (1 - worstDrop / 100));
    weeks.push({
      weekStart: toIsoDate(weekDate),
      baseline,
      actualValue,
      deficit: Math.max(0, baseline - actualValue),
    });
  }
  return weeks;
}

export type Severity = "severe" | "moderate" | "none";

const SEVERE_DEFICIT_THRESHOLD = 8;
const MODERATE_DEFICIT_THRESHOLD = 2;

export function classifySeverity(deficit: number): Severity {
  if (deficit >= SEVERE_DEFICIT_THRESHOLD) return "severe";
  if (deficit >= MODERATE_DEFICIT_THRESHOLD) return "moderate";
  return "none";
}

/** Eventos sintéticos por nodo + el retraso mínimo con el que la disrupción llega a cada uno. */
interface PropagationSpread {
  eventsByNode: Map<string, DisruptionEvent[]>;
  /** Retraso mínimo (en semanas) desde el origen hasta cada nodo alcanzado. */
  delayWeeksByNode: Map<string, number>;
}

/**
 * Propaga cada Evento aguas abajo por las Aristas (BFS en el sentido del tránsito): cada salto
 * traslada una fracción de la magnitud (RF027) y retrasa el onset según tiempo_transito.
 */
function spreadEvents(
  edges: Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">[],
  events: DisruptionEvent[],
  propagationFraction: number,
): PropagationSpread {
  const adjacency = new Map<string, { targetNodeId: string; transitTimeDays: number }[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.sourceNodeId) ?? [];
    list.push({ targetNodeId: edge.targetNodeId, transitTimeDays: edge.transitTimeDays });
    adjacency.set(edge.sourceNodeId, list);
  }

  const eventsByNode = new Map<string, DisruptionEvent[]>();
  const delayWeeksByNode = new Map<string, number>();

  for (const event of events) {
    const queue: { nodeId: string; magnitude: number; delayDays: number; hops: number }[] = [
      { nodeId: event.nodeId, magnitude: event.magnitude, delayDays: 0, hops: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift()!;

      const list = eventsByNode.get(current.nodeId) ?? [];
      list.push({
        id: `${event.id}-hop${current.hops}-${current.nodeId}`,
        scenarioId: event.scenarioId,
        nodeId: current.nodeId,
        eventType: event.eventType,
        startDate: addDaysIso(event.startDate, current.delayDays),
        magnitude: current.magnitude,
      });
      eventsByNode.set(current.nodeId, list);

      const delayWeeks = Math.round(current.delayDays / 7);
      const knownDelay = delayWeeksByNode.get(current.nodeId);
      if (knownDelay === undefined || delayWeeks < knownDelay) {
        delayWeeksByNode.set(current.nodeId, delayWeeks);
      }

      if (current.hops >= MAX_PROPAGATION_HOPS) continue;
      for (const neighbor of adjacency.get(current.nodeId) ?? []) {
        const propagatedMagnitude = current.magnitude * propagationFraction;
        if (propagatedMagnitude < MIN_PROPAGATED_MAGNITUDE) continue;
        const hopDelayDays = Math.max(7, Math.round(neighbor.transitTimeDays / 7) * 7);
        queue.push({
          nodeId: neighbor.targetNodeId,
          magnitude: propagatedMagnitude,
          delayDays: current.delayDays + hopDelayDays,
          hops: current.hops + 1,
        });
      }
    }
  }

  return { eventsByNode, delayWeeksByNode };
}

/**
 * Barre un rango de k (costo de reconfigurar, en semanas malas equivalentes) y calcula el
 * umbral de reconfiguración de UNA réplica. A partir de cierto k el umbral deja de existir.
 *
 * ⚠️ **PENDIENTE DE DEFINICIÓN — la fórmula está invertida.** Tal como está, el umbral BAJA a
 * medida que k sube, con lo cual cuanto más caro es reconfigurar, más fácil se justifica. Es al
 * revés de lo que la intuición y el propio concepto de k piden. Además el "no existe umbral" de
 * los k altos se dispara porque el umbral se hace demasiado chico (< 0.5), no porque el costo
 * sea inalcanzable, que es la razón por la que debería dejar de existir.
 *
 * Por eso la pantalla de resultado NO deriva su recomendación de esta tabla: compara
 * directamente la pérdida evitable contra k, en la misma unidad. La tabla queda visible en
 * "Detalle técnico" tal como está, sin redefinirla por cuenta propia — cómo se calcula el
 * umbral es metodología de la tesis y necesita una decisión explícita, no un parche acá.
 */
function computeReplicaThresholds(totalDeficit: number, horizonWeeks: number): (number | null)[] {
  const equivalentBadWeeks = totalDeficit / 100;
  const thresholds: (number | null)[] = [];
  for (let k = 1; k <= K_MAX; k++) {
    const rawThreshold = (equivalentBadWeeks / (k + 1)) * (horizonWeeks / 10);
    thresholds.push(rawThreshold >= 0.5 ? Math.round(rawThreshold * 10) / 10 : null);
  }
  return thresholds;
}

export interface SimulationOptions {
  /** Semilla del RNG — la misma semilla reproduce la corrida exactamente (RF030). */
  seed: number;
  /** Cantidad de réplicas estocásticas (RF023). */
  replications?: number;
  /** Semana del horizonte en la que se aplica la reconfiguración; null = no se reconfigura (RF022). */
  reconfigurationWeekIndex?: number | null;
}

export interface SimulationOutcome {
  /** Proyección agregada (mediana + rango) por nodo alcanzado, directa o por propagación. */
  projectionByNode: Map<string, ProjectedWeek[]>;
  /** Déficit acumulado de toda la red: mediana y rango sobre las réplicas (RF029). */
  totalDeficit: { median: number; low: number; high: number };
  kTable: KTableRow[];
  replications: number;
  seed: number;
  reconfigurationWeekIndex: number | null;
}

/**
 * Corre la simulación completa de un escenario: N réplicas variando la posición dentro de la
 * banda de incertidumbre y la fracción de propagación, y agrega todo a mediana + rango.
 */
export function runScenarioSimulation(
  nodes: Pick<SupplyChainNode, "id">[],
  edges: Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">[],
  events: DisruptionEvent[],
  weeklyPerformanceAll: WeeklyPerformance[],
  horizonWeeks: number,
  options: SimulationOptions,
): SimulationOutcome {
  const replications = options.replications ?? DEFAULT_REPLICATIONS;
  const reconfigurationWeekIndex = options.reconfigurationWeekIndex ?? null;
  const rng = createRng(options.seed);

  const historyByNode = new Map<string, WeeklyPerformance[]>();
  for (const record of weeklyPerformanceAll) {
    const list = historyByNode.get(record.nodeId) ?? [];
    list.push(record);
    historyByNode.set(record.nodeId, list);
  }

  // Acumuladores por nodo → por semana → valores de cada réplica.
  const actualByNodeWeek = new Map<string, number[][]>();
  const deficitByNodeWeek = new Map<string, number[][]>();
  const weekStartsByNode = new Map<string, string[]>();
  const totalDeficitPerReplica: number[] = [];
  const thresholdsPerK: (number | null)[][] = Array.from({ length: K_MAX }, () => []);

  for (let replica = 0; replica < replications; replica++) {
    const params: ReplicaParams = {
      baselinePosition: rng(),
      propagationFraction: PROPAGATION_FRACTION_MIN + rng() * (PROPAGATION_FRACTION_MAX - PROPAGATION_FRACTION_MIN),
    };
    const spread = spreadEvents(edges, events, params.propagationFraction);

    let replicaTotalDeficit = 0;
    for (const node of nodes) {
      const nodeEvents = spread.eventsByNode.get(node.id);
      if (!nodeEvents || nodeEvents.length === 0) continue;
      const history = historyByNode.get(node.id);
      if (!history || history.length === 0) continue;

      // El escalón de reconfiguración también viaja aguas abajo: llega a cada nodo con el
      // retraso de tránsito acumulado, igual que la disrupción.
      const nodeReconfigWeek =
        reconfigurationWeekIndex === null
          ? null
          : reconfigurationWeekIndex + (spread.delayWeeksByNode.get(node.id) ?? 0);

      const weeks = projectReplica(history, nodeEvents, horizonWeeks, params, nodeReconfigWeek);

      if (!weekStartsByNode.has(node.id)) {
        weekStartsByNode.set(node.id, weeks.map((w) => w.weekStart));
        actualByNodeWeek.set(node.id, weeks.map(() => []));
        deficitByNodeWeek.set(node.id, weeks.map(() => []));
      }
      const actualAcc = actualByNodeWeek.get(node.id)!;
      const deficitAcc = deficitByNodeWeek.get(node.id)!;
      weeks.forEach((week, i) => {
        actualAcc[i].push(week.actualValue);
        deficitAcc[i].push(week.deficit);
        replicaTotalDeficit += week.deficit;
      });
    }

    totalDeficitPerReplica.push(replicaTotalDeficit);
    computeReplicaThresholds(replicaTotalDeficit, horizonWeeks).forEach((threshold, i) => {
      thresholdsPerK[i].push(threshold);
    });
  }

  const projectionByNode = new Map<string, ProjectedWeek[]>();
  for (const [nodeId, weekStarts] of weekStartsByNode) {
    const history = historyByNode.get(nodeId)!;
    const stats = recentBaselineStats(history);
    const actualAcc = actualByNodeWeek.get(nodeId)!;
    const deficitAcc = deficitByNodeWeek.get(nodeId)!;

    projectionByNode.set(
      nodeId,
      weekStarts.map((weekStart, i) => {
        const actual = summarize(actualAcc[i]);
        const deficit = summarize(deficitAcc[i]);
        return {
          weekStart,
          baseline: stats.baseline,
          baselineLowerBand: stats.lowerBand,
          baselineUpperBand: stats.upperBand,
          actualValue: actual.median,
          actualValueLow: actual.low,
          actualValueHigh: actual.high,
          deficit: deficit.median,
          deficitLow: deficit.low,
          deficitHigh: deficit.high,
        };
      }),
    );
  }

  // Una réplica puede no tener umbral para un k dado y otra sí. Se reporta la mediana de las
  // que sí lo tienen, y el k se marca como "sin umbral" solo si ninguna réplica lo encontró.
  const kTable: KTableRow[] = thresholdsPerK.map((values, i) => {
    const defined = values.filter((v): v is number => v !== null);
    if (defined.length === 0) {
      return { k: i + 1, thresholdMedian: null, thresholdLow: null, thresholdHigh: null };
    }
    const summary = summarize(defined);
    return {
      k: i + 1,
      thresholdMedian: Math.round(summary.median * 10) / 10,
      thresholdLow: Math.round(summary.low * 10) / 10,
      thresholdHigh: Math.round(summary.high * 10) / 10,
    };
  });

  return {
    projectionByNode,
    totalDeficit: summarize(totalDeficitPerReplica),
    kTable,
    replications,
    seed: options.seed,
    reconfigurationWeekIndex,
  };
}
