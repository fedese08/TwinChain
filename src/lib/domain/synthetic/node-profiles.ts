// Script 1 — perfiles por tipo de nodo: cómo "se comporta" cada tipo y qué personalidad le toca a cada nodo.
import { createRng, hashSeed } from "@/lib/domain/rng";
import type { NodeType } from "@/lib/domain/types";
import type { PerformanceUnit } from "@/lib/domain/units";

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
  /** Volumen típico de la semana (envíos por semana): el segundo dato que reporta el sensor. Solo se usa en escala "dias". */
  itemsPerWeek: number;
  /**
   * σ del valor SEMANAL que ve quien agrega los envíos (media de la semana). En escala "pct" es `volatility`. En "dias",
   * `volatility` pasa a ser solo la parte del nodo (su nivel semanal) y el resto lo pone cada envío (`shipmentSigma`).
   */
  weeklyVolatility: number;
  /** σ del margen de un envío individual alrededor del nivel de su semana. 0 en escala "pct". */
  shipmentSigma: number;
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

/**
 * Perfiles en DÍAS de margen de despacho (`margin_days`): la métrica que mide el modelo de ML, que es también lo que
 * definiría un sensor real en cada nodo. Se calibraron con los vendedores de Olist (nivel mediano 3,5 d, σ semanal
 * mediana ~2 d, AR(1) mediana 0,16, ~2,5 ítems por semana): niveles dentro de 2,8-4,2 d, que es donde el modelo
 * tiene datos de sobra (predice entre 2,4 y 4,2 d), y σ en el rango típico de Olist (1,3-2,4 d). Cambian entre tipos
 * en lo que ya se asumía antes: la cola de la cadena es más estable que el origen. ⚠️ Los cuatro tipos conceptuales
 * no se pueden contrastar con Olist; solo se les da la misma métrica.
 */
const DAYS_RANGES: Record<NodeType, { level: [number, number]; volatility: [number, number]; itemsPerWeek: [number, number] }> = {
  Proveedor: { level: [3.0, 3.8], volatility: [1.5, 2.0], itemsPerWeek: [2, 6] },
  Fabrica: { level: [3.2, 4.0], volatility: [1.4, 1.8], itemsPerWeek: [2, 6] },
  Almacen: { level: [3.4, 4.2], volatility: [1.3, 1.7], itemsPerWeek: [2, 6] },
  Vendedor: { level: [2.8, 4.2], volatility: [1.5, 2.4], itemsPerWeek: [1.5, 5] },
  Cliente: { level: [3.6, 4.2], volatility: [1.3, 1.6], itemsPerWeek: [2, 6] },
};
const DAYS_PERSISTENCE = 0.15;
/** Parte de la varianza semanal que pone el nivel del nodo; el resto es ruido de cada envío. */
const LATENT_SHARE = 0.5;

const lerp = ([from, to]: [number, number], t: number) => from + (to - from) * t;

/**
 * Perfil de un nodo: función pura de su id y su tipo. El mismo nodo siempre tiene la misma
 * personalidad, y no hay ningún id escrito a mano.
 */
export function profileForNode(nodeId: string, nodeType: NodeType, unit: PerformanceUnit = "pct"): NodeProfile {
  const ranges = TYPE_RANGES[nodeType];
  const rng = createRng(hashSeed(`profile:${nodeId}`));
  // El orden de los sorteos no cambia: la escala 0-100 (nodos viejos) sigue dando exactamente el mismo perfil.
  const pct = {
    level: lerp(ranges.level, rng()),
    volatility: lerp(ranges.volatility, rng()),
    depthSigmas: lerp(ranges.badWeekDepthSigmas, rng()),
  };
  if (unit === "pct") {
    return {
      level: pct.level,
      volatility: pct.volatility,
      persistence: ranges.persistence,
      badWeekProbability: ranges.badWeekProbability,
      badWeekDepthSigmas: pct.depthSigmas,
      itemsPerWeek: 0,
      weeklyVolatility: pct.volatility,
      shipmentSigma: 0,
    };
  }
  const days = DAYS_RANGES[nodeType];
  // Reusa los mismos sorteos (fracción de cada rango), así el nodo conserva su "posición" dentro del tipo.
  const t = { level: (pct.level - ranges.level[0]) / (ranges.level[1] - ranges.level[0] || 1), volatility: (pct.volatility - ranges.volatility[0]) / (ranges.volatility[1] - ranges.volatility[0] || 1) };
  const weeklyVolatility = lerp(days.volatility, t.volatility);
  const itemsPerWeek = lerp(days.itemsPerWeek, rng());
  // La variabilidad semanal que se calibró con Olist (σ del promedio de la semana) se reparte a partes iguales entre el
  // nivel del nodo y el ruido de cada envío: con `itemsPerWeek` envíos, σ_semana² = σ_nodo² + σ_envío² / itemsPerWeek.
  return {
    level: lerp(days.level, t.level),
    volatility: weeklyVolatility * Math.sqrt(LATENT_SHARE),
    persistence: DAYS_PERSISTENCE,
    badWeekProbability: ranges.badWeekProbability,
    badWeekDepthSigmas: pct.depthSigmas,
    itemsPerWeek,
    weeklyVolatility,
    shipmentSigma: weeklyVolatility * Math.sqrt((1 - LATENT_SHARE) * itemsPerWeek),
  };
}
