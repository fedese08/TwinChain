// Estado de desempeño de un nodo y de una cadena, a partir de su serie semanal (capa 1: Digital Twin).
//
// El déficit se mide en unidades de la VARIABILIDAD PROPIA del nodo y no en puntos absolutos: con una
// línea base estimada, una semana floja por puro ruido da un déficit de 2–3 puntos en cualquier nodo
// volátil, y un umbral fijo marcaría casi todo como "con problemas" todo el tiempo. Lo que importa es
// si el déficit reciente es raro PARA ESE NODO.
import { thresholdForCost } from "@/lib/domain/cusum-config";
import { degradationStatus, type ActiveAlert } from "@/lib/domain/degradation";
import { stdDev } from "@/lib/domain/synthetic/stats";
import { TRAINING_WEEKS } from "@/lib/domain/synthetic/config";
import type { Chain, SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";
import { unitOfNode } from "@/lib/domain/units";

export type NodeHealthLevel = "normal" | "atencion" | "critico";

/** Cuántas semanas recientes se promedian: una semana mala aislada no alcanza para alarmar. */
export const RECENT_WEEKS = 3;

/** Déficit reciente medio, en σ del nodo, a partir del cual hay que mirarlo / es crítico. Calibrados en monitoring.test.ts. */
export const ATTENTION_SIGMAS = 2;
export const CRITICAL_SIGMAS = 3.4;

/** Piso de σ: un nodo casi constante no debe disparar por divisiones por ~0. */
const MIN_SIGMA = 0.5;

export interface NodeHealth {
  level: NodeHealthLevel;
  /** Déficit medio de las últimas semanas, en puntos porcentuales. */
  recentDeficit: number;
  /** Déficit de la última semana registrada. */
  latestDeficit: number;
  /**
   * Déficit reciente medio en unidades de variabilidad del nodo: σ de su ventana de entrenamiento o, en los
   * nodos con banda semanal del modelo, semi-anchos de esa banda. Es un número sin unidades.
   */
  deficitSigmas: number;
  /** Con CUSUM: la degradación sostenida confirmada que sigue vigente (desde cuándo y cuánto déficit juntó), si hay una. */
  sustained?: ActiveAlert | null;
  /** Con CUSUM: desde cuándo se acumula un desvío que todavía no llegó al umbral, y qué fracción del umbral lleva. */
  accumulating?: { since: string; fractionOfThreshold: number } | null;
}

/** Cómo evaluar un nodo. Sin `cusumH` rige la regla por σ (nodos anteriores, en escala 0-100). */
export interface AssessOptions {
  /** Umbral del CUSUM en múltiplos del margen de la línea base (Flujo A del E90). */
  cusumH?: number;
}

/** Cómo evaluar un nodo de una cadena: los nodos en días usan el CUSUM con el umbral de la cadena; los anteriores, la regla por σ. */
export function assessOptionsFor(
  node: Pick<SupplyChainNode, "olistSellerId" | "baselineSource">,
  chain: Pick<Chain, "falseAlarmCost"> | undefined,
): AssessOptions {
  return unitOfNode(node) === "dias" && chain ? { cusumH: thresholdForCost(chain.falseAlarmCost) } : {};
}

const EMPTY: NodeHealth = { level: "normal", recentDeficit: 0, latestDeficit: 0, deficitSigmas: 0 };

/** `rows` son las filas de UN nodo, en cualquier orden. */
export function assessNode(rows: WeeklyPerformance[], options: AssessOptions = {}): NodeHealth {
  if (rows.length === 0) return EMPTY;
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const recent = sorted.slice(-RECENT_WEEKS);
  const recentDeficit = recent.reduce((sum, r) => sum + r.deficit, 0) / recent.length;
  const latestDeficit = sorted[sorted.length - 1].deficit;

  // Nodo con línea base del modelo: CUSUM sobre el residuo semanal (Flujo A). Una alerta confirmada se muestra como
  // crítica mientras sigue reciente; si el desvío se está acumulando sin llegar al umbral, como atención.
  if (options.cusumH !== undefined) {
    const status = degradationStatus(sorted, options.cusumH);
    const { run } = status;
    const level: NodeHealthLevel = status.level === "alerta" ? "critico" : status.level === "atencion" ? "atencion" : "normal";
    const fraction = run.current.threshold > 0 ? run.current.accumulated / run.current.threshold : 0;
    return {
      level,
      recentDeficit,
      latestDeficit,
      deficitSigmas: fraction,
      sustained: status.active,
      accumulating: run.current.since ? { since: run.current.since, fractionOfThreshold: fraction } : null,
    };
  }

  // σ del nodo: de su ventana de entrenamiento, la misma sobre la que se congeló la línea base.
  const training = sorted.slice(0, TRAINING_WEEKS).map((r) => r.actualValue);
  if (training.length < 2) return { ...EMPTY, recentDeficit, latestDeficit };
  const sigma = Math.max(stdDev(training), MIN_SIGMA);

  const deficitSigmas = recentDeficit / sigma;
  const level: NodeHealthLevel =
    deficitSigmas >= CRITICAL_SIGMAS ? "critico" : deficitSigmas >= ATTENTION_SIGMAS ? "atencion" : "normal";
  return { level, recentDeficit, latestDeficit, deficitSigmas };
}

export interface ChainHealth {
  nodeCount: number;
  attentionCount: number;
  criticalCount: number;
}

/** Estado de la cadena: cuántos de sus nodos están en atención o críticos. */
export function assessChain(rowsByNode: Map<string, WeeklyPerformance[]>, optionsByNode: Map<string, AssessOptions> = new Map()): ChainHealth {
  let attentionCount = 0;
  let criticalCount = 0;
  for (const [nodeId, rows] of rowsByNode) {
    const { level } = assessNode(rows, optionsByNode.get(nodeId));
    if (level === "atencion") attentionCount++;
    if (level === "critico") criticalCount++;
  }
  return { nodeCount: rowsByNode.size, attentionCount, criticalCount };
}
