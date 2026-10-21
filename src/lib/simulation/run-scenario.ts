// Ejecuta el motor de simulación en el servidor y arma la fila de `resultados`.
// El motor (`lib/domain/simulate.ts`) se usa TAL CUAL: acá solo se le arman las entradas y se
// guarda lo que devuelve. Sus decisiones metodológicas pendientes (tabla_k, piso de propagación)
// no se tocan al moverlo de lugar.
import { asc, eq, inArray } from "drizzle-orm";
import { toEdge, toKTableRows, toNode, toWeeklyPerformance } from "@/lib/data/mappers";
import { aristas, desempenoSemanal, nodos, type Database, type ResultadoRow } from "@/lib/db";
import { hashSeed } from "@/lib/domain/rng";
import { estimateSimulationWork, observedForScenario, runScenarioSimulation } from "@/lib/domain/simulate";
import type { DisruptionEvent } from "@/lib/domain/types";
import { adaptForEngine } from "@/lib/domain/units";

/**
 * Tope de trabajo de una corrida, en las unidades de `estimateSimulationWork`
 * (réplicas × fracciones × 3 pasadas × semanas × (aristas + nodos alcanzados)).
 *
 * Calibrado con `scripts/bench-engine.ts` sobre el motor de recurrencia semanal: una unidad cuesta ~1,3 ns en una
 * Apple M4 (300 nodos conectados todos con todos, 16 semanas: 195 M unidades en 0,25 s) y ~3,3 veces más en Vercel
 * (docs/rendimiento-motor-vercel.md). Con 1.000 M de unidades el peor caso admitido son ~1,3 s locales y ~4,3 s en
 * Vercel: muy por debajo de la mitad de `maxDuration` (300 s, plan Hobby). Con los topes del plan Max (100 nodos,
 * 52 semanas) el peor caso posible ronda los 140 M: este control no se dispara hoy, protege contra una red
 * desproporcionada y contra los topes que suban después.
 */
export const MAX_SIMULATION_WORK = 1_000_000_000;

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

/** Entradas de una corrida (las mismas para la verificación de tamaño y para la corrida). */
export interface RunInput {
  scenarioId: string;
  chainId: string;
  horizonWeeks: number;
  events: DisruptionEvent[];
  reconfigurationWeekIndex: number | null;
  /** Semana de la decisión (s_r) de una simulación desde una alerta; ausente = simulación manual. */
  decisionWeek?: string | null;
}

/** Semanas observadas entre el inicio de los eventos y s_r: también se propagan y cuentan para el costo. */
function pastWeeksOf(input: Pick<RunInput, "events" | "decisionWeek">): number {
  if (!input.decisionWeek) return 0;
  const decision = Date.parse(input.decisionWeek);
  return Math.max(0, ...input.events.map((e) => Math.round((decision - Date.parse(e.startDate)) / (7 * 86400000))));
}

/**
 * Verifica, sin correr nada, que la corrida no exceda `MAX_SIMULATION_WORK`. Lee solo las aristas de la cadena (no el
 * desempeño), así que es barata: sirve para rechazar en el pedido, antes de lanzar la corrida en segundo plano.
 */
export async function assertSimulationFits(db: Database, input: Omit<RunInput, "scenarioId" | "reconfigurationWeekIndex">): Promise<void> {
  const nodeRows = await db.select({ id: nodos.id }).from(nodos).where(eq(nodos.cadenaId, input.chainId));
  const nodeIds = nodeRows.map((n) => n.id);
  const edgeRows = nodeIds.length ? await db.select().from(aristas).where(inArray(aristas.nodoOrigenId, nodeIds)) : [];
  if (estimateSimulationWork(edgeRows.map(toEdge), input.events, input.horizonWeeks, undefined, pastWeeksOf(input)) > MAX_SIMULATION_WORK) {
    throw new SimulationTooLargeError();
  }
}

/**
 * Lee la cadena tal como está AHORA (nodos, aristas y desempeño) y corre el escenario sobre ella.
 * Lanza `SimulationTooLargeError` sin correr nada si la corrida excede `MAX_SIMULATION_WORK`.
 * `resultId` fija el id de la corrida (la semilla sale de él); sin él se genera uno.
 */
export async function runScenarioOnChain(db: Database, input: RunInput & { resultId?: string }): Promise<NewResult> {
  const nodeRows = await db.select().from(nodos).where(eq(nodos.cadenaId, input.chainId));
  const nodeIds = nodeRows.map((n) => n.id);

  const [edgeRows, weeklyRows] = nodeIds.length
    ? await Promise.all([
        db.select().from(aristas).where(inArray(aristas.nodoOrigenId, nodeIds)),
        db.select().from(desempenoSemanal).where(inArray(desempenoSemanal.nodoId, nodeIds)).orderBy(asc(desempenoSemanal.semana)),
      ])
    : [[], []];

  const edges = edgeRows.map(toEdge);
  const decisionWeek = input.decisionWeek ?? undefined;
  if (estimateSimulationWork(edges, input.events, input.horizonWeeks, undefined, pastWeeksOf(input)) > MAX_SIMULATION_WORK) {
    throw new SimulationTooLargeError();
  }

  // El id de la corrida se decide ANTES de correr: la semilla sale de él, y con semilla +
  // réplicas la corrida se puede reproducir exacta (RF030).
  const resultId = input.resultId ?? crypto.randomUUID();
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
    {
      seed,
      reconfigurationWeekIndex: input.reconfigurationWeekIndex,
      decisionWeek,
      observed: observedForScenario(adapter.rows, input.events, decisionWeek),
    },
  );

  return {
    id: resultId,
    escenarioId: input.scenarioId,
    fechaCorrida: new Date().toISOString().slice(0, 10),
    tablaK: toKTableRows(outcome.kTable),
    replicas: outcome.replications, // por fracción de propagación
    semilla: seed,
    semanaReconfiguracion: outcome.reconfigurationWeekIndex,
  };
}
