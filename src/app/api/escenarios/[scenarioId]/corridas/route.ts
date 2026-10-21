import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleScenario } from "@/lib/data/access";
import { toEvent } from "@/lib/data/mappers";
import { eventos, getDb, resultados } from "@/lib/db";
import { hashSeed } from "@/lib/domain/rng";
import { executeRun } from "@/lib/simulation/background-run";
import { assertSimulationFits, SimulationTooLargeError, simulationTooLargeBody } from "@/lib/simulation/run-scenario";
import { rerunScenarioSchema } from "@/lib/validators/scenario-api";

// Mismo criterio que POST /api/escenarios: el motor corre en segundo plano, ver el comentario de `maxDuration` ahí.
export const maxDuration = 300;

/**
 * Vuelve a correr un escenario y AGREGA una corrida nueva: nunca pisa las anteriores (RF030). Con
 * `reconfigurationWeekIndex` aplica el escalón de reconfiguración (RF022). Como la primera corrida, se lanza en segundo
 * plano: responde 202 y la pantalla consulta hasta que está lista.
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
  const events = eventRows.map(toEvent);

  try {
    // Puede pasar si la cadena creció desde la primera corrida (más nodos o aristas).
    await assertSimulationFits(db, {
      chainId: escenario.cadenaId,
      horizonWeeks: escenario.horizonteProyeccion,
      events,
      decisionWeek: escenario.semanaDecision,
    });
  } catch (error) {
    if (error instanceof SimulationTooLargeError) return NextResponse.json(simulationTooLargeBody(error), { status: 422 });
    throw error;
  }

  const runId = crypto.randomUUID();
  const [run] = await db
    .insert(resultados)
    .values({
      id: runId,
      escenarioId: scenarioId,
      fechaCorrida: new Date().toISOString().slice(0, 10),
      tablaK: [],
      replicas: 0,
      semilla: hashSeed(runId),
      semanaReconfiguracion: reconfigurationWeekIndex,
      estado: "corriendo",
    })
    .returning({ id: resultados.id, creadoEn: resultados.creadoEn });

  after(() =>
    executeRun(db, runId, {
      scenarioId,
      chainId: escenario.cadenaId,
      horizonWeeks: escenario.horizonteProyeccion,
      events,
      reconfigurationWeekIndex,
      decisionWeek: escenario.semanaDecision,
    }),
  );

  return NextResponse.json({ run: { id: run.id, startedAt: run.creadoEn.getTime() } }, { status: 202 });
}
