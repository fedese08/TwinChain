import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toNode } from "@/lib/data/mappers";
import { getDb, nodos } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { MAX_NODES_PER_CHAIN } from "@/lib/domain/types";
import { chainLatestWeek, ingestNodeHistory } from "@/lib/ingestion/ingest-history";
import { prepareSensorBaselines, prepareVendedorPlans, type VendedorPlan } from "@/lib/ingestion/vendedor-setup";
import { lastCompleteWeek } from "@/lib/domain/synthetic";
import { createNodeSchema } from "@/lib/validators/chain-api";

export async function POST(request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const body = await readJson(request, createNodeSchema);
  if (!body.ok) return body.response;
  const { id, tipo, etiqueta, x, y } = body.data;

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const [{ total }] = await db.select({ total: count() }).from(nodos).where(eq(nodos.cadenaId, chainId));
  if (total >= MAX_NODES_PER_CHAIN) {
    return NextResponse.json({ error: `Una cadena admite hasta ${MAX_NODES_PER_CHAIN} nodos` }, { status: 409 });
  }

  // Un Vendedor usa datos reales de Olist y la línea base del modelo de ML: se prepara ANTES de la transacción
  // (no se deja abierta mientras se espera la red) y evita los vendedores que la cadena ya usa.
  let vendedorPlan: VendedorPlan | undefined;
  if (tipo === "Vendedor") {
    const used = await db.select({ id: nodos.vendedorOlistId }).from(nodos).where(eq(nodos.cadenaId, chainId));
    const plans = await prepareVendedorPlans([id], new Set(used.flatMap((u) => (u.id ? [u.id] : []))));
    vendedorPlan = plans.get(id);
  }

  // El sensor del nodo nuevo termina en la misma semana que el resto de la cadena; el modelo estima su línea base
  // con sus primeras semanas, también ANTES de la transacción.
  const endWeek = (await chainLatestWeek(db, chainId)) ?? lastCompleteWeek();
  const baseline = vendedorPlan ? undefined : (await prepareSensorBaselines([{ id, tipo }], endWeek)).get(id);

  try {
    // El nodo y su historial se guardan juntos: un nodo nunca queda sin datos de desempeño.
    const created = await db.transaction(async (tx) => {
      await tx.insert(nodos).values({ id, tipo, cadenaId: chainId, etiqueta, posX: x, posY: y });
      const weeklyPerformance = await ingestNodeHistory(tx, { id, tipo }, chainId, { plan: vendedorPlan, baseline, endWeek });
      const [row] = await tx.select().from(nodos).where(eq(nodos.id, id));
      return { row, weeklyPerformance };
    });
    return NextResponse.json({ node: toNode(created.row), weeklyPerformance: created.weeklyPerformance }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Ese nodo ya existe" }, { status: 409 });
    throw error;
  }
}
