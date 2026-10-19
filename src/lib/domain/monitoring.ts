// Estado de desempeño de un nodo y de una cadena, a partir de su serie semanal (capa 1: Digital Twin).
//
// El déficit se mide en unidades de la VARIABILIDAD PROPIA del nodo y no en puntos absolutos: con una
// línea base estimada, una semana floja por puro ruido da un déficit de 2–3 puntos en cualquier nodo
// volátil, y un umbral fijo marcaría casi todo como "con problemas" todo el tiempo. Lo que importa es
// si el déficit reciente es raro PARA ESE NODO.
import { stdDev } from "@/lib/domain/synthetic/stats";
import { TRAINING_WEEKS } from "@/lib/domain/synthetic/config";
import type { WeeklyPerformance } from "@/lib/domain/types";

export type NodeHealthLevel = "normal" | "atencion" | "critico";

/** Cuántas semanas recientes se promedian: una semana mala aislada no alcanza para alarmar. */
export const RECENT_WEEKS = 3;

/** Déficit reciente medio, en σ del nodo, a partir del cual hay que mirarlo / es crítico. Calibrados en monitoring.test.ts. */
export const ATTENTION_SIGMAS = 2;
export const CRITICAL_SIGMAS = 3.4;

/**
 * Nodos con línea base del MODELO de ML (Vendedores reales): se mira cuántas de las últimas semanas cayeron por
 * debajo de la banda SEMANAL del modelo, que es justamente la banda pensada para alertar semana a semana. Medido
 * con 81 vendedores reales que el modelo no vio: "atención" en el 3,3 % de las ventanas y "crítico" en el 0,6 %.
 * (La regla por σ casi no salta con datos reales: 0,2 %, porque su σ incluye los cambios de nivel propios del vendedor.)
 */
export const BAND_ATTENTION_COUNT = 2;
export const BAND_CRITICAL_COUNT = 3;

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
}

const EMPTY: NodeHealth = { level: "normal", recentDeficit: 0, latestDeficit: 0, deficitSigmas: 0 };

/** `rows` son las filas de UN nodo, en cualquier orden. */
export function assessNode(rows: WeeklyPerformance[]): NodeHealth {
  if (rows.length === 0) return EMPTY;
  const sorted = [...rows].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const recent = sorted.slice(-RECENT_WEEKS);
  const recentDeficit = recent.reduce((sum, r) => sum + r.deficit, 0) / recent.length;
  const latestDeficit = sorted[sorted.length - 1].deficit;

  // Nodo con línea base del modelo: la regla es la banda semanal del propio modelo.
  const latest = sorted[sorted.length - 1];
  if (latest.weeklyBandLower !== undefined) {
    const below = recent.filter((r) => r.weeklyBandLower !== undefined && r.actualValue < r.weeklyBandLower).length;
    const level: NodeHealthLevel = below >= BAND_CRITICAL_COUNT ? "critico" : below >= BAND_ATTENTION_COUNT ? "atencion" : "normal";
    const halfWidth = Math.max(latest.baseline - latest.weeklyBandLower, MIN_SIGMA);
    return { level, recentDeficit, latestDeficit, deficitSigmas: recentDeficit / halfWidth };
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
export function assessChain(rowsByNode: Map<string, WeeklyPerformance[]>): ChainHealth {
  let attentionCount = 0;
  let criticalCount = 0;
  for (const rows of rowsByNode.values()) {
    const { level } = assessNode(rows);
    if (level === "atencion") attentionCount++;
    if (level === "critico") criticalCount++;
  }
  return { nodeCount: rowsByNode.size, attentionCount, criticalCount };
}
