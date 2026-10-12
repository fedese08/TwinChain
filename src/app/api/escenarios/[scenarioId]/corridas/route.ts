import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleScenario } from "@/lib/data/access";
import { toEvent, toResult } from "@/lib/data/mappers";
import { eventos, getDb, resultados } from "@/lib/db";
import { runScenarioOnChain, SimulationTooLargeError, simulationTooLargeBody } from "@/lib/simulation/run-scenario";
import { rerunScenarioSchema } from "@/lib/validators/scenario-api";

// Mismo criterio que POST /api/escenarios: ver el comentario de `maxDuration` ahí.
export const maxDuration = 300;

/**
 * Vuelve a correr un escenario y AGREGA una corrida nueva: nunca pisa las anteriores (RF030).
 * Con `reconfigurationWeekIndex` aplica el escalón de reconfiguración (RF022).
 */
export async function POST(request: Request, { params }: { params: Promise<{ scenarioId: string }> }) {
  const access = await requireApiMember("scenario:run");
  if (!access.ok) return access.response;
  const { scenarioId } = await params;
  if (!isUuid(scenarioId)) return notFound("Escenario no encontrado");

  const body = await readJson(request, rerunScenarioSchema);
  if (!body.ok) return body.response;
  const { reconfigurationWeekIndex } = body.data;

  const db = getDb();
  const found = await findVisibleScenario(db, access.user, scenarioId);
  if (!found) return notFound("Escenario no encontrado");

  const { escenario } = found;
  if (reconfigurationWeekIndex !== null && reconfigurationWeekIndex >= escenario.horizonteProyeccion) {
    return NextResponse.json({ error: "La semana de reconfiguración cae fuera del horizonte" }, { status: 400 });
  }

  const eventRows = await db.select().from(eventos).where(eq(eventos.escenarioId, scenarioId));

  let run: Awaited<ReturnType<typeof runScenarioOnChain>>;
  try {
    run = await runScenarioOnChain(db, {
      scenarioId,
      chainId: escenario.cadenaId,
      horizonWeeks: escenario.horizonteProyeccion,
      events: eventRows.map(toEvent),
      reconfigurationWeekIndex,
    });
  } catch (error) {
    // Puede pasar si la cadena creció desde la primera corrida (más nodos o aristas).
    if (error instanceof SimulationTooLargeError) return NextResponse.json(simulationTooLargeBody(error), { status: 422 });
    throw error;
  }

  const [result] = await db.insert(resultados).values(run).returning();
  return NextResponse.json({ result: toResult(result) }, { status: 201 });
}
