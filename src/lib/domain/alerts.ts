// Alertas del sistema: los eventos importantes que el monitoreo detecta, listos para mostrar en un listado.
//
// No se guardan: se DERIVAN de las filas de desempeño semanal y de los ajustes de cada cadena, con las mismas reglas que
// usa el resto de la aplicación (CUSUM del Flujo A para los nodos con línea base del modelo; regla por σ para los nodos
// anteriores; verificación de estabilidad del historial, C24, a nivel de la cadena).
import { degradationPeriods, degradationStatus } from "@/lib/domain/degradation";
import { assessNode, assessOptionsFor } from "@/lib/domain/monitoring";
import type { ChainStability } from "@/lib/domain/synthetic";
import type { Chain, NodeType, SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";
import { unitOfNode, type PerformanceUnit } from "@/lib/domain/units";

export type AlertKind =
  /** Degradación sostenida confirmada por el CUSUM (HU1, HU2). */
  | "sostenida"
  /** Desvío que se está acumulando pero todavía no llegó al umbral. */
  | "vigilancia"
  /** Un nodo con la regla anterior (por σ) está por debajo de lo esperado. */
  | "bajo_esperado"
  /** El historial de la cadena cambió de nivel: la línea base de esos nodos puede no ser confiable (C24). */
  | "historial";

export type AlertSeverity = "critico" | "atencion" | "pasada";

export interface SystemAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** Sigue vigente (`false` = ya pasó: queda en el historial). */
  active: boolean;
  chainId: string;
  chainName: string;
  nodeId?: string;
  nodeLabel?: string;
  nodeType?: NodeType;
  /** Desde cuándo se sostiene el desvío (lunes de la primera semana). */
  since?: string;
  /** Semana en que el sistema la detectó (primera confirmación). */
  detectedWeek?: string;
  /** Última semana del período. */
  until?: string;
  weeks?: number;
  /** Déficit acumulado en el período, en la unidad del nodo. */
  accumulatedDeficit?: number;
  unit?: PerformanceUnit;
  /** Para la vigilancia: qué fracción del umbral lleva el acumulado (0 a 1). */
  fractionOfThreshold?: number;
  /** Para el historial: cuántos nodos de la cadena cambiaron de nivel. */
  unstableNodes?: number;
  totalNodes?: number;
}

export interface AlertInput {
  chains: Pick<Chain, "id" | "name" | "falseAlarmCost">[];
  nodes: Pick<SupplyChainNode, "id" | "chainId" | "label" | "nodeType" | "olistSellerId" | "baselineSource">[];
  rows: WeeklyPerformance[];
  /** Estabilidad del historial de cada cadena (C24), si ya está calculada. */
  stabilityByChain?: Map<string, ChainStability | null>;
}

const weeksBetweenInclusive = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000)) + 1;

/** Más graves y más recientes primero: lo vigente antes que lo pasado, y dentro de cada grupo lo último detectado. */
function compare(a: SystemAlert, b: SystemAlert): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  const rank = { critico: 0, atencion: 1, pasada: 2 } as const;
  if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
  return (b.detectedWeek ?? b.since ?? "").localeCompare(a.detectedWeek ?? a.since ?? "");
}

export function buildSystemAlerts({ chains, nodes, rows, stabilityByChain }: AlertInput): SystemAlert[] {
  const rowsByNode = new Map<string, WeeklyPerformance[]>();
  for (const row of rows) {
    const list = rowsByNode.get(row.nodeId);
    if (list) list.push(row);
    else rowsByNode.set(row.nodeId, [row]);
  }

  const alerts: SystemAlert[] = [];
  for (const chain of chains) {
    const stability = stabilityByChain?.get(chain.id);
    if (stability && stability.status === "alerta") {
      alerts.push({
        id: `historial:${chain.id}`,
        kind: "historial",
        severity: "atencion",
        active: true,
        chainId: chain.id,
        chainName: chain.name,
        since: stability.changePointWeek,
        unstableNodes: stability.unstableNodeCount,
        totalNodes: stability.nodeCount,
      });
    }

    for (const node of nodes.filter((n) => n.chainId === chain.id)) {
      const nodeRows = [...(rowsByNode.get(node.id) ?? [])].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      if (nodeRows.length === 0) continue;
      const base = { chainId: chain.id, chainName: chain.name, nodeId: node.id, nodeLabel: node.label, nodeType: node.nodeType, unit: unitOfNode(node) };
      const options = assessOptionsFor(node, chain);

      if (options.cusumH === undefined) {
        // Nodo con la regla anterior (escala 0-100): solo se sabe si hoy está por debajo de lo esperado.
        const health = assessNode(nodeRows, options);
        if (health.level !== "normal") {
          alerts.push({
            ...base,
            id: `bajo_esperado:${node.id}`,
            kind: "bajo_esperado",
            severity: health.level === "critico" ? "critico" : "atencion",
            active: true,
            detectedWeek: nodeRows[nodeRows.length - 1].weekStart,
            accumulatedDeficit: health.recentDeficit,
          });
        }
        continue;
      }

      const status = degradationStatus(nodeRows, options.cusumH);
      for (const period of degradationPeriods(nodeRows, options.cusumH)) {
        const active = status.active !== null && status.active.lastConfirmedWeek === period.to;
        const deficit = nodeRows.filter((r) => r.weekStart >= period.from && r.weekStart <= period.to).reduce((sum, r) => sum + r.deficit, 0);
        alerts.push({
          ...base,
          id: `sostenida:${node.id}:${period.from}`,
          kind: "sostenida",
          severity: active ? "critico" : "pasada",
          active,
          since: period.from,
          detectedWeek: period.confirmedWeek,
          until: period.to,
          weeks: weeksBetweenInclusive(period.from, period.to),
          accumulatedDeficit: deficit,
        });
      }

      const { run } = status;
      if (status.level === "atencion" && run.current.since) {
        alerts.push({
          ...base,
          id: `vigilancia:${node.id}`,
          kind: "vigilancia",
          severity: "atencion",
          active: true,
          since: run.current.since,
          weeks: run.current.weeks,
          accumulatedDeficit: run.current.deficitSoFar,
          fractionOfThreshold: run.current.threshold > 0 ? Math.min(1, run.current.accumulated / run.current.threshold) : 0,
        });
      }
    }
  }
  return alerts.sort(compare);
}

/** Cuántas alertas siguen vigentes: lo que muestra la insignia del menú. */
export const countActiveAlerts = (alerts: SystemAlert[]) => alerts.filter((a) => a.active).length;
