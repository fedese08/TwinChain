import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { mlClient, MlServiceError, type MlErrorCode } from "@/lib/ml-client";
import { buildSellerExploration } from "@/lib/olist/explore";
import { getSeller, PHASE1_WEEKS } from "@/lib/olist/sample";

// Si el servicio estaba dormido (Render gratis), el primer pedido espera su arranque.
export const maxDuration = 90;

const requestSchema = z.object({ sellerId: z.string().min(1).max(64) });

const HTTP_STATUS: Record<MlErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  unreachable: 503,
  unauthorized: 502,
  rejected: 502,
  server_error: 502,
  bad_response: 502,
};

/**
 * Línea base y banda de un vendedor REAL de Olist a partir de sus primeras 4 semanas con actividad (RF017),
 * y el estado de cada semana posterior contra la banda semanal. Las unidades son días de margen.
 */
export async function POST(request: Request) {
  const access = await requireApiMember();
  if (!access.ok) return access.response;

  const body = await readJson(request, requestSchema);
  if (!body.ok) return body.response;

  const seller = getSeller(body.data.sellerId);
  if (!seller) return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 });

  try {
    const evaluation = await mlClient.evaluateSeries({
      phase1: seller.semanas.slice(0, PHASE1_WEEKS).map((w) => ({ margin_mean: w.margen, n_items: w.items })),
      phase2: seller.semanas.slice(PHASE1_WEEKS).map((w) => w.margen),
    });
    return NextResponse.json(buildSellerExploration(seller, evaluation));
  } catch (error) {
    if (error instanceof MlServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: HTTP_STATUS[error.code] });
    }
    throw error;
  }
}
