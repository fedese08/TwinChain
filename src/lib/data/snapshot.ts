import { asc, inArray } from "drizzle-orm";
import { can, type Member } from "@/lib/auth/session";
import {
  aristas,
  cadenas,
  desempenoSemanal,
  escenarios,
  eventos,
  getDb,
  nodos,
  resultados,
} from "@/lib/db";
import { chainVisibleTo } from "./access";
import { toChain, toEdge, toEvent, toNode, toResult, toScenario, toWeeklyPerformance } from "./mappers";
import type { AppSnapshot } from "./snapshot-types";

/** `inArray` con lista vacía no es SQL válido: si no hay ids, no hay filas. */
async function whenAny<T>(ids: string[], query: () => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? [] : query();
}

export async function loadSnapshot(member: Member): Promise<AppSnapshot> {
  const db = getDb();

  const chainRows = await db.select().from(cadenas).where(chainVisibleTo(member)).orderBy(asc(cadenas.creadoEn));
  const chainIds = chainRows.map((c) => c.id);

  const [nodeRows, scenarioRows] = await Promise.all([
    whenAny(chainIds, () =>
      db.select().from(nodos).where(inArray(nodos.cadenaId, chainIds)).orderBy(asc(nodos.cadenaId), asc(nodos.etiqueta)),
    ),
    whenAny(chainIds, () =>
      db.select().from(escenarios).where(inArray(escenarios.cadenaId, chainIds)).orderBy(asc(escenarios.creadoEn)),
    ),
  ]);
  const nodeIds = nodeRows.map((n) => n.id);
  const scenarioIds = scenarioRows.map((s) => s.id);

  const [edgeRows, weeklyRows, eventRows, resultRows] = await Promise.all([
    whenAny(nodeIds, () => db.select().from(aristas).where(inArray(aristas.nodoOrigenId, nodeIds))),
    whenAny(nodeIds, () =>
      db.select().from(desempenoSemanal).where(inArray(desempenoSemanal.nodoId, nodeIds)).orderBy(asc(desempenoSemanal.semana)),
    ),
    whenAny(scenarioIds, () => db.select().from(eventos).where(inArray(eventos.escenarioId, scenarioIds))),
    // Las corridas se ordenan por `creado_en`: el orden del array es el orden en que corrieron (RF030).
    whenAny(scenarioIds, () =>
      db.select().from(resultados).where(inArray(resultados.escenarioId, scenarioIds)).orderBy(asc(resultados.creadoEn)),
    ),
  ]);

  return {
    userId: member.id,
    organizationName: member.organizacionNombre,
    canWrite: can(member, "chain:write"),
    canRun: can(member, "scenario:run"),
    chains: chainRows.map(toChain),
    nodes: nodeRows.map(toNode),
    edges: edgeRows.map(toEdge),
    weeklyPerformance: weeklyRows.map(toWeeklyPerformance),
    scenarios: scenarioRows.map(toScenario),
    events: eventRows.map(toEvent),
    results: resultRows.map(toResult),
  };
}
