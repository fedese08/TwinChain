// Script 1 — perfiles por tipo de nodo: cómo "se comporta" cada tipo y qué personalidad le toca a cada nodo.
import { createRng, hashSeed } from "@/lib/domain/rng";
import type { NodeType } from "@/lib/domain/types";

/** Personalidad de UN nodo. Todo en puntos porcentuales del desempeño semanal (0–100). */
export interface NodeProfile {
  /** Nivel medio "normal" del nodo. */
  level: number;
  /** Desvío estándar de la serie (σ): cuánto se mueve semana a semana. */
  volatility: number;
  /** Persistencia semanal AR(1): cuánto de la desviación de esta semana se arrastra a la siguiente. */
  persistence: number;
  /** Probabilidad de que una semana sea "mala" (caída brusca aislada). */
  badWeekProbability: number;
  /** Profundidad de una semana mala, en σ. */
  badWeekDepthSigmas: number;
}

interface TypeRanges {
  level: [number, number];
  volatility: [number, number];
  persistence: number;
  badWeekProbability: number;
  badWeekDepthSigmas: [number, number];
  /** De dónde sale el perfil, para no hacerlo pasar por dato real. */
  source: "olist" | "conceptual";
}

/**
 * Rangos por tipo. Salen de los valores que ya usaba el seed demo, para que los datos se vean igual.
 *
 * Solo `Vendedor` corresponde a datos reales (el `seller_id` de Olist: fecha estimada vs. real de
 * entrega). Los demás tipos son conceptuales: no hay forma de validarlos con el dataset elegido
 * (docs/modelo-datos.md). ⚠️ El rango de Vendedor es provisorio hasta calibrarlo con la media y la
 * dispersión de entregas a tiempo que caracteriza el Preliminar E50 §4.1.
 *
 * Capacidades y stock NO entran acá: RF027 los excluye de cualquier cálculo.
 */
export const TYPE_RANGES: Record<NodeType, TypeRanges> = {
  Proveedor: { level: [90, 94], volatility: [6, 8], persistence: 0.3, badWeekProbability: 0.03, badWeekDepthSigmas: [1.5, 3], source: "conceptual" },
  Fabrica: { level: [91, 95], volatility: [5, 7], persistence: 0.3, badWeekProbability: 0.03, badWeekDepthSigmas: [1.5, 3], source: "conceptual" },
  Almacen: { level: [93, 96], volatility: [4, 6], persistence: 0.3, badWeekProbability: 0.03, badWeekDepthSigmas: [1.5, 3], source: "conceptual" },
  Vendedor: { level: [88, 92], volatility: [8, 11], persistence: 0.3, badWeekProbability: 0.03, badWeekDepthSigmas: [1.5, 3], source: "olist" },
  Cliente: { level: [96, 97], volatility: [3, 4], persistence: 0.3, badWeekProbability: 0.03, badWeekDepthSigmas: [1.5, 3], source: "conceptual" },
};

const lerp = ([from, to]: [number, number], t: number) => from + (to - from) * t;

/**
 * Perfil de un nodo: función pura de su id y su tipo. El mismo nodo siempre tiene la misma
 * personalidad, y no hay ningún id escrito a mano.
 */
export function profileForNode(nodeId: string, nodeType: NodeType): NodeProfile {
  const ranges = TYPE_RANGES[nodeType];
  const rng = createRng(hashSeed(`profile:${nodeId}`));
  return {
    level: lerp(ranges.level, rng()),
    volatility: lerp(ranges.volatility, rng()),
    persistence: ranges.persistence,
    badWeekProbability: ranges.badWeekProbability,
    badWeekDepthSigmas: lerp(ranges.badWeekDepthSigmas, rng()),
  };
}
