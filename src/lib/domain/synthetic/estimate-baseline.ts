// Script 3 — estimador de la línea base.
//
// ⚠️ PROVISORIO: reemplaza al microservicio de ML (Fase 5). La firma se mantiene para que el ML real
// se enchufe sin tocar nada más. La forma de estimar es una decisión de metodología de la tesis.
//
// RF017: la línea base se estima SOLO a partir del historial del propio nodo (sin región, categoría
// ni estacionalidad). Y queda CONGELADA: se estima una vez y no se recalcula con las semanas que
// se monitorean, porque si la referencia se moviera junto con la caída que se quiere detectar, el
// déficit se encogería solo y una disrupción sostenida no se detectaría nunca.
import type { WeeklyPerformance } from "@/lib/domain/types";
import type { NodeBaseline } from "@/lib/domain/vendedor/baseline";
import { MIN_BASELINE_WEEKS } from "./config";
import { stdDev, tCritical90, trimmedMean } from "./stats";

export interface BaselineEstimate {
  baseline: number;
  /** banda_inferior (RF012). */
  lower: number;
  /** banda_superior (RF012). */
  upper: number;
}

/** Fracción que se recorta de cada extremo: una semana mala aislada no debe contaminar la línea base. */
const TRIM = 0.1;

/**
 * Línea base = media recortada de la ventana de entrenamiento. Banda = intervalo de confianza del
 * 90 % de esa media (±t·s/√n): la incertidumbre de la ESTIMACIÓN, que es lo que las réplicas
 * estocásticas barren (RF012, RF023).
 */
export function estimateBaseline(trainingValues: number[]): BaselineEstimate {
  const n = trainingValues.length;
  if (n < MIN_BASELINE_WEEKS) {
    throw new RangeError(`Hacen falta al menos ${MIN_BASELINE_WEEKS} semanas para estimar la línea base (hay ${n})`);
  }
  const baseline = trimmedMean(trainingValues, TRIM);
  const halfWidth = (tCritical90(n - 1) * stdDev(trainingValues)) / Math.sqrt(n);
  return {
    baseline,
    lower: Math.max(0, baseline - halfWidth),
    upper: Math.min(100, baseline + halfWidth),
  };
}

/** Fila lista para guardar: todavía sin `id` (lo asigna la base). */
export type NewWeeklyRow = Omit<WeeklyPerformance, "id">;

/**
 * Arma las filas de un nodo aplicando la línea base congelada a toda la serie. El déficit nunca es
 * negativo: las semanas buenas no compensan a las malas.
 */
export function buildRows(input: {
  nodeId: string;
  weekStarts: string[];
  values: number[];
  estimate: BaselineEstimate;
}): NewWeeklyRow[] {
  const { nodeId, weekStarts, values, estimate } = input;
  return weekStarts.map((weekStart, i) => ({
    nodeId,
    weekStart,
    actualValue: values[i],
    baseline: estimate.baseline,
    baselineLowerBand: estimate.lower,
    baselineUpperBand: estimate.upper,
    deficit: Math.max(0, estimate.baseline - values[i]),
  }));
}

/**
 * Arma las filas de un nodo en DÍAS con una línea base ya resuelta (la del modelo de ML o la provisoria), congelada
 * para toda la serie, con su banda del promedio y, si el modelo la dio, su banda semanal.
 */
export function buildRowsWithBaseline(input: { nodeId: string; weekStarts: string[]; values: number[]; baseline: NodeBaseline }): NewWeeklyRow[] {
  const { nodeId, weekStarts, values, baseline } = input;
  return weekStarts.map((weekStart, i) => ({
    nodeId,
    weekStart,
    actualValue: values[i],
    baseline: baseline.baseline,
    baselineLowerBand: baseline.lower,
    baselineUpperBand: baseline.upper,
    ...(baseline.weeklyLower !== undefined && baseline.weeklyUpper !== undefined
      ? { weeklyBandLower: baseline.weeklyLower, weeklyBandUpper: baseline.weeklyUpper }
      : {}),
    deficit: Math.max(0, baseline.baseline - values[i]),
  }));
}
