import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toEvent, toResult, toScenario } from "@/lib/data/mappers";
import { assertScenarioCapacity, lockOrganization, PlanLimitError, planLimitResponse } from "@/lib/data/plan-limits";
import { escenarios, eventos, getDb, nodos, resultados } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { runScenarioOnChain, SimulationTooLargeError, simulationTooLargeBody } from "@/lib/simulation/run-scenario";
import { createScenarioSchema } from "@/lib/validators/scenario-api";

// El motor corre dentro de este request. 300 s es el máximo de una función en el plan Hobby de
// Vercel (en Pro llega a 800; un valor mayor al del plan hace FALLAR el build).
// La salvaguarda real es `MAX_SIMULATION_WORK`, calibrada para usar menos de la mitad.
export const maxDuration = 300;

/**
 * Crea el escenario con sus eventos y corre la primera simulación, todo o nada: si el motor
 * falla no queda un escenario sin resultado. La corrida se ejecuta y se guarda acá, en el servidor.
 */
export async function POST(request: Request) {
  const access = await requireApiMember("scenario:run");
  if (!access.ok) return access.response;
  const { user } = access;

  const body = await readJson(request, createScenarioSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  const db = getDb();
  if (!(await findVisibleChain(db, user, input.chainId))) return notFound("Cadena no encontrada");

  // Tope de escenarios guardados del plan: se mira ANTES de correr la simulación y otra vez dentro de la transacción.
  try {
    await assertScenarioCapacity(db, user);
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error);
    throw error;
  }

  // El nodo afectado tiene que ser de ESTA cadena (no alcanza con que sea de la organización).
  const [node] = await db
    .select({ id: nodos.id })
    .from(nodos)
    .where(and(eq(nodos.id, input.nodeId), eq(nodos.cadenaId, input.chainId)))
    .limit(1);
  if (!node) return NextResponse.json({ error: "El nodo afectado no pertenece a esta cadena" }, { status: 400 });

  const events = input.events.map((e) => ({
    id: e.id,
    scenarioId: input.id,
    nodeId: input.nodeId,
    eventType: e.eventType,
    startDate: e.startDate,
    magnitude: e.magnitude,
  }));

  let run: Awaited<ReturnType<typeof runScenarioOnChain>>;
  try {
    run = await runScenarioOnChain(db, {
      scenarioId: input.id,
      chainId: input.chainId,
      horizonWeeks: input.projectionHorizonWeeks,
      events,
      reconfigurationWeekIndex: null,
    });
  } catch (error) {
    if (error instanceof SimulationTooLargeError) return NextResponse.json(simulationTooLargeBody(error), { status: 422 });
    throw error;
  }

  try {
    const created = await db.transaction(async (tx) => {
      await lockOrganization(tx, user.organizacionId);
      await assertScenarioCapacity(tx, user);
      const [scenario] = await tx
        .insert(escenarios)
        .values({
          id: input.id,
          nombre: input.name,
          horizonteProyeccion: input.projectionHorizonWeeks,
          usuarioId: user.id,
          cadenaId: input.chainId,
        })
        .returning();
      const eventRows = await tx
        .insert(eventos)
        .values(
          events.map((e) => ({
            id: e.id,
            tipo: e.eventType,
            fechaInicio: e.startDate,
            magnitud: e.magnitude,
            nodoId: e.nodeId,
            escenarioId: e.scenarioId,
          })),
        )
        .returning();
      const [result] = await tx.insert(resultados).values(run).returning();
      return { scenario, eventRows, result };
    });

    return NextResponse.json(
      { scenario: toScenario(created.scenario), events: created.eventRows.map(toEvent), result: toResult(created.result) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error);
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Ese escenario ya existe" }, { status: 409 });
    throw error;
  }
}
