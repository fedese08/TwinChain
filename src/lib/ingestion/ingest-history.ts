// Pipeline de ingesta (contenedor de la arquitectura C4): genera el historial de desempeño de los
// nodos que todavía no lo tienen, lo guarda y corre la verificación de estabilidad (C24, decisión 14).
//
// El historial de cada nodo lo reporta su sensor. En una instalación real serían sensores IoT; en esta tesis el
// generador de `lib/domain/synthetic` los simula, en DÍAS de margen de despacho (la métrica del modelo de ML).
// El modelo de ML estima la línea base y las bandas del nodo a partir de sus primeras semanas, sin saber de dónde
// vienen. Esa estimación (`baselines`) la prepara quien llama ANTES de abrir la transacción: ver `vendedor-setup.ts`.
//
// Orígenes que quedan: nodos sin `baselines` (escala anterior, 0-100) y nodos Vendedor con plan de vendedor real de
// Olist (camino inactivo, ver `lib/domain/vendedor/config.ts`).
//
// La base solo entra acá. Quien llama pasa su propia transacción, así que o queda todo (cadena, nodos e
// historial) o no queda nada.
import { and, eq, inArray, max, notExists } from "drizzle-orm";
import { toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, nodos, type Database } from "@/lib/db";
import type { NodeType, WeeklyPerformance } from "@/lib/domain/types";
import { buildChainHistory, buildSingleNodeHistory, type BuildHistoryOptions, type ChainStability, type HistoryNode, type NewWeeklyRow } from "@/lib/domain/synthetic";
import type { NodeBaseline } from "@/lib/domain/vendedor/baseline";
import type { VendedorPlan } from "./vendedor-setup";

/** Una transacción o la base misma. */
type Executor = Pick<Database, "select" | "insert" | "update">;

/** Filas por INSERT: Postgres admite hasta 65.535 parámetros y cada fila usa 9. */
const INSERT_CHUNK_SIZE = 1000;

async function insertRows(db: Executor, rows: NewWeeklyRow[]): Promise<WeeklyPerformance[]> {
  const inserted: WeeklyPerformance[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const saved = await db
      .insert(desempenoSemanal)
      .values(
        chunk.map((r) => ({
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
      .returning();
    inserted.push(...saved.map(toWeeklyPerformance));
  }
  return inserted;
}

/** Deja asentado en el nodo qué vendedor real usa y de dónde salió su línea base. */
async function markVendedorNode(db: Executor, nodeId: string, plan: VendedorPlan): Promise<void> {
  await db
    .update(nodos)
    .set({ vendedorOlistId: plan.sellerId, fuenteLineaBase: plan.setup.baseline.source })
    .where(eq(nodos.id, nodeId));
}

/** Deja asentado en el nodo de dónde salió su línea base (marca, además, que mide en días). */
async function markBaselineSource(db: Executor, nodeId: string, baseline: NodeBaseline): Promise<void> {
  await db.update(nodos).set({ fuenteLineaBase: baseline.source }).where(eq(nodos.id, nodeId));
}

function toHistoryNode(
  node: { id: string; tipo: NodeType },
  plans: ReadonlyMap<string, VendedorPlan>,
  baselines: ReadonlyMap<string, NodeBaseline>,
): HistoryNode {
  const plan = node.tipo === "Vendedor" ? plans.get(node.id) : undefined;
  if (plan) return { id: node.id, type: node.tipo, vendedor: plan.setup };
  const baseline = baselines.get(node.id);
  return baseline ? { id: node.id, type: node.tipo, baseline } : { id: node.id, type: node.tipo };
}

/**
 * Última semana registrada en la cadena, si ya tiene datos. Los nodos que se cargan DESPUÉS tienen que
 * terminar en esa misma semana: si la cadena ya avanzó en el tiempo (monitoreo vivo), un nodo nuevo con
 * historial hasta la semana real quedaría desalineado del resto.
 */
async function chainLatestWeek(db: Executor, chainId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ latest: max(desempenoSemanal.semana) })
    .from(desempenoSemanal)
    .where(inArray(desempenoSemanal.nodoId, db.select({ id: nodos.id }).from(nodos).where(eq(nodos.cadenaId, chainId))));
  return row?.latest ?? undefined;
}

export { chainLatestWeek };

export interface IngestResult {
  weeklyPerformance: WeeklyPerformance[];
  /** `null` si no había nodos sintéticos sin historial para evaluar. */
  stability: ChainStability | null;
}

/**
 * Carga el historial de todos los nodos de la cadena que todavía no tienen ninguno (los que ya lo
 * tienen no se tocan) y devuelve el veredicto de estabilidad de los nodos sintéticos cargados.
 */
export async function ingestChainHistory(
  db: Executor,
  chainId: string,
  options: Pick<BuildHistoryOptions, "withLevelShift"> & {
    vendedorPlans?: ReadonlyMap<string, VendedorPlan>;
    /** Línea base de cada nodo, ya estimada por el modelo (`prepareSensorBaselines`). */
    baselines?: ReadonlyMap<string, NodeBaseline>;
    /** Última semana del historial; debe ser la misma con la que se prepararon `baselines`. */
    endWeek?: string;
  } = {},
): Promise<IngestResult> {
  const pending = await db
    .select({ id: nodos.id, tipo: nodos.tipo })
    .from(nodos)
    .where(
      and(
        eq(nodos.cadenaId, chainId),
        notExists(db.select({ one: desempenoSemanal.id }).from(desempenoSemanal).where(eq(desempenoSemanal.nodoId, nodos.id))),
      ),
    );
  if (pending.length === 0) return { weeklyPerformance: [], stability: null };

  const plans = options.vendedorPlans ?? new Map<string, VendedorPlan>();
  const baselines = options.baselines ?? new Map<string, NodeBaseline>();
  const history = buildChainHistory(
    pending.map((n) => toHistoryNode({ id: n.id, tipo: n.tipo as NodeType }, plans, baselines)),
    { withLevelShift: options.withLevelShift, endWeek: options.endWeek ?? (await chainLatestWeek(db, chainId)) },
  );
  const weeklyPerformance = await insertRows(db, history.rows);
  for (const node of pending) {
    const plan = node.tipo === "Vendedor" ? plans.get(node.id) : undefined;
    const baseline = baselines.get(node.id);
    if (plan) await markVendedorNode(db, node.id, plan);
    else if (baseline) await markBaselineSource(db, node.id, baseline);
  }
  return { weeklyPerformance, stability: history.stability };
}

/** Carga el historial de un nodo suelto que se acaba de agregar a una cadena. */
export async function ingestNodeHistory(
  db: Executor,
  node: { id: string; tipo: NodeType },
  chainId: string,
  options: { plan?: VendedorPlan; baseline?: NodeBaseline; endWeek?: string } = {},
): Promise<WeeklyPerformance[]> {
  const { plan, baseline } = options;
  const endWeek = options.endWeek ?? (await chainLatestWeek(db, chainId));
  const historyNode = toHistoryNode(node, plan ? new Map([[node.id, plan]]) : new Map(), baseline ? new Map([[node.id, baseline]]) : new Map());
  const rows = await insertRows(db, buildSingleNodeHistory(historyNode, { endWeek }));
  if (plan) await markVendedorNode(db, node.id, plan);
  else if (baseline) await markBaselineSource(db, node.id, baseline);
  return rows;
}
