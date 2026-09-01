// Motor de simulación MOCK — placeholder de UI mientras no existe el motor determinístico
// real (Fase 4, backend). Sirve para que las pantallas de escenario/resultado tengan algo
// que mostrar con datos coherentes; el cálculo en sí NO es la propuesta metodológica de la tesis.
import { addDaysIso, addWeeks, startOfWeek, toIsoDate } from "@/lib/mock/dates";
import type { DisruptionEvent, KTableRow, SupplyChainEdge, SupplyChainNode, WeeklyPerformance } from "@/lib/mock/types";

export interface ProjectedWeek {
  weekStart: string;
  baseline: number;
  actualValue: number;
  deficit: number;
}

const RECOVERY_SPAN_WEEKS = 6;

/**
 * Proyecta valor_real/linea_base/deficit semana a semana para un nodo, a partir de su
 * historial reciente y los eventos que lo afectan dentro de un escenario.
 */
export function projectNodeWeeklyDeficit(
  history: WeeklyPerformance[],
  nodeEvents: DisruptionEvent[],
  horizonWeeks: number,
): ProjectedWeek[] {
  const sorted = [...history].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const last = sorted[sorted.length - 1];
  const recentBaseline =
    sorted.slice(-4).reduce((sum, w) => sum + w.baseline, 0) / Math.min(4, sorted.length || 1);

  const firstProjectedWeek = addWeeks(startOfWeek(new Date(last.weekStart)), 1);

  const weeks: ProjectedWeek[] = [];
  for (let i = 0; i < horizonWeeks; i++) {
    const weekDate = addWeeks(firstProjectedWeek, i);
    const weekStart = toIsoDate(weekDate);
    const baseline = recentBaseline;

    let worstDrop = 0;
    for (const event of nodeEvents) {
      const eventWeek = startOfWeek(new Date(event.startDate));
      const weeksSinceOnset = Math.round((weekDate.getTime() - eventWeek.getTime()) / (7 * 86400000));
      if (weeksSinceOnset < 0) continue;
      const recovery = Math.max(0, 1 - weeksSinceOnset / RECOVERY_SPAN_WEEKS);
      const drop = event.magnitude * recovery;
      worstDrop = Math.max(worstDrop, drop);
    }

    const actualValue = Math.max(0, baseline * (1 - worstDrop / 100));
    const deficit = Math.max(0, baseline - actualValue);
    weeks.push({ weekStart, baseline, actualValue, deficit });
  }
  return weeks;
}

export type Severity = "severe" | "moderate" | "none";

const SEVERE_DEFICIT_THRESHOLD = 8;
const MODERATE_DEFICIT_THRESHOLD = 2;

export function classifySeverity(deficit: number): Severity {
  if (deficit >= SEVERE_DEFICIT_THRESHOLD) return "severe";
  if (deficit >= MODERATE_DEFICIT_THRESHOLD) return "moderate";
  return "none";
}

const PROPAGATION_DECAY_PER_HOP = 0.55;
const MIN_PROPAGATED_MAGNITUDE = 3;
const MAX_PROPAGATION_HOPS = 6;

/**
 * Propaga cada Evento aguas abajo por las Aristas de la cadena (BFS en el sentido del
 * tránsito): cada salto decae la magnitud y retrasa el onset según tiempo_transito.
 * Devuelve, para cada nodo alcanzado (directa o indirectamente), su proyección semanal —
 * reutilizando projectNodeWeeklyDeficit con "eventos" sintéticos por salto.
 */
export function computeChainPropagation(
  nodes: Pick<SupplyChainNode, "id">[],
  edges: Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">[],
  events: DisruptionEvent[],
  weeklyPerformanceAll: WeeklyPerformance[],
  horizonWeeks: number,
): Map<string, ProjectedWeek[]> {
  const adjacency = new Map<string, { targetNodeId: string; transitTimeDays: number }[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.sourceNodeId) ?? [];
    list.push({ targetNodeId: edge.targetNodeId, transitTimeDays: edge.transitTimeDays });
    adjacency.set(edge.sourceNodeId, list);
  }

  const pseudoEventsByNode = new Map<string, DisruptionEvent[]>();
  function addPseudoEvent(nodeId: string, event: DisruptionEvent) {
    const list = pseudoEventsByNode.get(nodeId) ?? [];
    list.push(event);
    pseudoEventsByNode.set(nodeId, list);
  }

  for (const event of events) {
    const queue: { nodeId: string; magnitude: number; delayDays: number; hops: number }[] = [
      { nodeId: event.nodeId, magnitude: event.magnitude, delayDays: 0, hops: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift()!;
      addPseudoEvent(current.nodeId, {
        id: `${event.id}-hop${current.hops}-${current.nodeId}`,
        scenarioId: event.scenarioId,
        nodeId: current.nodeId,
        eventType: event.eventType,
        startDate: addDaysIso(event.startDate, current.delayDays),
        magnitude: current.magnitude,
      });

      if (current.hops >= MAX_PROPAGATION_HOPS) continue;
      for (const neighbor of adjacency.get(current.nodeId) ?? []) {
        const decayedMagnitude = current.magnitude * PROPAGATION_DECAY_PER_HOP;
        if (decayedMagnitude < MIN_PROPAGATED_MAGNITUDE) continue;
        const hopDelayDays = Math.max(7, Math.round(neighbor.transitTimeDays / 7) * 7);
        queue.push({
          nodeId: neighbor.targetNodeId,
          magnitude: decayedMagnitude,
          delayDays: current.delayDays + hopDelayDays,
          hops: current.hops + 1,
        });
      }
    }
  }

  const result = new Map<string, ProjectedWeek[]>();
  for (const node of nodes) {
    const nodeEvents = pseudoEventsByNode.get(node.id);
    if (!nodeEvents || nodeEvents.length === 0) continue;
    const history = weeklyPerformanceAll.filter((w) => w.nodeId === node.id);
    if (history.length === 0) continue;
    result.set(node.id, projectNodeWeeklyDeficit(history, nodeEvents, horizonWeeks));
  }
  return result;
}

/**
 * Barre un rango de k (costo de reconfigurar, en semanas malas equivalentes) y calcula
 * el umbral de reconfiguración correspondiente a cada uno, a partir del déficit acumulado
 * proyectado. A partir de cierto k, el umbral deja de existir (se guarda como null).
 */
export function computeKTable(totalProjectedDeficit: number, horizonWeeks: number): KTableRow[] {
  const equivalentBadWeeks = totalProjectedDeficit / 100;
  const rows: KTableRow[] = [];
  for (let k = 1; k <= 10; k++) {
    const rawThreshold = (equivalentBadWeeks / (k + 1)) * (horizonWeeks / 10);
    const threshold = rawThreshold >= 0.5 ? Math.round(rawThreshold * 10) / 10 : null;
    rows.push({ k, threshold });
  }
  return rows;
}
