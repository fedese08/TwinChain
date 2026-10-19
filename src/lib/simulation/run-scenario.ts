// Ejecuta el motor de simulación en el servidor y arma la fila de `resultados`.
// El motor (`lib/domain/simulate.ts`) se usa TAL CUAL: acá solo se le arman las entradas y se
// guarda lo que devuelve. Sus decisiones metodológicas pendientes (tabla_k, piso de propagación)
// no se tocan al moverlo de lugar.
import { asc, eq, inArray } from "drizzle-orm";
import { toEdge, toKTableRows, toNode, toWeeklyPerformance } from "@/lib/data/mappers";
import { aristas, desempenoSemanal, nodos, type Database, type ResultadoRow } from "@/lib/db";
import { hashSeed } from "@/lib/domain/rng";
import { estimateSimulationWork, runScenarioSimulation } from "@/lib/domain/simulate";
import type { DisruptionEvent } from "@/lib/domain/types";
import { adaptForEngine } from "@/lib/domain/units";

/**
 * Tope de trabajo de una corrida, en las unidades de `estimateSimulationWork`.
 *
 * Calibrado en docs/rendimiento-motor.md: localmente cada unidad cuesta entre 74 y 730 ns según
 * la topología. 50 M unidades son ≤ ~37 s en esa máquina y, suponiendo una CPU de Vercel hasta 3
 * veces más lenta, ≤ ~110 s: por debajo de la mitad de `maxDuration` (300 s, plan Hobby), que es el
 * margen que pide el criterio del tope de Max. Con los límites actuales (50 nodos, 20 eventos, 52
 * semanas, 30 réplicas) el peor caso posible ronda los 3 M: este tope no se dispara hoy, protege
 * para cuando suban los nodos por plan o las réplicas (200-300, C36).
 */
export const MAX_SIMULATION_WORK = 50_000_000;

/** La corrida se rechaza ANTES de ejecutarla porque costaría más de lo que admite el servidor. */
export class SimulationTooLargeError extends Error {
  constructor() {
    super(
      "Esta simulación es demasiado grande para correrla: la red está muy interconectada para la cantidad de " +
        "eventos y el horizonte elegidos. Probá con menos eventos o un horizonte más corto.",
    );
    this.name = "SimulationTooLargeError";
  }
}

type NewResult = Pick<
  ResultadoRow,
  "id" | "escenarioId" | "fechaCorrida" | "tablaK" | "replicas" | "semilla" | "semanaReconfiguracion"
>;

/** Respuesta HTTP para una corrida rechazada por tamaño: 422, no 500 — la entrada es válida pero inviable. */
export function simulationTooLargeBody(error: SimulationTooLargeError) {
  return { error: error.message, code: "simulation_too_large" } as const;
}

/**
 * Lee la cadena tal como está AHORA (nodos, aristas y desempeño) y corre el escenario sobre ella.
 * Lanza `SimulationTooLargeError` sin correr nada si la corrida excede `MAX_SIMULATION_WORK`.
 */
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

  const edges = edgeRows.map(toEdge);
  if (estimateSimulationWork(edges, input.events, input.horizonWeeks) > MAX_SIMULATION_WORK) {
    throw new SimulationTooLargeError();
  }

  // El id de la corrida se decide ANTES de correr: la semilla sale de él, y con semilla +
  // réplicas la corrida se puede reproducir exacta (RF030).
  const resultId = crypto.randomUUID();
  const seed = hashSeed(resultId);

  // Los nodos Vendedor con datos reales están en días: se pasan a escala relativa a su línea base ANTES del motor
  // (ver domain/units.ts). Los nodos en 0-100 pasan sin tocar, así que sus resultados no cambian.
  const nodes = nodeRows.map(toNode);
  const adapter = adaptForEngine(nodes, weeklyRows.map(toWeeklyPerformance));

  const outcome = runScenarioSimulation(
    nodes,
    edges,
    input.events,
    adapter.rows,
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
