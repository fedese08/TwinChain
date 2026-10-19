// Monitoreo vivo del Digital Twin: avanza el tiempo simulado de una cadena.
//
// Vercel no sostiene un proceso continuo, así que no hay un "reloj" en el servidor: el navegador pide una
// semana nueva por vez (1 semana = 1 tick). Cada llamada es una función pura de lo ya guardado — la serie
// de cada nodo se continúa a partir de su historial — por eso el resultado no depende de cómo se parta
// el avance ni de cuántas veces se repita.
import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, getDb, nodos } from "@/lib/db";
import { advanceNode, HISTORY_WEEKS, MAX_WEEKS_PER_NODE } from "@/lib/domain/synthetic";
import type { NodeType } from "@/lib/domain/types";
import { advanceVendedor } from "@/lib/domain/vendedor/history";
import { getSellerWeeks } from "@/lib/olist/sample";
import { advanceChainSchema } from "@/lib/validators/chain-api";

async function loadChainRows(db: ReturnType<typeof getDb>, chainId: string) {
  const nodeRows = await db.select({ id: nodos.id, tipo: nodos.tipo, olistSellerId: nodos.vendedorOlistId }).from(nodos).where(eq(nodos.cadenaId, chainId));
  const rows = nodeRows.length
    ? await db
        .select()
        .from(desempenoSemanal)
        .where(inArray(desempenoSemanal.nodoId, nodeRows.map((n) => n.id)))
        .orderBy(asc(desempenoSemanal.nodoId), asc(desempenoSemanal.semana))
    : [];
  return { nodeRows, rows };
}

/** Avanza `weeks` semanas el desempeño de TODOS los nodos de la cadena. */
export async function POST(request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const body = await readJson(request, advanceChainSchema);
  if (!body.ok) return body.response;
  const { weeks } = body.data;

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const { nodeRows, rows } = await loadChainRows(db, chainId);
  const rowsByNode = new Map<string, typeof rows>();
  for (const row of rows) rowsByNode.set(row.nodoId, [...(rowsByNode.get(row.nodoId) ?? []), row]);

  if (rowsByNode.size === 0) {
    return NextResponse.json(
      { error: "La cadena todavía no tiene historial de desempeño para avanzar.", code: "no_history" },
      { status: 409 },
    );
  }
  const longest = Math.max(...[...rowsByNode.values()].map((r) => r.length));
  if (longest + weeks > MAX_WEEKS_PER_NODE) {
    return NextResponse.json(
      {
        error: `Se alcanzó el máximo de ${MAX_WEEKS_PER_NODE} semanas por nodo. Reiniciá el monitoreo para volver al historial original.`,
        code: "max_weeks",
      },
      { status: 409 },
    );
  }

  const next = nodeRows.flatMap((node) => {
    const own = rowsByNode.get(node.id);
    if (!own || own.length === 0) return [];
    const last = own[own.length - 1];
    if (node.olistSellerId) {
      // Vendedor con datos reales (días): sigue por sus semanas reales y, agotadas, por una simulación anclada a su nivel.
      const history = own.map((r) => r.valorReal);
      return advanceVendedor(
        {
          nodeId: node.id,
          history,
          realMargins: getSellerWeeks(node.olistSellerId)?.map((w) => w.margen) ?? history,
          lastWeekStart: last.semana,
          baseline: {
            baseline: last.lineaBase,
            lower: last.bandaInferior,
            upper: last.bandaSuperior,
            weeklyLower: last.bandaSemanalInferior ?? undefined,
            weeklyUpper: last.bandaSemanalSuperior ?? undefined,
            source: "ml",
          },
        },
        weeks,
      );
    }
    return advanceNode(
      {
        nodeId: node.id,
        nodeType: node.tipo as NodeType,
        history: own.map((r) => r.valorReal),
        lastWeekStart: last.semana,
        // La línea base y su banda están congeladas: se copian de lo ya registrado, nunca se recalculan.
        baseline: last.lineaBase,
        baselineLowerBand: last.bandaInferior,
        baselineUpperBand: last.bandaSuperior,
      },
      weeks,
    );
  });

  // `onConflictDoNothing`: si dos llamadas calculan la misma semana a la vez (doble clic, dos pestañas),
  // gana una y la otra no duplica nada — el índice único (nodo, semana) lo garantiza.
  const inserted = await db
    .insert(desempenoSemanal)
    .values(
      next.map((r) => ({
        nodoId: r.nodeId,
        semana: r.weekStart,
        valorReal: r.actualValue,
        lineaBase: r.baseline,
        bandaInferior: r.baselineLowerBand,
        bandaSuperior: r.baselineUpperBand,
        bandaSemanalInferior: r.weeklyBandLower ?? null,
        bandaSemanalSuperior: r.weeklyBandUpper ?? null,
        deficit: r.deficit,
      })),
    )
    .onConflictDoNothing()
    .returning();

  return NextResponse.json({ weeklyPerformance: inserted.map(toWeeklyPerformance) });
}

/**
 * Reinicia el monitoreo: borra las semanas avanzadas y deja cada nodo con su historial original.
 * Devuelve las filas que quedan para que el cliente reemplace su copia.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const { rows } = await loadChainRows(db, chainId);
  const byNode = new Map<string, typeof rows>();
  for (const row of rows) byNode.set(row.nodoId, [...(byNode.get(row.nodoId) ?? []), row]);

  const advancedIds: string[] = [];
  const kept: typeof rows = [];
  for (const own of byNode.values()) {
    kept.push(...own.slice(0, HISTORY_WEEKS));
    advancedIds.push(...own.slice(HISTORY_WEEKS).map((r) => r.id));
  }
  for (let i = 0; i < advancedIds.length; i += 1000) {
    await db.delete(desempenoSemanal).where(inArray(desempenoSemanal.id, advancedIds.slice(i, i + 1000)));
  }

  return NextResponse.json({ weeklyPerformance: kept.map(toWeeklyPerformance), removed: advancedIds.length });
}
