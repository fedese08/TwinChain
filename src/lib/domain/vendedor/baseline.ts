// Línea base de un nodo en DÍAS de margen (`margin_days`): la que da el modelo de ML a partir de las 4 primeras semanas
// del nodo (Fase I) o, si no contesta, la provisoria. Sirve igual para un vendedor real de Olist que para un nodo
// cuyo historial llega de un sensor (simulado).
import { mean, stdDev, tCritical90 } from "@/lib/domain/synthetic/stats";
import type { BaselineSource } from "@/lib/domain/types";

/** Semanas con actividad con las que el modelo de ML estima la línea base (Fase I, RF017). */
export const PHASE1_WEEKS = 4;

/** Mitad mínima de la banda de la estimación provisoria: con 4 semanas idénticas el desvío da cero. */
const MIN_HALF_WIDTH_DAYS = 0.25;

/** Línea base y bandas de un nodo en días: la del modelo de ML o, si no contestó, la provisoria. */
export type NodeBaseline = VendedorBaseline;

export interface VendedorBaseline {
  baseline: number;
  /** banda_inferior / banda_superior: incertidumbre de la línea base (RF012). */
  lower: number;
  upper: number;
  /** Banda de UNA semana individual (CQR semanal del modelo): solo si la línea base salió del modelo. */
  weeklyLower?: number;
  weeklyUpper?: number;
  source: BaselineSource;
}

/** Lo que devuelve el servicio de ML (`/predecir_desde_semanas`); se declara acá para no atar el dominio al cliente HTTP. */
export interface ModelPrediction {
  linea_base: number;
  banda_inferior: number;
  banda_superior: number;
  banda_semanal_inferior: number;
  banda_semanal_superior: number;
}

export function baselineFromModel(prediction: ModelPrediction): VendedorBaseline {
  return {
    baseline: prediction.linea_base,
    lower: prediction.banda_inferior,
    upper: prediction.banda_superior,
    weeklyLower: prediction.banda_semanal_inferior,
    weeklyUpper: prediction.banda_semanal_superior,
    source: "ml",
  };
}

/**
 * Respaldo cuando el servicio de ML no contesta: la media de las 4 semanas de Fase I (el "método ingenuo" contra
 * el que el modelo se mide) con el intervalo de confianza del 90 % de esa media. No tiene banda semanal calibrada.
 * Es PROVISORIA: se marca como tal en el nodo y se puede reemplazar por la del modelo cuando el servicio vuelva.
 */
export function provisionalVendedorBaseline(phase1Margins: number[]): VendedorBaseline {
  if (phase1Margins.length !== PHASE1_WEEKS) {
    throw new RangeError(`La Fase I requiere exactamente ${PHASE1_WEEKS} semanas (hay ${phase1Margins.length})`);
  }
  const center = mean(phase1Margins);
  const halfWidth = Math.max((tCritical90(PHASE1_WEEKS - 1) * stdDev(phase1Margins)) / Math.sqrt(PHASE1_WEEKS), MIN_HALF_WIDTH_DAYS);
  return { baseline: center, lower: center - halfWidth, upper: center + halfWidth, source: "provisoria" };
}
