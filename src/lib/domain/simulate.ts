// Motor de simulación de disrupciones.
//
// Implementa las definiciones de la tesis, documentadas en docs/definiciones-motor.md (con sus diferencias):
//
//   d_i(s)  = max(0, n_i − r_i(s)) / n_i            déficit del nodo i, como proporción de su nivel normal (0 a 1)
//   d_j(s)  = min(1, max(e_j(s), max_{i→j} c·d_i(s − τ_ij)))
//                                                    propagación: el mayor entre el golpe propio y lo que llega
//   D(s)    = Σ_i d_i(s)                             déficit de la red, todos los nodos con peso 1
//   E(t)    = Σ_{u<t} [D_A(s_r+u) − D_B(s_r+u)]      pérdida evitable acumulada al reconfigurar en s_r
//   N(k)    = min { t : E(t) ≥ k·d0 }                umbral de persistencia (RF028); "no cruza" si no existe
//
// A = se mantiene la estructura; B = se reconfigura en s_r (escalón, RF022: el nodo afectado rinde su nivel normal
// desde s_r). `d0` es el déficit semanal del nodo afectado en régimen degradado, así que el costo de reconfigurar
// es K = k·d0: "k semanas de operar como ahora". No hay ninguna magnitud monetaria.
//
// Lo que NO hace, a propósito:
//   - La duración de la disrupción no es un dato: el déficit se sostiene hasta el fin del horizonte salvo que se
//     reconfigure (docs/duracion-de-la-disrupcion.md). No hay recuperación automática.
//   - No hay piso de magnitud para propagar ni tope de saltos: la propagación es una recurrencia semanal, y con la
//     fracción c < 1 cada salto atenúa el golpe por sí solo. Termina aunque la red tenga ciclos porque todo tránsito
//     tarda al menos una semana.
//
// Réplicas (RF023): por cada fracción de propagación `c` de PROPAGATION_FRACTIONS se corren `replications` réplicas.
// Cada una sortea UNA posición dentro de la banda de la línea base (compartida por todos los nodos, fija en el
// horizonte, la misma para A y B). Con magnitud proporcional el déficit es una razón y el nivel normal se cancela, así
// que ese sorteo solo mueve el resultado cuando hay semanas observadas (simulación desde una alerta).
import { createRng } from "@/lib/domain/rng";
import { K_MAX, PROPAGATION_FRACTIONS } from "@/lib/domain/k-table";
import { addWeeksIso, mondayOf } from "@/lib/domain/synthetic/weeks";
import type { DisruptionEvent, KTableRow, SupplyChainEdge, SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";

/** Semana proyectada, ya agregada sobre las réplicas: valor central (mediana) + rango entre los percentiles 10 y 90. */
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
  /** Mediana del déficit sobre las réplicas, en las unidades del nodo (nivel normal × proporción de déficit). */
  deficit: number;
  deficitLow: number;
  deficitHigh: number;
}

/** Réplicas POR cada fracción de propagación. */
export const DEFAULT_REPLICATIONS = 30;

export { K_MAX, PROPAGATION_FRACTIONS };

/** Semanas que tarda el déficit en cruzar una arista: al menos una, para que la recurrencia avance siempre. */
export function transitLagWeeks(transitTimeDays: number): number {
  return Math.max(1, Math.round(transitTimeDays / 7));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const weeksBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / WEEK_MS);

// ───────────────────────────── estadística ─────────────────────────────

/** Orden ascendente que tolera +∞ (una réplica que no cruza). */
const ascending = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** Percentil por rango más cercano: no interpola, así que un +∞ nunca contamina a los percentiles que no lo alcanzan. */
function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Mediana; si alguno de los dos del medio es +∞ la mediana es +∞ (la mitad o más de las réplicas no cruza). */
function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  const [a, b] = [sorted[mid - 1], sorted[mid]];
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : b;
}

