// Actualiza con el modelo de ML las líneas base que quedaron PROVISORIAS.
//
// Al crear una cadena el modelo tiene 10 s para contestar; si el servicio estaba dormido (Render gratis) el nodo
// Vendedor queda con una línea base provisoria, marcada como tal. Esto la reemplaza por la del modelo, a pedido.
//
// No contradice la línea base congelada: lo congelado es que NO se recalcule con las semanas que se van
// monitoreando. Acá la línea base sigue siendo función de las mismas 4 semanas de Fase I; cambia el estimador
// (de provisorio a modelo), una sola vez por nodo, y los nodos que ya tienen la del modelo no se tocan.
import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { isUuid, notFound } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toNode, toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, getDb, nodos } from "@/lib/db";
import { resolveVendedorBaseline } from "@/lib/ingestion/vendedor-setup";
import { CALL_TIMEOUT_MS } from "@/lib/ml-client";
import { getSellerWeeks } from "@/lib/olist/sample";

// Acá el usuario lo pidió a propósito: se espera el arranque en frío del servicio.
export const maxDuration = 90;

export async function POST(_request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const provisional = await db
    .select({ id: nodos.id, sellerId: nodos.vendedorOlistId })
    .from(nodos)
    .where(and(eq(nodos.cadenaId, chainId), eq(nodos.fuenteLineaBase, "provisoria"), isNotNull(nodos.vendedorOlistId)));

  const resolved = await Promise.all(
    provisional.map(async (node) => {
      const weeks = node.sellerId ? getSellerWeeks(node.sellerId) : undefined;
      return { node, baseline: weeks ? await resolveVendedorBaseline(weeks, CALL_TIMEOUT_MS) : null };
    }),
  );
  const upgraded = resolved.flatMap((r) => (r.baseline?.source === "ml" ? [{ id: r.node.id, baseline: r.baseline }] : []));

  if (upgraded.length > 0) {
    await db.transaction(async (tx) => {
      for (const { id, baseline } of upgraded) {
        await tx
          .update(desempenoSemanal)
          .set({
            lineaBase: baseline.baseline,
            bandaInferior: baseline.lower,
            bandaSuperior: baseline.upper,
            bandaSemanalInferior: baseline.weeklyLower ?? null,
            bandaSemanalSuperior: baseline.weeklyUpper ?? null,
            deficit: sql`greatest(${baseline.baseline} - ${desempenoSemanal.valorReal}, 0)`,
          })
          .where(eq(desempenoSemanal.nodoId, id));
        await tx.update(nodos).set({ fuenteLineaBase: "ml" }).where(eq(nodos.id, id));
      }
    });
  }

  const ids = upgraded.map((u) => u.id);
  const [nodeRows, rows] = await Promise.all([
    Promise.all(ids.map((id) => db.select().from(nodos).where(eq(nodos.id, id)).then(([n]) => n))),
    Promise.all(ids.map((id) => db.select().from(desempenoSemanal).where(eq(desempenoSemanal.nodoId, id)))),
  ]);

  return NextResponse.json({
    updated: upgraded.length,
    stillProvisional: provisional.length - upgraded.length,
    nodes: nodeRows.map(toNode),
    weeklyPerformance: rows.flat().map(toWeeklyPerformance),
  });
}
