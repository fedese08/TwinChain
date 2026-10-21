// Ingesta de envíos de un nodo desde una fuente real (CSV semanal o sensores): la alternativa al simulador (RF009).
//
// Recibe los envíos individuales de UN nodo, los agrega por semana (RF010) y agrega las filas de desempeño con la línea base
// congelada del nodo (RF014). Todo lo que viene después (el CUSUM, las alertas, la simulación) solo ve las filas
// semanales, así que no cambia nada según de dónde vengan los envíos.
import { NextResponse } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, getDb, nodos } from "@/lib/db";
import { MAX_WEEKS_PER_NODE } from "@/lib/domain/synthetic/config";
import { aggregateShipments, rowsFromBatches } from "@/lib/domain/synthetic";
import { ingestShipmentsSchema } from "@/lib/validators/chain-api";

export async function POST(request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const body = await readJson(request, ingestShipmentsSchema);
  if (!body.ok) return body.response;
  const { nodeId, envios } = body.data;

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const [node] = await db
    .select({ id: nodos.id, fuente: nodos.fuenteLineaBase })
    .from(nodos)
    .where(and(eq(nodos.id, nodeId), eq(nodos.cadenaId, chainId)));
  if (!node) return notFound("Nodo no encontrado");
  if (!node.fuente) {
    return NextResponse.json({ error: "Este nodo mide en escala 0-100 y no recibe envíos en días.", code: "unit_mismatch" }, { status: 409 });
  }

  const history = await db.select().from(desempenoSemanal).where(eq(desempenoSemanal.nodoId, nodeId)).orderBy(desc(desempenoSemanal.semana)).limit(1);
  const [last] = history.map(toWeeklyPerformance);
  if (!last) {
    return NextResponse.json({ error: "El nodo todavía no tiene historial con línea base.", code: "no_history" }, { status: 409 });
  }

  const batches = aggregateShipments(envios.map((e) => ({ date: e.fecha, margin: e.margen })));
  let rows;
  try {
    rows = rowsFromBatches(
      {
        nodeId,
        lastWeekStart: last.weekStart,
        baseline: last.baseline,
        baselineLowerBand: last.baselineLowerBand,
        baselineUpperBand: last.baselineUpperBand,
        weeklyBandLower: last.weeklyBandLower,
        weeklyBandUpper: last.weeklyBandUpper,
      },
      batches,
    );
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ error: error.message, code: "stale_week" }, { status: 409 });
    throw error;
  }

  if (rows.length === 0) return NextResponse.json({ weeklyPerformance: [] });
  const [{ stored }] = await db.select({ stored: count() }).from(desempenoSemanal).where(eq(desempenoSemanal.nodoId, nodeId));
  if (stored + rows.length > MAX_WEEKS_PER_NODE) {
    return NextResponse.json({ error: `Máximo ${MAX_WEEKS_PER_NODE} semanas por nodo.`, code: "max_weeks" }, { status: 409 });
  }

  const inserted = await db
    .insert(desempenoSemanal)
    .values(
      rows.map((r) => ({
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
  return NextResponse.json({ weeklyPerformance: inserted.map(toWeeklyPerformance), items: batches.map((b) => ({ weekStart: b.weekStart, items: b.items })) }, { status: 201 });
}
