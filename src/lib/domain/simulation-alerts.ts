// Estado de alerta de un nodo a lo largo de las semanas SIMULADAS (HU3).
//
// Aplica el mismo CUSUM del monitoreo (`degradation.ts`) a la serie proyectada de un nodo, para mostrar cómo evoluciona el
// desvío acumulado y cuándo saltaría la alerta si el escenario ocurriera. Es solo una proyección: no modifica en ningún caso
// el registro de la operación real.
import { ALERT_HOLD_WEEKS, ATTENTION_FRACTION, runCusum, type DegradationLevel } from "@/lib/domain/degradation";
import type { ProjectedWeek } from "@/lib/domain/simulate";

export interface SimulatedAlertWeek {
  weekStart: string;
  /** Acumulado del CUSUM al cierre de la semana, como fracción del umbral (1 = confirma). */
  accumulated: number;
  level: DegradationLevel;
  /** La alerta se confirma esa semana. */
  confirmed: boolean;
}

export interface SimulatedAlertTimeline {
  weeks: SimulatedAlertWeek[];
  /** Índice (0 = primera semana proyectada) en que se confirmaría la degradación sostenida, o `null` si no llega a confirmarse. */
  confirmedIndex: number | null;
  /** Índice en que el desvío pasaría a vigilancia, o `null`. */
  attentionIndex: number | null;
}

/** `projection` es la proyección de UN nodo (la mediana sobre las réplicas); `h` es el umbral del CUSUM en múltiplos del margen. */
export function simulatedAlertTimeline(projection: ProjectedWeek[], h: number): SimulatedAlertTimeline {
  const rows = projection.map((w) => ({ weekStart: w.weekStart, actualValue: w.actualValue, baseline: w.baseline, baselineLowerBand: w.baselineLowerBand }));
  const run = runCusum(rows, h);

  let lastConfirmed = -Infinity;
  const weeks: SimulatedAlertWeek[] = run.weeks.map((w, i) => {
    if (w.confirmed) lastConfirmed = i;
    const fraction = w.threshold > 0 ? w.accumulated / w.threshold : 0;
    const level: DegradationLevel = i - lastConfirmed < ALERT_HOLD_WEEKS ? "alerta" : fraction >= ATTENTION_FRACTION ? "atencion" : "normal";
    return { weekStart: w.weekStart, accumulated: fraction, level, confirmed: w.confirmed };
  });

  const index = (predicate: (w: SimulatedAlertWeek) => boolean) => {
    const i = weeks.findIndex(predicate);
    return i >= 0 ? i : null;
  };
  return { weeks, confirmedIndex: index((w) => w.confirmed), attentionIndex: index((w) => w.level !== "normal") };
}
