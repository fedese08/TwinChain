// Script 6 — avance semanal (monitoreo vivo del Digital Twin): continúa la serie de un nodo.
//
// La línea base y su banda se COPIAN de lo ya registrado: están congeladas y no se recalculan con las
// semanas nuevas (si se movieran junto con la caída que se quiere detectar, el déficit se encogería).
import type { NodeType } from "@/lib/domain/types";
import { MAX_ADVANCE_WEEKS } from "./config";
import { type NewWeeklyRow } from "./estimate-baseline";
import { continueSeries } from "./generate-series";

export interface NodeLatestState {
  nodeId: string;
  nodeType: NodeType;
  /** TODAS las observaciones registradas del nodo, de la más vieja a la más nueva. */
  history: number[];
  lastWeekStart: string;
  baseline: number;
  baselineLowerBand: number;
  baselineUpperBand: number;
}

export function advanceNode(state: NodeLatestState, weeks: number): NewWeeklyRow[] {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_ADVANCE_WEEKS) {
    throw new RangeError(`Se puede avanzar entre 1 y ${MAX_ADVANCE_WEEKS} semanas por vez`);
  }
  const next = continueSeries({
    nodeId: state.nodeId,
    nodeType: state.nodeType,
    history: state.history,
    lastWeekStart: state.lastWeekStart,
    weeks,
  });
  return next.weekStarts.map((weekStart, i) => ({
    nodeId: state.nodeId,
    weekStart,
    actualValue: next.values[i],
    baseline: state.baseline,
    baselineLowerBand: state.baselineLowerBand,
    baselineUpperBand: state.baselineUpperBand,
    deficit: Math.max(0, state.baseline - next.values[i]),
  }));
}
