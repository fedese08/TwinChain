import { after, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toEvent, toScenario } from "@/lib/data/mappers";
import { assertScenarioCapacity, lockOrganization, PlanLimitError, planLimitResponse } from "@/lib/data/plan-limits";
import { escenarios, eventos, getDb, nodos, resultados } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { hashSeed } from "@/lib/domain/rng";
import { executeRun } from "@/lib/simulation/background-run";
import { assertSimulationFits, SimulationTooLargeError, simulationTooLargeBody } from "@/lib/simulation/run-scenario";
import { createScenarioSchema } from "@/lib/validators/scenario-api";

// El motor corre en segundo plano (`after()`), dentro del tiempo de esta función. 300 s es el máximo de una función en el
// plan Hobby de Vercel (en Pro llega a 800; un valor mayor al del plan hace FALLAR el build).
// La salvaguarda real es `MAX_SIMULATION_WORK`, calibrada para usar menos de la mitad.
export const maxDuration = 300;

/**
 * Crea el escenario con sus eventos y lanza la primera simulación como job en segundo plano. Responde 202 apenas queda
 * guardada la corrida en estado `corriendo`; la pantalla consulta `GET /api/escenarios/[id]/corridas/[runId]` hasta que
 * está lista. Todo o nada: si el motor falla, el job descarta la corrida y el escenario (ver `background-run.ts`).
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

  // Todos los nodos afectados tienen que ser de ESTA cadena (no alcanza con que sean de la organización).
  const nodeIds = [...new Set(input.events.map((e) => e.nodeId))];
  const found = await db
    .select({ id: nodos.id })
    .from(nodos)
    .where(and(inArray(nodos.id, nodeIds), eq(nodos.cadenaId, input.chainId)));
  if (found.length !== nodeIds.length) {
    return NextResponse.json({ error: "Un nodo afectado no pertenece a esta cadena" }, { status: 400 });
  }

  const events = input.events.map((e) => ({
    id: e.id,
    scenarioId: input.id,
    nodeId: e.nodeId,
    eventType: e.eventType,
    startDate: e.startDate,
    magnitude: e.magnitude,
  }));

  // Se rechaza ANTES de lanzar el job si la corrida costaría más de lo que admite el servidor.
  try {
    await assertSimulationFits(db, { chainId: input.chainId, horizonWeeks: input.projectionHorizonWeeks, events, decisionWeek: input.decisionWeek });
  } catch (error) {
    if (error instanceof SimulationTooLargeError) return NextResponse.json(simulationTooLargeBody(error), { status: 422 });
    throw error;
  }

  const runId = crypto.randomUUID();

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
          semanaDecision: input.decisionWeek ?? null,
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
      // La corrida nace `corriendo` y vacía; el job la completa. La semilla sale de su id, como siempre (RF030).
      const [run] = await tx
        .insert(resultados)
        .values({
          id: runId,
          escenarioId: input.id,
          fechaCorrida: new Date().toISOString().slice(0, 10),
          tablaK: [],
          replicas: 0,
          semilla: hashSeed(runId),
          semanaReconfiguracion: null,
          estado: "corriendo",
        })
        .returning({ id: resultados.id, creadoEn: resultados.creadoEn });
      return { scenario, eventRows, run };
    });

    after(() =>
      executeRun(db, runId, {
        scenarioId: input.id,
        chainId: input.chainId,
        horizonWeeks: input.projectionHorizonWeeks,
        events,
        reconfigurationWeekIndex: null,
        decisionWeek: input.decisionWeek,
      }),
    );

    return NextResponse.json(
      { scenario: toScenario(created.scenario), events: created.eventRows.map(toEvent), run: { id: created.run.id, startedAt: created.run.creadoEn.getTime() } },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error);
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Ese escenario ya existe" }, { status: 409 });
    throw error;
  }
}
