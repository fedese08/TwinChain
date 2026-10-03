// Ejecuta el motor de simulación en el servidor y arma la fila de `resultados`.
// El motor (`lib/domain/simulate.ts`) se usa TAL CUAL: acá solo se le arman las entradas y se
// guarda lo que devuelve. Sus decisiones metodológicas pendientes (tabla_k, piso de propagación)
// no se tocan al moverlo de lugar.
import { asc, eq, inArray } from "drizzle-orm";
import { toEdge, toKTableRows, toNode, toWeeklyPerformance } from "@/lib/data/mappers";
import { aristas, desempenoSemanal, nodos, type Database, type ResultadoRow } from "@/lib/db";
import { hashSeed } from "@/lib/domain/rng";
import { runScenarioSimulation } from "@/lib/domain/simulate";
import type { DisruptionEvent } from "@/lib/domain/types";

type NewResult = Pick<
  ResultadoRow,
  "id" | "escenarioId" | "fechaCorrida" | "tablaK" | "replicas" | "semilla" | "semanaReconfiguracion"
>;

/** Lee la cadena tal como está AHORA (nodos, aristas y desempeño) y corre el escenario sobre ella. */
export async function runScenarioOnChain(
  db: Database,
  input: {
    scenarioId: string;
    chainId: string;
    horizonWeeks: number;
    events: DisruptionEvent[];
    reconfigurationWeekIndex: number | null;
  },
): Promise<NewResult> {
  const nodeRows = await db.select().from(nodos).where(eq(nodos.cadenaId, input.chainId));
  const nodeIds = nodeRows.map((n) => n.id);

  const [edgeRows, weeklyRows] = nodeIds.length
    ? await Promise.all([
        db.select().from(aristas).where(inArray(aristas.nodoOrigenId, nodeIds)),
        db.select().from(desempenoSemanal).where(inArray(desempenoSemanal.nodoId, nodeIds)).orderBy(asc(desempenoSemanal.semana)),
      ])
    : [[], []];

  // El id de la corrida se decide ANTES de correr: la semilla sale de él, y con semilla +
  // réplicas la corrida se puede reproducir exacta (RF030).
  const resultId = crypto.randomUUID();
  const seed = hashSeed(resultId);

  const outcome = runScenarioSimulation(
    nodeRows.map(toNode),
    edgeRows.map(toEdge),
    input.events,
    weeklyRows.map(toWeeklyPerformance),
    input.horizonWeeks,
    { seed, reconfigurationWeekIndex: input.reconfigurationWeekIndex },
  );

  return {
    id: resultId,
    escenarioId: input.scenarioId,
    fechaCorrida: new Date().toISOString().slice(0, 10),
    tablaK: toKTableRows(outcome.kTable),
    replicas: outcome.replications,
    semilla: seed,
    semanaReconfiguracion: outcome.reconfigurationWeekIndex,
  };
}