/** Resumen sobre las réplicas: mediana y rango entre los percentiles 10 y 90 (RF029). No el mínimo y el máximo, que crecen con R. */
export function summarize(values: number[]): { median: number; low: number; high: number } {
  const sorted = [...values].sort(ascending);
  return { median: medianSorted(sorted), low: quantileSorted(sorted, 0.1), high: quantileSorted(sorted, 0.9) };
}

/**
 * Primera semana t (1 a H) en que la pérdida evitable acumulada `E[t-1]` alcanza el costo; +∞ si no existe.
 * Con costo 0 es la semana 1. No decrece cuando el costo aumenta, porque E no decrece.
 */
export function crossingWeek(cumulativeAvoidable: number[], cost: number): number {
  for (let t = 0; t < cumulativeAvoidable.length; t++) if (cumulativeAvoidable[t] >= cost) return t + 1;
  return Infinity;
}

// ───────────────────────────── red ─────────────────────────────

type EdgeLike = Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">;

/** Subred alcanzable desde los nodos con evento: el resto no recibe déficit y no cuesta nada. */
interface Reach {
  ids: string[];
  index: Map<string, number>;
  /** Por nodo: de qué nodos recibe déficit y con cuántas semanas de retraso. */
  inEdges: { from: number; lag: number }[][];
  edgeCount: number;
}

function buildReach(edges: EdgeLike[], sourceIds: string[]): Reach {
  const adjacency = new Map<string, EdgeLike[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    adjacency.set(edge.sourceNodeId, list);
  }
  const index = new Map<string, number>();
  const ids: string[] = [];
  const visit = (id: string) => {
    if (index.has(id)) return false;
    index.set(id, ids.length);
    ids.push(id);
    return true;
  };
  const queue: string[] = [];
  for (const id of sourceIds) if (visit(id)) queue.push(id);
  for (let head = 0; head < queue.length; head++) {
    for (const edge of adjacency.get(queue[head]) ?? []) if (visit(edge.targetNodeId)) queue.push(edge.targetNodeId);
  }
  const inEdges: Reach["inEdges"] = ids.map(() => []);
  let edgeCount = 0;
  for (const id of ids) {
    for (const edge of adjacency.get(id) ?? []) {
      inEdges[index.get(edge.targetNodeId)!].push({ from: index.get(id)!, lag: transitLagWeeks(edge.transitTimeDays) });
      edgeCount++;
    }
  }
  return { ids, index, inEdges, edgeCount };
}

/**
 * Recurrencia semanal de la propagación: d_j(t) = min(1, max(own_j(t), max_{i→j} c·d_i(t − lag))).
 * `own[j][t]` es el golpe propio del nodo j en la semana t; las semanas anteriores a 0 valen 0.
 */
function propagate(reach: Reach, own: Float64Array[], fraction: number, length: number): Float64Array[] {
  const n = reach.ids.length;
  const d = reach.ids.map(() => new Float64Array(length));
  for (let t = 0; t < length; t++) {
    for (let j = 0; j < n; j++) {
      let value = own[j][t];
      for (const { from, lag } of reach.inEdges[j]) {
        if (t - lag < 0) continue;
        const incoming = fraction * d[from][t - lag];
        if (incoming > value) value = incoming;
      }
      d[j][t] = value > 1 ? 1 : value;
    }
  }
  return d;
}

/**
 * Estima cuánto trabajo va a costar una corrida SIN correrla, para poder rechazarla antes
 * (salvaguarda de docs/rendimiento-motor.md). Cada réplica propaga tres veces (A, B al decidir y, si se pide, B en
 * otra semana) sobre la subred alcanzable, semana por semana:
 *   unidades = réplicas × fracciones × 3 × semanas × (aristas + nodos alcanzados)
 */
