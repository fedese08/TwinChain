import type { z } from "zod";
import {
  healthSchema,
  modelInfoSchema,
  seriesEvaluationSchema,
  type ActiveWeek,
  type ModelHealth,
  type ModelInfo,
  type SeriesEvaluation,
} from "./schemas";

export type MlErrorCode =
  /** Faltan `ML_SERVICE_URL` (y, si el servicio la exige, `ML_API_KEY`). */
  | "not_configured"
  /** El servicio no contestó a tiempo: en Render gratis puede estar despertando (tarda hasta un minuto). */
  | "timeout"
  | "unreachable"
  /** 401/403: la clave de API no coincide. */
  | "unauthorized"
  /** 4xx: el servicio rechazó la entrada (p. ej. Fase I con otra cantidad de semanas que 4). */
  | "rejected"
  | "server_error"
  /** Contestó, pero con una forma distinta a la del contrato. */
  | "bad_response";

export class MlServiceError extends Error {
  constructor(
    readonly code: MlErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MlServiceError";
  }
}

/** Un health check tiene que ser rápido; las predicciones toleran el arranque en frío del servicio. */
export const HEALTH_TIMEOUT_MS = 6_000;
export const CALL_TIMEOUT_MS = 75_000;

export function mlConfig(): { baseUrl: string; apiKey?: string } | null {
  const baseUrl = process.env.ML_SERVICE_URL?.trim();
  if (!baseUrl) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey: process.env.ML_API_KEY?.trim() || undefined };
}

async function call<S extends z.ZodType>(
  path: string,
  schema: S,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<z.infer<S>> {
  const config = mlConfig();
  if (!config) throw new MlServiceError("not_configured", "El servicio de línea base no está configurado (falta ML_SERVICE_URL)");

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new MlServiceError(
      timedOut ? "timeout" : "unreachable",
      timedOut ? "El servicio de línea base no contestó a tiempo (¿está despertando?)" : "No se pudo conectar con el servicio de línea base",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new MlServiceError("unauthorized", "El servicio de línea base rechazó la clave de API", response.status);
  }
  if (response.status >= 500) throw new MlServiceError("server_error", `El servicio de línea base falló (${response.status})`, response.status);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const first = Array.isArray(detail?.detail) ? detail.detail[0]?.msg : detail?.detail;
    throw new MlServiceError("rejected", typeof first === "string" ? first : `El servicio rechazó el pedido (${response.status})`, response.status);
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MlServiceError("bad_response", "El servicio de línea base respondió con un formato inesperado", response.status);
  return parsed.data;
}

export const mlClient = {
  health: (): Promise<ModelHealth> => call("/health", healthSchema, { timeoutMs: HEALTH_TIMEOUT_MS }),

  info: (): Promise<ModelInfo> => call("/info", modelInfoSchema, { timeoutMs: CALL_TIMEOUT_MS }),

  /**
   * Línea base y bandas de un vendedor a partir de SUS PROPIAS primeras 4 semanas con actividad (RF017), y el
   * estado de cada semana posterior contra la banda semanal. Las unidades son días de `margin_days`.
   */
  evaluateSeries: (input: { phase1: ActiveWeek[]; phase2: number[] }): Promise<SeriesEvaluation> =>
    call("/evaluar_serie", seriesEvaluationSchema, {
      method: "POST",
      body: { fase1: input.phase1, fase2: input.phase2 },
      timeoutMs: CALL_TIMEOUT_MS,
    }),
};
