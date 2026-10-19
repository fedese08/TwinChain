// Pipeline de ingesta (contenedor de la arquitectura C4): genera el historial de desempeño de los
// nodos que todavía no lo tienen, lo guarda y corre la verificación de estabilidad (C24, decisión 14).
//
// Dos orígenes de datos, según el nodo:
//   - nodos sintéticos: serie generada en escala 0-100 (`lib/domain/synthetic`);
//   - nodos Vendedor: vendedores REALES de Olist, en DÍAS de margen, con la línea base del modelo de ML
//     (`lib/domain/vendedor`). Su plan (vendedor asignado + línea base) lo prepara quien llama ANTES de abrir la
//     transacción, ver `vendedor-setup.ts`.
//
// La base solo entra acá. Quien llama pasa su propia transacción, así que o queda todo (cadena, nodos e
// historial) o no queda nada.
import { and, eq, inArray, max, notExists } from "drizzle-orm";
import { toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, nodos, type Database } from "@/lib/db";
import type { NodeType, WeeklyPerformance } from "@/lib/domain/types";
import { buildChainHistory, buildSingleNodeHistory, type BuildHistoryOptions, type ChainStability, type HistoryNode, type NewWeeklyRow } from "@/lib/domain/synthetic";
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

function toHistoryNode(node: { id: string; tipo: NodeType }, plans: ReadonlyMap<string, VendedorPlan>): HistoryNode {
  if (node.tipo !== "Vendedor") return { id: node.id, type: node.tipo };
  const plan = plans.get(node.id);
  if (!plan) throw new Error(`Falta el plan de vendedor real del nodo ${node.id}: hay que prepararlo antes de la transacción`);
  return { id: node.id, type: node.tipo, vendedor: plan.setup };
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
  options: Pick<BuildHistoryOptions, "withLevelShift"> & { vendedorPlans?: ReadonlyMap<string, VendedorPlan> } = {},
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
  const history = buildChainHistory(
    pending.map((n) => toHistoryNode({ id: n.id, tipo: n.tipo as NodeType }, plans)),
    { withLevelShift: options.withLevelShift, endWeek: await chainLatestWeek(db, chainId) },
  );
  const weeklyPerformance = await insertRows(db, history.rows);
  for (const node of pending) {
    const plan = plans.get(node.id);
    if (plan) await markVendedorNode(db, node.id, plan);
  }
  return { weeklyPerformance, stability: history.stability };
}

/** Carga el historial de un nodo suelto que se acaba de agregar a una cadena. */
export async function ingestNodeHistory(
  db: Executor,
  node: { id: string; tipo: NodeType },
  chainId: string,
  plan?: VendedorPlan,
): Promise<WeeklyPerformance[]> {
  const endWeek = await chainLatestWeek(db, chainId);
  const historyNode = toHistoryNode(node, plan ? new Map([[node.id, plan]]) : new Map());
  const rows = await insertRows(db, buildSingleNodeHistory(historyNode, { endWeek }));
  if (plan) await markVendedorNode(db, node.id, plan);
  return rows;
}
