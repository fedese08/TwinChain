// Script 4 — verificación de estabilidad estructural (C24, decisión 14): CUSUM retrospectivo estandarizado.
//
// ⚠️ La forma de estandarizar y el umbral son decisiones de metodología de la tesis. El umbral se calibró
// con una simulación de Monte Carlo contra el generador (ver cusum.test.ts) y es provisorio.
//
// La línea base se congela suponiendo que el historial es estable; si tuvo un cambio de nivel, esa línea
// base ya nace mala. Esta verificación es la que lo avisa, ANTES de confiar en ella.
//
// Para cada punto de corte posible se compara el nivel de las semanas anteriores contra el de las
// posteriores (la suma acumulada de desvíos, estandarizada: es la versión retrospectiva de la CUSUM) y se
// toma el corte más marcado. σ sale de la variación DENTRO de cada tramo, de modo que el propio cambio de
// nivel no la infla ni enmascara lo que se quiere detectar.
import { mean } from "./stats";

/**
 * Valor crítico del estadístico. Calibrado para ≈ 0,2 % de falsas alarmas por serie de nodo con una
 * ventana de 24 semanas (medido: 0,16 %): una cadena de hasta 50 nodos hace 50 pruebas a la vez y
 * casi nunca debe salir en alerta sin motivo. Con este umbral un cambio de nivel de −4 σ se detecta en el
 * 97 % de los casos. Los cambios hacia ARRIBA casi no se detectan (13–24 %): la escala se corta en 100 %.
 */
export const CUSUM_THRESHOLD = 6.4;

/** Mínimo de semanas a cada lado del corte: con menos, σ del tramo es demasiado inestable. */
const MIN_SEGMENT = 4;

/** Piso de σ: una serie casi constante (p. ej. pegada al 100 %) no debe disparar divisiones por ~0. */
const MIN_SIGMA = 0.5;

export interface InstabilityResult {
  alarm: boolean;
  /** Estadístico del corte más marcado (en σ). */
  statistic: number;
  /** Índice de la primera semana POSTERIOR al cambio de nivel, si hubo alarma. */
  changePointIndex: number | null;
}

export function detectInstability(values: number[], threshold: number = CUSUM_THRESHOLD): InstabilityResult {
  const n = values.length;
  let statistic = 0;
  let changePointIndex = 0;

  for (let cut = MIN_SEGMENT; cut <= n - MIN_SEGMENT; cut++) {
    const before = values.slice(0, cut);
    const after = values.slice(cut);
    const meanBefore = mean(before);
    const meanAfter = mean(after);
    const withinSumSquares =
      before.reduce((sum, v) => sum + (v - meanBefore) ** 2, 0) + after.reduce((sum, v) => sum + (v - meanAfter) ** 2, 0);
    const sigma = Math.max(Math.sqrt(withinSumSquares / (n - 2)), MIN_SIGMA);
    const z = Math.abs(meanBefore - meanAfter) / (sigma * Math.sqrt(1 / before.length + 1 / after.length));
    if (z > statistic) {
      statistic = z;
      changePointIndex = cut;
    }
  }

  const alarm = statistic > threshold;
  return { alarm, statistic, changePointIndex: alarm ? changePointIndex : null };
}

export interface ChainStability {
  status: "estable" | "alerta";
  /** Primera semana (ISO) en que algún nodo cambió de nivel. */
  changePointWeek?: string;
  unstableNodeCount: number;
  nodeCount: number;
}

/** Veredicto de la cadena: en alerta si ALGÚN nodo cambió de nivel. */
export function evaluateChainStability(nodes: { weekStarts: string[]; values: number[] }[]): ChainStability {
  let changePointWeek: string | undefined;
  let unstableNodeCount = 0;
  for (const node of nodes) {
    const result = detectInstability(node.values);
    if (!result.alarm || result.changePointIndex === null) continue;
    unstableNodeCount++;
    const week = node.weekStarts[result.changePointIndex];
    if (changePointWeek === undefined || week < changePointWeek) changePointWeek = week;
  }
  return {
    status: unstableNodeCount > 0 ? "alerta" : "estable",
    ...(changePointWeek ? { changePointWeek } : {}),
    unstableNodeCount,
    nodeCount: nodes.length,
  };
}

/**
 * Veredicto de estabilidad de una cadena derivado de las filas de `desempeno_semanal`: función pura de
 * los datos, así que NO hace falta guardarlo (no es una entidad del modelo) y se puede recalcular al
 * abrir la app o cuando entran nodos o semanas nuevas.
 *
 * Mira solo la ventana de entrenamiento de cada nodo (sus primeras `trainingWeeks` semanas): C24 valida
 * que la línea base se haya podido congelar sobre un historial estable, y eso no cambia con el monitoreo.
 * Los nodos con menos semanas que la ventana todavía no se pueden evaluar y se ignoran. Devuelve `null`
 * si ningún nodo se pudo evaluar.
 */
export function deriveChainStability(
  rows: { nodeId: string; weekStart: string; actualValue: number }[],
  trainingWeeks: number,
): ChainStability | null {
  const byNode = new Map<string, { weekStart: string; actualValue: number }[]>();
  for (const row of rows) {
    const list = byNode.get(row.nodeId) ?? [];
    list.push(row);
    byNode.set(row.nodeId, list);
  }

  const evaluable: { weekStarts: string[]; values: number[] }[] = [];
  for (const list of byNode.values()) {
    if (list.length < trainingWeeks) continue;
    const training = [...list].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(0, trainingWeeks);
    evaluable.push({ weekStarts: training.map((r) => r.weekStart), values: training.map((r) => r.actualValue) });
  }
  return evaluable.length === 0 ? null : evaluateChainStability(evaluable);
}
