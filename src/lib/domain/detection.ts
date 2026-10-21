// Entradas de una simulación derivadas de una disrupción detectada (docs/definiciones-motor.md, punto 6).
//
// Cuando el monitoreo CONFIRMA una degradación sostenida en un nodo (Flujo A), el sistema puede ofrecer correr una
// simulación para proyectar cómo sigue. Los datos que el usuario cargaría a mano salen de lo que el detector observó:
//   nodo        = el nodo alertado
//   inicio t0   = desde cuándo viene el desvío: la primera semana del período que el detector viene confirmando (HU2)
//   d0          = déficit semanal promedio observado entre t0 y la confirmación (aquí, un valor puntual para mostrar;
//                 el motor lo recalcula en cada réplica con el nivel normal sorteado de esa réplica)
//   s_r         = la semana siguiente a la última confirmación de la alerta vigente: desde ahí se decide si reconfigurar
// Las semanas observadas entre t0 y s_r son pasado: no entran en el umbral.
//
// Los nodos anteriores a la integración del modelo (escala 0-100) no tienen CUSUM: para ellos rige la regla provisoria
// de siempre (la racha de semanas por debajo de la línea base que termina en la última semana registrada).
import { degradationStatus } from "@/lib/domain/degradation";
import { assessNode, RECENT_WEEKS, type AssessOptions, type NodeHealthLevel } from "@/lib/domain/monitoring";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "@/lib/domain/types";

/** Tope de semanas hacia atrás que se miran para ubicar el comienzo del desvío (solo en la regla provisoria). */
const MAX_LOOKBACK_WEEKS = 12;

export interface AlertScenarioInputs {
  nodeId: string;
  level: Exclude<NodeHealthLevel, "normal">;
  /** Primera semana del desvío (t0). */
  startDate: string;
  /** Semana de la confirmación más reciente de la degradación (t_det). */
  detectionWeek: string;
  /** Semana de la decisión (s_r = t_det + 1). */
  decisionWeek: string;
  /** Semanas observadas entre t0 y t_det, inclusive (m). */
  observedWeeks: number;
  /** d0 puntual, como % de caída respecto de la línea base (1 a 100). */
  magnitudePct: number;
}

const clampPct = (share: number) => Math.min(100, Math.max(1, Math.round(share * 100)));

/** `rows` son las filas de UN nodo. `null` si no hay una degradación confirmada de la que partir. */
export function deriveAlertScenario(rows: WeeklyPerformance[], options: AssessOptions = {}): AlertScenarioInputs | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  if (options.cusumH !== undefined) {
    const { active } = degradationStatus(sorted, options.cusumH);
    if (!active) return null;
    // La simulación parte de la alerta tal como está HOY: la confirmación más reciente del período, con todas las semanas
    // observadas desde que empezó el desvío. s_r es la semana siguiente a esa confirmación.
    const atConfirmation = sorted.find((r) => r.weekStart === active.lastConfirmedWeek) ?? sorted[sorted.length - 1];
    return {
      nodeId: sorted[0].nodeId,
      level: "critico",
      startDate: active.since,
      detectionWeek: active.lastConfirmedWeek,
      decisionWeek: addWeeksIso(active.lastConfirmedWeek, 1),
      observedWeeks: active.weeks,
      magnitudePct: clampPct(atConfirmation.baseline > 0 ? Math.min(1, active.meanDeficit / atConfirmation.baseline) : 0),
    };
  }

  // Nodos anteriores (0-100): regla provisoria.
  const { level } = assessNode(sorted);
  if (level === "normal") return null;
  const latestIndex = sorted.length - 1;
  let first = Math.max(0, latestIndex - (RECENT_WEEKS - 1));
  while (first > 0 && latestIndex - (first - 1) < MAX_LOOKBACK_WEEKS && sorted[first - 1].deficit > 0) first--;
  const observed = sorted.slice(first);
  const shares = observed.map((r) => (r.baseline > 0 ? Math.min(1, r.deficit / r.baseline) : 0));
  const detectionWeek = sorted[latestIndex].weekStart;
  return {
    nodeId: sorted[0].nodeId,
    level,
    startDate: sorted[first].weekStart,
    detectionWeek,
    decisionWeek: addWeeksIso(detectionWeek, 1),
    observedWeeks: observed.length,
    magnitudePct: clampPct(shares.reduce((a, b) => a + b, 0) / shares.length),
  };
}
