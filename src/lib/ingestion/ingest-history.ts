// Pipeline de ingesta (contenedor de la arquitectura C4): genera el historial de desempeño de los
// nodos que todavía no lo tienen, lo guarda y corre la verificación de estabilidad (C24, decisión 14).
//
// La base solo entra acá: la generación, la línea base y el CUSUM son funciones puras de
// `lib/domain/synthetic`. Quien llama pasa su propia transacción, así que o queda todo (cadena, nodos e
// historial) o no queda nada.
import { and, eq, inArray, max, notExists } from "drizzle-orm";
import { toWeeklyPerformance } from "@/lib/data/mappers";
import { desempenoSemanal, nodos, type Database } from "@/lib/db";
import type { NodeType, WeeklyPerformance } from "@/lib/domain/types";
import { buildChainHistory, buildSingleNodeHistory, type BuildHistoryOptions } from "@/lib/domain/synthetic";
import type { ChainStability } from "@/lib/domain/synthetic";
import type { NewWeeklyRow } from "@/lib/domain/synthetic";

/** Una transacción o la base misma: lo único que se usa de ellas es `select` e `insert`. */
type Executor = Pick<Database, "select" | "insert">;

/** Filas por INSERT: Postgres admite hasta 65.535 parámetros y cada fila usa 7. */
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
          deficit: r.deficit,
        })),
      )
      .returning();
    inserted.push(...saved.map(toWeeklyPerformance));
  }
  return inserted;
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
  /** `null` si no había nodos sin historial para evaluar. */
  stability: ChainStability | null;
}

/**
 * Carga el historial de todos los nodos de la cadena que todavía no tienen ninguno (los que ya lo
 * tienen no se tocan) y devuelve el veredicto de estabilidad de los nodos cargados.
 */
export async function ingestChainHistory(
  db: Executor,
  chainId: string,
  options: Pick<BuildHistoryOptions, "withLevelShift"> = {},
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

  const history = buildChainHistory(
    pending.map((n) => ({ id: n.id, type: n.tipo as NodeType })),
    { withLevelShift: options.withLevelShift, endWeek: await chainLatestWeek(db, chainId) },
  );
  return { weeklyPerformance: await insertRows(db, history.rows), stability: history.stability };
}

/** Carga el historial de un nodo suelto que se acaba de agregar a una cadena. */
export async function ingestNodeHistory(
  db: Executor,
  node: { id: string; tipo: NodeType },
  chainId: string,
): Promise<WeeklyPerformance[]> {
  const endWeek = await chainLatestWeek(db, chainId);
  return insertRows(db, buildSingleNodeHistory({ id: node.id, type: node.tipo }, { endWeek }));
}
