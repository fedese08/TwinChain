// Unidades del desempeño de un nodo y adaptador hacia el motor de simulación.
//
// Hay DOS escalas en la misma cadena:
//   - "pct":  nodos sintéticos, desempeño de 0 a 100.
//   - "dias": nodos Vendedor con datos REALES de Olist, en días de margen (`margin_days`): positivo = despachó
//             antes de su compromiso, negativo = despachó tarde. Es lo que define docs/modelo-datos.md y lo que
//             predice el modelo de ML.
//
// El motor propaga caídas RELATIVAS (`baseline × (1 − drop/100)`), pero después suma los déficits de todos los
// nodos y los divide por 100 ("semanas malas equivalentes"). Sumar días con puntos porcentuales no tiene
// sentido: un Vendedor casi no pesaría. Por eso, ANTES de llamar al motor, los nodos en días se pasan a una
// escala relativa a su propia línea base (línea base = 100, o sea "% de la línea base"). El motor no cambia, y
// los nodos en 0-100 pasan sin tocar, así que sus resultados quedan idénticos a los de siempre.
import type { SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";

export type PerformanceUnit = "pct" | "dias";

export const unitOfNode = (node: Pick<SupplyChainNode, "olistSellerId">): PerformanceUnit => (node.olistSellerId ? "dias" : "pct");

/**
 * Piso de la línea base (en días) para pasarla a escala relativa. Los vendedores crónicamente tarde tienen una
 * línea base de cero o negativa (0,2 % de los vendedores de Olist): sin piso, "perder el X % de la línea base" no
 * existe, y el motor no vería ningún déficit en esos nodos.
 */
export const MIN_BASELINE_DAYS = 0.5;

export interface EngineAdapter {
  /** Filas listas para el motor: iguales a las de entrada si no hay nodos en días. */
  rows: WeeklyPerformance[];
  /** Pasa un valor del motor a las unidades propias del nodo (días para los Vendedor reales). */
  toDisplay: (nodeId: string, engineValue: number) => number;
  unitOf: (nodeId: string) => PerformanceUnit;
}

export function adaptForEngine(nodes: Pick<SupplyChainNode, "id" | "olistSellerId">[], rows: WeeklyPerformance[]): EngineAdapter {
  const daysNodes = new Set(nodes.filter((n) => unitOfNode(n) === "dias").map((n) => n.id));
  const unitOf = (nodeId: string): PerformanceUnit => (daysNodes.has(nodeId) ? "dias" : "pct");
  if (daysNodes.size === 0) return { rows, toDisplay: (_nodeId, value) => value, unitOf };

  // La escala sale de la línea base del nodo, que está congelada: es la misma en todas sus filas.
  const scaleByNode = new Map<string, number>();
  for (const row of rows) {
    if (daysNodes.has(row.nodeId) && !scaleByNode.has(row.nodeId)) {
      scaleByNode.set(row.nodeId, 100 / Math.max(row.baseline, MIN_BASELINE_DAYS));
    }
  }
  const scaleOf = (nodeId: string) => scaleByNode.get(nodeId) ?? 1;

  const scaled = rows.map((row): WeeklyPerformance => {
    if (!daysNodes.has(row.nodeId)) return row;
    const s = scaleOf(row.nodeId);
    return {
      ...row,
      actualValue: row.actualValue * s,
      baseline: Math.max(row.baseline, MIN_BASELINE_DAYS) * s,
      // Una banda por debajo de cero no tiene sentido como porcentaje de la línea base.
      baselineLowerBand: Math.max(0, row.baselineLowerBand * s),
      baselineUpperBand: Math.max(0, row.baselineUpperBand * s),
      weeklyBandLower: row.weeklyBandLower === undefined ? undefined : Math.max(0, row.weeklyBandLower * s),
      weeklyBandUpper: row.weeklyBandUpper === undefined ? undefined : Math.max(0, row.weeklyBandUpper * s),
      deficit: row.deficit * s,
    };
  });

  return { rows: scaled, toDisplay: (nodeId, value) => value / scaleOf(nodeId), unitOf };
}

/** "3,2 d" o "87 %": el valor con la unidad del nodo, para mostrar. */
export function formatPerformance(value: number, unit: PerformanceUnit, digits = 1): string {
  return unit === "dias" ? `${value.toFixed(digits)} d` : `${value.toFixed(digits)} %`;
}
