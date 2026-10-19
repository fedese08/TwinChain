// Prepara los nodos Vendedor con datos REALES de Olist: asigna un vendedor a cada nodo y resuelve su línea base.
//
// Corre ANTES de abrir la transacción de base de datos: llamar al servicio de ML dentro de una transacción la
// tendría abierta mientras espera la red (en Render gratis, hasta un minuto si el servicio estaba dormido).
import { HISTORY_WEEKS } from "@/lib/domain/synthetic";
import { assignSellers } from "@/lib/domain/vendedor/assign";
import { baselineFromModel, PHASE1_WEEKS, provisionalVendedorBaseline, type VendedorBaseline } from "@/lib/domain/vendedor/baseline";
import type { VendedorSetup } from "@/lib/domain/synthetic";
import type { RealWeek } from "@/lib/domain/vendedor/history";
import { mlClient, MlServiceError } from "@/lib/ml-client";
import { getSellerWeeks, poolSellers } from "@/lib/olist/sample";

/**
 * Cuánto se espera al modelo al crear una cadena o un nodo. Es corto a propósito: si el servicio está dormido no se
 * hace esperar a nadie un minuto, se usa la línea base provisoria (marcada como tal) y se puede actualizar después.
 */
export const ML_BASELINE_TIMEOUT_MS = 10_000;

export interface VendedorPlan {
  sellerId: string;
  setup: VendedorSetup;
}

/** Línea base de un vendedor: la del modelo si el servicio contesta a tiempo y, si no, la provisoria. Nunca falla. */
export async function resolveVendedorBaseline(realWeeks: RealWeek[], timeoutMs: number = ML_BASELINE_TIMEOUT_MS): Promise<VendedorBaseline> {
  const phase1 = realWeeks.slice(0, PHASE1_WEEKS);
  try {
    const prediction = await mlClient.predict({
      phase1: phase1.map((w) => ({ margin_mean: w.margen, n_items: w.items })),
      timeoutMs,
    });
    return baselineFromModel(prediction);
  } catch (error) {
    // Que el servicio no esté configurado es un estado normal; cualquier otra cosa merece un aviso en el log.
    if (!(error instanceof MlServiceError && error.code === "not_configured")) {
      console.warn("[ingesta] Línea base provisoria: el modelo no contestó.", error instanceof MlServiceError ? error.code : error);
    }
    return provisionalVendedorBaseline(phase1.map((w) => w.margen));
  }
}

/**
 * Un plan por nodo Vendedor: el vendedor real asignado, su historial y su línea base. `usedSellerIds` son los
 * vendedores que la cadena ya usa, para no repetirlos.
 */
export async function prepareVendedorPlans(nodeIds: string[], usedSellerIds: ReadonlySet<string> = new Set()): Promise<Map<string, VendedorPlan>> {
  if (nodeIds.length === 0) return new Map();
  const assignment = assignSellers(nodeIds, poolSellers(), usedSellerIds, HISTORY_WEEKS);

  const plans = await Promise.all(
    [...assignment].map(async ([nodeId, sellerId]): Promise<[string, VendedorPlan]> => {
      const realWeeks = getSellerWeeks(sellerId)!;
      return [nodeId, { sellerId, setup: { realWeeks, baseline: await resolveVendedorBaseline(realWeeks) } }];
    }),
  );
  return new Map(plans);
}
