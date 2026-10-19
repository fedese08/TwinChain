// Contrato con el microservicio de línea base (twinchain-ml/api.py). Las respuestas se validan acá: si el
// servicio cambia de forma sin avisar, falla con un error claro en vez de propagar datos corruptos.
//
// UNIDADES: todo está en DÍAS de `margin_days` (shipping_limit_date − order_delivered_carrier_date):
// positivo = despachó antes de su compromiso. NO es el desempeño 0–100 que usa el resto de la app.
import { z } from "zod";

export const predictionSchema = z.object({
  linea_base: z.number(),
  /** Banda del PROMEDIO de Fase II (CQR, 80 %). Es la que corresponde a `banda_inferior/superior` del modelo de datos (RF012). */
  banda_inferior: z.number(),
  banda_superior: z.number(),
  /** Banda de una SEMANA individual (CQR, 80 %): la que se usa para alertas semana a semana. */
  banda_semanal_inferior: z.number(),
  banda_semanal_superior: z.number(),
});

export const weekStateSchema = z.enum(["normal", "por_debajo", "por_encima"]);

export const seriesEvaluationSchema = z.object({
  prediccion: predictionSchema,
  evaluaciones: z.array(z.object({ indice: z.number().int(), margin_mean: z.number(), estado: weekStateSchema })),
  resumen: z.object({
    semanas: z.number().int(),
    por_debajo: z.number().int(),
    normal: z.number().int(),
    por_encima: z.number().int(),
    fraccion_por_debajo: z.number(),
  }),
});

export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string().nullable(),
  features_esperadas: z.number().int(),
  bundle_sha256: z.string(),
});

const metrics = z.record(z.string(), z.number());

export const modelInfoSchema = z.object({
  version: z.string().nullable(),
  bundle_sha256: z.string(),
  familia: z.string().nullable(),
  incertidumbre: z.string().nullable(),
  dataset: z.string().nullable(),
  definicion_target: z.string().nullable(),
  unidad: z.string(),
  fase1_semanas: z.number().int(),
  features: z.array(z.string()),
  q_dias: z.number(),
  q_semanal_dias: z.number(),
  metricas_validacion_aleatoria: metrics,
  metricas_validacion_temporal: metrics,
  runtime: z.record(z.string(), z.string()),
});

export type Prediction = z.infer<typeof predictionSchema>;
export type WeekState = z.infer<typeof weekStateSchema>;
export type SeriesEvaluation = z.infer<typeof seriesEvaluationSchema>;
export type ModelHealth = z.infer<typeof healthSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;

/** Una semana de actividad de un vendedor, tal como la espera el servicio. */
export interface ActiveWeek {
  margin_mean: number;
  n_items: number;
}
