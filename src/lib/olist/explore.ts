import type { Prediction, SeriesEvaluation, WeekState } from "@/lib/ml-client";
import { PHASE1_WEEKS, shortId, type OlistSeller } from "./sample";

export interface ExplorationWeek {
  /** Número de semana CON ACTIVIDAD del vendedor (1, 2, 3…): no son semanas calendario consecutivas. */
  n: number;
  inicio: string;
  margen: number;
  items: number;
  fase: 1 | 2;
  /** Estado contra la banda semanal; solo las semanas de Fase II se evalúan. */
  estado: WeekState | null;
}

export interface SellerExploration {
  id: string;
  shortId: string;
  weeks: ExplorationWeek[];
  prediction: Prediction;
  summary: SeriesEvaluation["resumen"];
  phase1Mean: number;
  phase2Mean: number;
  /** |línea base − promedio real de Fase II|, en días. */
  baselineErrorDays: number;
  /** Lo mismo con el método ingenuo (la media de Fase I): lo que el modelo tiene que superar. */
  naiveErrorDays: number;
  /** ¿El promedio real de Fase II cayó dentro de la banda del promedio? */
  phase2MeanInBand: boolean;
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Arma lo que muestra la pantalla a partir de la serie real del vendedor y de lo que devolvió el modelo. */
export function buildSellerExploration(seller: OlistSeller, evaluation: SeriesEvaluation): SellerExploration {
  const phase1 = seller.semanas.slice(0, PHASE1_WEEKS);
  const phase2 = seller.semanas.slice(PHASE1_WEEKS);
  if (phase2.length !== evaluation.evaluaciones.length) {
    throw new Error("La evaluación no coincide con las semanas de Fase II del vendedor");
  }

  const phase1Mean = mean(phase1.map((w) => w.margen));
  const phase2Mean = mean(phase2.map((w) => w.margen));
  const { prediccion } = evaluation;

  return {
    id: seller.id,
    shortId: shortId(seller.id),
    weeks: seller.semanas.map((w, i) => ({
      n: i + 1,
      inicio: w.inicio,
      margen: w.margen,
      items: w.items,
      fase: i < PHASE1_WEEKS ? 1 : 2,
      estado: i < PHASE1_WEEKS ? null : evaluation.evaluaciones[i - PHASE1_WEEKS].estado,
    })),
    prediction: prediccion,
    summary: evaluation.resumen,
    phase1Mean,
    phase2Mean,
    baselineErrorDays: Math.abs(prediccion.linea_base - phase2Mean),
    naiveErrorDays: Math.abs(phase1Mean - phase2Mean),
    phase2MeanInBand: phase2Mean >= prediccion.banda_inferior && phase2Mean <= prediccion.banda_superior,
  };
}
