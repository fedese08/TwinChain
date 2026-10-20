// Orquestación pura de la ingesta: de una lista de nodos a las filas de `desempeno_semanal` y el
// veredicto de estabilidad. No toca la base de datos: la capa de ingesta solo guarda lo que esto devuelve.
import { hashSeed } from "@/lib/domain/rng";
import type { NodeType } from "@/lib/domain/types";
import {
  HISTORY_WEEKS,
  LEVEL_SHIFT_AT_FRACTION,
  LEVEL_SHIFT_NODE_FRACTION,
  LEVEL_SHIFT_SIGMAS,
  TRAINING_WEEKS,
} from "./config";
import { evaluateChainStability, type ChainStability } from "./cusum";
import { buildRows, buildRowsWithBaseline, estimateBaseline, type NewWeeklyRow } from "./estimate-baseline";
import { buildVendedorRows, type RealWeek } from "@/lib/domain/vendedor/history";
import { PHASE1_WEEKS, type NodeBaseline } from "@/lib/domain/vendedor/baseline";
import { generateSeries, generateWeeklyItems, type LevelShift } from "./generate-series";
import { lastCompleteWeek, weekRange } from "./weeks";

/** Datos reales de un nodo Vendedor: su historial en Olist (días) y su línea base ya resuelta (modelo o provisoria). */
export interface VendedorSetup {
  realWeeks: RealWeek[];
  baseline: NodeBaseline;
}

export interface HistoryNode {
  id: string;
  type: NodeType;
  /** Si está, el nodo usa datos REALES en días en vez de la serie sintética 0-100. */
  vendedor?: VendedorSetup;
  /**
   * Si está, el nodo mide en DÍAS: el generador hace de sensor (margen de despacho) y la línea base y las bandas
   * ya vienen resueltas (modelo de ML o provisoria), a partir de sus propias primeras semanas (`sensorPhase1`).
   */
  baseline?: NodeBaseline;
}

export interface BuildHistoryOptions {
  /** Última semana (lunes ISO) del historial. Por defecto, la última semana completa. */
  endWeek?: string;
  /** Inyecta un cambio de nivel en parte de los nodos, para poder mostrar la alerta de C24. */
  withLevelShift?: boolean;
}

/**
 * Qué nodos sufren el cambio de nivel: una fracción fija, siempre al menos uno, elegida de forma
 * determinística por el id (el mismo conjunto de nodos siempre da el mismo resultado).
 */
export function planLevelShifts(nodeIds: string[], weekStarts: string[]): Map<string, LevelShift> {
  if (nodeIds.length === 0) return new Map();
  const count = Math.max(1, Math.ceil(nodeIds.length * LEVEL_SHIFT_NODE_FRACTION));
  const fromWeek = weekStarts[Math.floor(TRAINING_WEEKS * LEVEL_SHIFT_AT_FRACTION)];
  const chosen = [...nodeIds].sort((a, b) => hashSeed(`shift:${a}`) - hashSeed(`shift:${b}`)).slice(0, count);
  return new Map(chosen.map((id) => [id, { fromWeek, sigmas: LEVEL_SHIFT_SIGMAS }]));
}

export interface NodeHistory {
  rows: NewWeeklyRow[];
  /**
   * Semanas y valores de la ventana de entrenamiento: lo que mira la verificación de estabilidad. `null` en los
   * nodos con datos reales: su línea base sale de 4 semanas, y C24 valida una ventana larga.
   */
  training: { weekStarts: string[]; values: number[] } | null;
}

/**
 * Historial de UN nodo: genera la serie, estima la línea base SOLO con su propia ventana de
 * entrenamiento (RF017) y la congela para todas las semanas.
 */
export function buildNodeHistory(node: HistoryNode, weekStarts: string[], levelShift?: LevelShift): NodeHistory {
  if (node.vendedor) {
    return {
      rows: buildVendedorRows({ nodeId: node.id, realWeeks: node.vendedor.realWeeks, weekStarts, baseline: node.vendedor.baseline }),
      training: null,
    };
  }
  if (node.baseline) {
    const values = generateSeries({ nodeId: node.id, nodeType: node.type, weekStarts, levelShift, unit: "dias" });
    return {
      rows: buildRowsWithBaseline({ nodeId: node.id, weekStarts, values, baseline: node.baseline }),
      training: { weekStarts: weekStarts.slice(0, TRAINING_WEEKS), values: values.slice(0, TRAINING_WEEKS) },
    };
  }
  const values = generateSeries({ nodeId: node.id, nodeType: node.type, weekStarts, levelShift });
  const trainingValues = values.slice(0, TRAINING_WEEKS);
  const estimate = estimateBaseline(trainingValues);
  return {
    rows: buildRows({ nodeId: node.id, weekStarts, values, estimate }),
    training: { weekStarts: weekStarts.slice(0, TRAINING_WEEKS), values: trainingValues },
  };
}

export interface ChainHistory {
  rows: NewWeeklyRow[];
  /** `null` si ningún nodo tiene una ventana de entrenamiento que evaluar (p. ej. una cadena de solo Vendedores reales). */
  stability: ChainStability | null;
}

/** Historial de todos los nodos de una cadena y veredicto de estabilidad (C24). */
export function buildChainHistory(nodes: HistoryNode[], options: BuildHistoryOptions = {}): ChainHistory {
  const weekStarts = weekRange(options.endWeek ?? lastCompleteWeek(), HISTORY_WEEKS);
  // Los datos reales no se tocan: el cambio de nivel inyectado solo cae en nodos sintéticos.
  const shifts = options.withLevelShift ? planLevelShifts(nodes.filter((n) => !n.vendedor).map((n) => n.id), weekStarts) : new Map<string, LevelShift>();

  const rows: NewWeeklyRow[] = [];
  const training: { weekStarts: string[]; values: number[] }[] = [];
  for (const node of nodes) {
    const history = buildNodeHistory(node, weekStarts, shifts.get(node.id));
    rows.push(...history.rows);
    if (history.training) training.push(history.training);
  }
  return { rows, stability: training.length > 0 ? evaluateChainStability(training) : null };
}

/** Historial de un nodo suelto que se agrega a una cadena que ya existe. */
export function buildSingleNodeHistory(node: HistoryNode, options: Pick<BuildHistoryOptions, "endWeek"> = {}): NewWeeklyRow[] {
  const weekStarts = weekRange(options.endWeek ?? lastCompleteWeek(), HISTORY_WEEKS);
  return buildNodeHistory(node, weekStarts).rows;
}

/** Las semanas (lunes ISO) del historial de un nodo que termina en `endWeek` (por defecto, la última semana completa). */
export function historyWeekStarts(endWeek?: string): string[] {
  return weekRange(endWeek ?? lastCompleteWeek(), HISTORY_WEEKS);
}

/**
 * Lo que reportó el sensor del nodo en sus primeras semanas (Fase I): margen y volumen de cada una. Es el ÚNICO dato
 * que el modelo de ML necesita para estimar la línea base del nodo; el modelo no sabe de dónde sale (un sensor real o
 * este generador). Función pura de (nodo, semanas): las mismas primeras semanas que luego se guardan en el historial.
 */
export function sensorPhase1(node: { id: string; type: NodeType }, weekStarts: string[]): { margen: number; items: number }[] {
  const first = weekStarts.slice(0, PHASE1_WEEKS);
  const margins = generateSeries({ nodeId: node.id, nodeType: node.type, weekStarts: first, unit: "dias" });
  const items = generateWeeklyItems({ nodeId: node.id, nodeType: node.type, weekStarts: first });
  return first.map((_, i) => ({ margen: margins[i], items: items[i] }));
}