export function estimateSimulationWork(
  edges: EdgeLike[],
  events: Pick<DisruptionEvent, "nodeId">[],
  horizonWeeks: number,
  replications: number = DEFAULT_REPLICATIONS,
  pastWeeks: number = 0,
): number {
  const reach = buildReach(edges, [...new Set(events.map((e) => e.nodeId))]);
  return replications * PROPAGATION_FRACTIONS.length * 3 * (horizonWeeks + pastWeeks) * (reach.edgeCount + reach.ids.length);
}

// ───────────────────────────── severidad ─────────────────────────────

export type Severity = "severe" | "moderate" | "none";

const SEVERE_DEFICIT_THRESHOLD = 8;
const MODERATE_DEFICIT_THRESHOLD = 2;

export function classifySeverity(deficit: number): Severity {
  if (deficit >= SEVERE_DEFICIT_THRESHOLD) return "severe";
  if (deficit >= MODERATE_DEFICIT_THRESHOLD) return "moderate";
  return "none";
}

// ───────────────────────────── simulación ─────────────────────────────

/** Estadística de la línea base reciente de un nodo, incluida su banda de incertidumbre. */
function recentBaselineStats(history: WeeklyPerformance[]) {
  const sorted = [...history].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const recent = sorted.slice(-4);
  const count = recent.length || 1;
  const mean = (pick: (w: WeeklyPerformance) => number) => recent.reduce((acc, w) => acc + pick(w), 0) / count;
  return { baseline: mean((w) => w.baseline), lowerBand: mean((w) => w.baselineLowerBand), upperBand: mean((w) => w.baselineUpperBand) };
}

/** Semanas ya observadas del nodo afectado cuando la simulación parte de una alerta. */
export interface ObservedWeeks {
  nodeId: string;
  weeks: { weekStart: string; actualValue: number }[];
}

/**
 * Lo observado del nodo afectado entre el inicio del desvío (primer evento) y s_r, para una simulación desde una
 * alerta. `undefined` si la simulación es manual (sin semana de decisión) o no hay semanas registradas en ese tramo.
 */
export function observedForScenario(
  rows: Pick<WeeklyPerformance, "nodeId" | "weekStart" | "actualValue">[],
  events: Pick<DisruptionEvent, "nodeId" | "startDate">[],
  decisionWeek: string | undefined,
): ObservedWeeks | undefined {
  if (!decisionWeek || events.length === 0) return undefined;
  const nodeId = events[0].nodeId;
  const from = events.map((e) => mondayOf(e.startDate)).reduce((a, b) => (a < b ? a : b));
  const until = mondayOf(decisionWeek);
  const weeks = rows
    .filter((r) => r.nodeId === nodeId && r.weekStart >= from && r.weekStart < until)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((r) => ({ weekStart: r.weekStart, actualValue: r.actualValue }));
  return weeks.length > 0 ? { nodeId, weeks } : undefined;
}

export interface SimulationOptions {
  /** Semilla del RNG — la misma semilla reproduce la corrida exactamente (RF030). */
  seed: number;
  /** Réplicas POR fracción de propagación (RF023). */
  replications?: number;
  /** Semana del horizonte (0 = s_r) en la que se aplica la reconfiguración que se muestra; null = no se reconfigura (RF022). */
  reconfigurationWeekIndex?: number | null;
  /** Semana de la decisión de reconfigurar (s_r). Por defecto, el inicio del primer evento (simulación manual). */
  decisionWeek?: string;
  /** Si está, el nodo afectado parte de lo que se observó de él entre el inicio del desvío y s_r. */
  observed?: ObservedWeeks;
}

/** La pérdida evitable acumulada E(t) de una réplica y su d0: lo mínimo para calcular N(k) para cualquier k. */
export interface ReplicaCurve {
  fraction: number;
  /** E(1), …, E(H). */
  avoidable: number[];
  d0: number;
}

