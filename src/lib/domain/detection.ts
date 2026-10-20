// Entradas de una simulación derivadas de una disrupción detectada (docs/definiciones-motor.md, punto 6).
//
// Cuando el monitoreo marca un nodo en atención o crítico, el sistema puede ofrecer correr una simulación para
// proyectar cómo sigue. Los datos que el usuario cargaría a mano salen de lo observado:
//   nodo        = el nodo alertado
//   inicio t0   = desde cuándo viene el desvío
//   d0          = déficit semanal promedio observado entre t0 y la detección (aquí, un valor puntual para mostrar;
//                 el motor lo recalcula en cada réplica con el nivel normal sorteado de esa réplica)
//   s_r         = la semana siguiente a la detección: desde ahí se decide si reconfigurar
// Las semanas observadas entre t0 y s_r son pasado: no entran en el umbral.
//
// ⚠️ Provisorio: "desde cuándo" lo define HU2 del documento, que todavía no fija la regla. Acá es la primera semana
// de la racha de semanas por debajo de la línea base que termina en la última semana registrada, e incluye siempre
// las últimas RECENT_WEEKS, que son las que miró la regla de alerta.
import { assessNode, RECENT_WEEKS, type NodeHealthLevel } from "@/lib/domain/monitoring";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "@/lib/domain/types";

/** Tope de semanas hacia atrás que se miran para ubicar el comienzo del desvío. */
const MAX_LOOKBACK_WEEKS = 12;

export interface AlertScenarioInputs {
  nodeId: string;
  level: Exclude<NodeHealthLevel, "normal">;
  /** Primera semana del desvío (t0). */
  startDate: string;
  /** Última semana registrada, en la que saltó la alerta (t_det). */
  detectionWeek: string;
  /** Semana de la decisión (s_r = t_det + 1). */
  decisionWeek: string;
  /** Semanas observadas entre t0 y t_det, inclusive (m). */
  observedWeeks: number;
  /** d0 puntual, como % de caída respecto de la línea base (1 a 100). */
  magnitudePct: number;
}

/** `rows` son las filas de UN nodo. `null` si el nodo no está en atención ni crítico. */
export function deriveAlertScenario(rows: WeeklyPerformance[]): AlertScenarioInputs | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const { level } = assessNode(sorted);
  if (level === "normal") return null;

  const latestIndex = sorted.length - 1;
  let first = Math.max(0, latestIndex - (RECENT_WEEKS - 1));
  while (first > 0 && latestIndex - (first - 1) < MAX_LOOKBACK_WEEKS && sorted[first - 1].deficit > 0) first--;

  const observed = sorted.slice(first);
  const shares = observed.map((r) => (r.baseline > 0 ? Math.min(1, r.deficit / r.baseline) : 0));
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const detectionWeek = sorted[latestIndex].weekStart;

  return {
    nodeId: sorted[0].nodeId,
    level,
    startDate: sorted[first].weekStart,
    detectionWeek,
    decisionWeek: addWeeksIso(detectionWeek, 1),
    observedWeeks: observed.length,
    magnitudePct: Math.min(100, Math.max(1, Math.round(mean * 100))),
  };
}