/** N(k) sobre las réplicas de una fracción de propagación: mediana, p10, p90 (null = +∞) y qué parte cruza. */
export function thresholdAtK(
  curves: ReplicaCurve[],
  k: number,
  fraction: number,
): { median: number | null; low: number | null; high: number | null; share: number } {
  const values = curves
    .filter((c) => Math.abs(c.fraction - fraction) < 1e-9)
    .map((c) => (c.d0 > 0 ? crossingWeek(c.avoidable, k * c.d0) : Infinity));
  if (values.length === 0) return { median: null, low: null, high: null, share: 0 };
  const summary = summarize(values);
  const finite = (value: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
  return {
    median: finite(summary.median),
    low: finite(summary.low),
    high: finite(summary.high),
    share: values.filter(Number.isFinite).length / values.length,
  };
}

/**
 * N para un costo de reconfigurar expresado directamente en semanas de operación perdidas (la unidad de la pérdida),
 * en vez de en semanas de operar como ahora: la primera semana en que la pérdida evitable alcanza ese costo.
 * Resume las réplicas de una fracción de propagación; `null` = no cruza dentro del horizonte.
 */
export function thresholdAtCost(
  curves: ReplicaCurve[],
  cost: number,
  fraction: number,
): { median: number | null; low: number | null; high: number | null; share: number } {
  const values = curves.filter((c) => Math.abs(c.fraction - fraction) < 1e-9).map((c) => crossingWeek(c.avoidable, cost));
  if (values.length === 0) return { median: null, low: null, high: null, share: 0 };
  const summary = summarize(values);
  const finite = (value: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
  return {
    median: finite(summary.median),
    low: finite(summary.low),
    high: finite(summary.high),
    share: values.filter(Number.isFinite).length / values.length,
  };
}

export interface SimulationOutcome {
  /** Proyección agregada (mediana + rango) por nodo alcanzado, directa o por propagación. */
  projectionByNode: Map<string, ProjectedWeek[]>;
  /** Pérdida de operación en el horizonte, en semanas equivalentes (Σ de D), del escenario que se muestra. */
  totalDeficit: { median: number; low: number; high: number };
  /** Mediana semana a semana de D (semanas equivalentes perdidas), del escenario que se muestra. */
  weeklyLoss: number[];
  /**
   * Pérdida ACUMULADA hasta cada semana del horizonte (mediana y rango p10–p90), calculada réplica por réplica: su
   * último punto es exactamente `totalDeficit`. No es la suma de las medianas semanales.
   */
  cumulativeLoss: { median: number; low: number; high: number }[];
  /**
   * Por semana w del horizonte: pérdida que todavía se puede evitar reconfigurando en w (mediana). Para w = 0 es
   * exactamente E(H); para w > 0 es una aproximación: resta de D_A lo que ya aportaba D_B al decidir en s_r.
   */
  avoidableFromWeek: number[];
  /** d0: déficit semanal del nodo afectado en régimen degradado (proporción), mediana sobre las réplicas. */
  d0: number;
  /** k_max = E(H)/d0 de cada réplica, ordenado: reconfigurar se paga mientras k ≤ k_max. */
  breakEvenKs: number[];
  /** E(t) y d0 de cada réplica, para calcular N(k) con cualquier k (ver `thresholdAtK`). */
  replicaCurves: ReplicaCurve[];
  /** Semanas observadas antes de s_r (0 en una simulación manual). No entran en el umbral. */
  observedWeeks: number;
  /** Semana de la decisión (s_r) en ISO, y la primera semana proyectada. */
  decisionWeek: string;
  kTable: KTableRow[];
  /** Réplicas por fracción de propagación. */
  replications: number;
  seed: number;
  reconfigurationWeekIndex: number | null;
}

/** Fracción de las réplicas en que reconfigurar se paga con el costo `k` (semanas de operar como ahora). */
export const shareWorthwhile = (breakEvenKs: number[], k: number): number =>
  breakEvenKs.length === 0 ? 0 : breakEvenKs.filter((kMax) => kMax >= k).length / breakEvenKs.length;

/**
 * Corre la simulación completa de un escenario: por cada fracción de propagación, `replications` réplicas;
 * cada una calcula A (mantener), B (reconfigurar al decidir) y E(t), y de ahí N(k) para k = 1..K_MAX.
 */
export function runScenarioSimulation(
  nodes: Pick<SupplyChainNode, "id">[],
  edges: EdgeLike[],
  events: DisruptionEvent[],
  weeklyPerformanceAll: WeeklyPerformance[],
  horizonWeeks: number,
  options: SimulationOptions,
): SimulationOutcome {
  const replications = options.replications ?? DEFAULT_REPLICATIONS;
  const reconfigurationWeekIndex = options.reconfigurationWeekIndex ?? null;
  const rng = createRng(options.seed);
  const H = horizonWeeks;

  const historyByNode = new Map<string, WeeklyPerformance[]>();
  for (const record of weeklyPerformanceAll) {
    const list = historyByNode.get(record.nodeId) ?? [];
    list.push(record);
    historyByNode.set(record.nodeId, list);
  }
  const knownNodes = new Set(nodes.map((n) => n.id));
  const liveEvents = events.filter((e) => knownNodes.has(e.nodeId));

  const empty: SimulationOutcome = {
    projectionByNode: new Map(),
    totalDeficit: { median: 0, low: 0, high: 0 },
    weeklyLoss: new Array(H).fill(0),
    cumulativeLoss: Array.from({ length: H }, () => ({ median: 0, low: 0, high: 0 })),
    avoidableFromWeek: new Array(H).fill(0),
    d0: 0,
    breakEvenKs: [],
    replicaCurves: [],
    observedWeeks: 0,
    decisionWeek: options.decisionWeek ? mondayOf(options.decisionWeek) : "",
    kTable: [],
    replications,
    seed: options.seed,
    reconfigurationWeekIndex,
  };
  if (liveEvents.length === 0 || H < 1) return empty;

  // Línea de tiempo: arranca en el primer evento (o en s_r, si es anterior) y s_r cae P semanas después.
  const eventWeeks = liveEvents.map((e) => mondayOf(e.startDate));
  const earliestEvent = eventWeeks.reduce((a, b) => (a < b ? a : b));
  const decision = options.decisionWeek ? mondayOf(options.decisionWeek) : earliestEvent;
  const timelineStart = decision < earliestEvent ? decision : earliestEvent;
  const P = weeksBetween(timelineStart, decision);
  const L = P + H;

  const eventNodeIds = [...new Set(liveEvents.map((e) => e.nodeId))];
  const reach = buildReach(edges, eventNodeIds);
  const n = reach.ids.length;
  const counts = reach.ids.map((id) => (historyByNode.get(id)?.length ?? 0) > 0);

  // Golpe propio de cada nodo con evento: el mayor de los eventos ya iniciados (no se apilan).
  const baseOwn = reach.ids.map(() => new Float64Array(L));
  liveEvents.forEach((event, i) => {
    const onset = weeksBetween(timelineStart, eventWeeks[i]);
    const row = baseOwn[reach.index.get(event.nodeId)!];
    for (let t = Math.max(0, onset); t < L; t++) row[t] = Math.max(row[t], Math.min(1, event.magnitude / 100));
  });
  const eventNodeIdx = eventNodeIds.map((id) => reach.index.get(id)!);

  // Nodos con historial: llevan la banda de la línea base para sortear el nivel normal y mostrar la proyección.
  const stats = reach.ids.map((id) => {
    const history = historyByNode.get(id);
    return history && history.length > 0 ? recentBaselineStats(history) : null;
  });

  const observedIdx = options.observed ? reach.index.get(options.observed.nodeId) : undefined;
  const observedByWeek = new Map((options.observed?.weeks ?? []).map((w) => [w.weekStart, w.actualValue]));

  // Acumuladores. Los de proyección son por nodo → semana → valor de cada réplica, del escenario que se muestra.
  const actualAcc = reach.ids.map(() => Array.from({ length: H }, () => [] as number[]));
  const deficitAcc = reach.ids.map(() => Array.from({ length: H }, () => [] as number[]));
  const reached = new Array<boolean>(n).fill(false);
  const totals: number[] = [];
  const lossByWeek: number[][] = Array.from({ length: H }, () => []);
  const avoidableByWeek: number[][] = Array.from({ length: H }, () => []);
  const d0s: number[] = [];
  const breakEvenKs: number[] = [];
  const replicaCurves: ReplicaCurve[] = [];

  const sumLoss = (d: Float64Array[], t: number) => {
    let total = 0;
    for (let j = 0; j < n; j++) if (counts[j]) total += d[j][t];
    return total;
  };

  for (const fraction of PROPAGATION_FRACTIONS) {
    for (let replica = 0; replica < replications; replica++) {
      const position = rng();
      const level = stats.map((s) => (s ? s.lowerBand + position * (s.upperBand - s.lowerBand) : 0));

      // Golpe propio de esta réplica. Con semanas observadas, el nodo afectado usa su déficit observado antes de s_r
      // y su promedio de ahí en adelante (d0); el nivel normal es el sorteado de la réplica.
      const ownA = baseOwn.map((row) => Float64Array.from(row));
      if (observedIdx !== undefined && stats[observedIdx] && observedByWeek.size > 0) {
        const normal = Math.max(level[observedIdx], 1e-9);
        const observedDeficit = (weekStart: string) => Math.min(1, Math.max(0, normal - observedByWeek.get(weekStart)!) / normal);
        const seen: number[] = [];
        for (let t = 0; t < P; t++) {
          const weekStart = addWeeksIso(timelineStart, t);
          if (!observedByWeek.has(weekStart)) continue;
          ownA[observedIdx][t] = observedDeficit(weekStart);
          seen.push(ownA[observedIdx][t]);
        }
        const degraded = seen.length > 0 ? seen.reduce((a, b) => a + b, 0) / seen.length : 0;
        for (let t = P; t < L; t++) ownA[observedIdx][t] = degraded;
      }

      // B: desde s_r + w los nodos afectados rinden su nivel normal (escalón). El pasado no se toca.
      const reconfigure = (from: number) =>
        ownA.map((row, j) => {
          if (!eventNodeIdx.includes(j)) return row;
          const copy = Float64Array.from(row);
          for (let t = Math.max(0, from); t < L; t++) copy[t] = 0;
          return copy;
        });

      const dA = propagate(reach, ownA, fraction, L);
      // Sin semanas observadas, reconfigurar al decidir deja a toda la red sin déficit: no hace falta propagar.
      const dB0 = P === 0 ? reach.ids.map(() => new Float64Array(L)) : propagate(reach, reconfigure(P), fraction, L);
      const dShown = reconfigurationWeekIndex === null ? dA : reconfigurationWeekIndex === 0 ? dB0 : propagate(reach, reconfigure(P + reconfigurationWeekIndex), fraction, L);

      // d0: el régimen degradado del nodo afectado, a partir de s_r.
      let d0 = 0;
      for (const j of eventNodeIdx) for (let t = P; t < L; t++) d0 = Math.max(d0, ownA[j][t]);

      // E(t): pérdida evitable acumulada desde s_r.
      const E: number[] = [];
      const avoidableStep: number[] = [];
      let cumulative = 0;
      for (let u = 0; u < H; u++) {
        const step = sumLoss(dA, P + u) - sumLoss(dB0, P + u);
        avoidableStep.push(step);
        cumulative += step;
        E.push(cumulative);
      }

      replicaCurves.push({ fraction, avoidable: E, d0 });

      // Agregados para las pantallas (todas las fracciones juntas).
      d0s.push(d0);
      breakEvenKs.push(d0 > 0 ? E[H - 1] / d0 : 0);
      let suffix = 0;
      const suffixes = new Array<number>(H);
      for (let u = H - 1; u >= 0; u--) {
        suffix += avoidableStep[u];
        suffixes[u] = suffix;
      }
      suffixes.forEach((value, u) => avoidableByWeek[u].push(value));

      let total = 0;
      for (let u = 0; u < H; u++) {
        const loss = sumLoss(dShown, P + u);
        total += loss;
        lossByWeek[u].push(loss);
      }
      totals.push(total);

      for (let j = 0; j < n; j++) {
        if (!stats[j]) continue;
        for (let u = 0; u < H; u++) {
          if (dA[j][P + u] > 0) reached[j] = true;
          const share = dShown[j][P + u];
          actualAcc[j][u].push(level[j] * (1 - share));
          deficitAcc[j][u].push(level[j] * share);
        }
      }
    }
  }

  // Acumulado réplica por réplica: el total de cada réplica es la suma de sus semanas.
  const cumulativeByWeek: number[][] = Array.from({ length: H }, () => []);
  for (let r = 0; r < totals.length; r++) {
    let running = 0;
    for (let u = 0; u < H; u++) {
      running += lossByWeek[u][r];
      cumulativeByWeek[u].push(running);
    }
  }

  const srWeek = decision;
  const projectionByNode = new Map<string, ProjectedWeek[]>();
  reach.ids.forEach((id, j) => {
    const s = stats[j];
    if (!s || !reached[j]) return;
    projectionByNode.set(
      id,
      Array.from({ length: H }, (_, u) => {
        const actual = summarize(actualAcc[j][u]);
        const deficit = summarize(deficitAcc[j][u]);
        return {
          weekStart: addWeeksIso(srWeek, u),
          baseline: s.baseline,
          baselineLowerBand: s.lowerBand,
          baselineUpperBand: s.upperBand,
          actualValue: actual.median,
          actualValueLow: actual.low,
          actualValueHigh: actual.high,
          deficit: deficit.median,
          deficitLow: deficit.low,
          deficitHigh: deficit.high,
        };
      }),
    );
  });

  const kTable: KTableRow[] = [];
  for (const fraction of PROPAGATION_FRACTIONS) {
    for (let k = 1; k <= K_MAX; k++) {
      const t = thresholdAtK(replicaCurves, k, fraction);
      kTable.push({ k, propagationFraction: fraction, thresholdMedian: t.median, thresholdLow: t.low, thresholdHigh: t.high, crossingShare: t.share });
    }
  }

  return {
    projectionByNode,
    totalDeficit: summarize(totals),
    weeklyLoss: lossByWeek.map((values) => summarize(values).median),
    cumulativeLoss: cumulativeByWeek.map((values) => summarize(values)),
    avoidableFromWeek: avoidableByWeek.map((values) => summarize(values).median),
    d0: summarize(d0s).median,
    breakEvenKs: [...breakEvenKs].sort(ascending),
    replicaCurves,
    observedWeeks: P,
    decisionWeek: srWeek,
    kTable,
    replications,
    seed: options.seed,
    reconfigurationWeekIndex,
  };
}

/**
 * Reproduce una corrida guardada con su propia semilla y réplicas (RF030): mismo resultado que el que quedó
 * registrado, pero calculado con la cadena tal como está ahora. Lo usan las pantallas para dibujar las curvas.
 */
export function replayRun(input: {
  nodes: Pick<SupplyChainNode, "id">[];
  edges: EdgeLike[];
  events: DisruptionEvent[];
  rows: WeeklyPerformance[];
  horizonWeeks: number;
  decisionWeek?: string;
  run: { seed: number; replications: number; reconfigurationWeekIndex: number | null };
}): SimulationOutcome {
  const { run } = input;
  return runScenarioSimulation(input.nodes, input.edges, input.events, input.rows, input.horizonWeeks, {
    seed: run.seed,
    replications: run.replications,
    reconfigurationWeekIndex: run.reconfigurationWeekIndex,
    decisionWeek: input.decisionWeek,
    observed: observedForScenario(input.rows, input.events, input.decisionWeek),
  });
}
