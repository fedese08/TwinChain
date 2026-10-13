// Script 2 — generador de serie: el `valor_real` semanal de un nodo.
//
// Cada semana toma su "ruido" de un generador sembrado con (nodo, semana). Eso hace la serie una
// función pura de esos dos datos: sin estado oculto, y se puede continuar semanas después con
// exactamente el mismo proceso (monitoreo vivo) sin guardar ninguna semilla.
import { createRng, hashSeed } from "@/lib/domain/rng";
import type { NodeType } from "@/lib/domain/types";
import { BURN_IN_WEEKS, TRAINING_WEEKS } from "./config";
import { detectInstability } from "./cusum";
import { profileForNode, type NodeProfile } from "./node-profiles";
import { median, gaussian } from "./stats";
import { addWeeksIso } from "./weeks";

/** Cambio estructural de nivel: desde la semana `fromWeek` (ISO) el nivel del nodo se corre `sigmas` σ. */
export interface LevelShift {
  fromWeek: string;
  sigmas: number;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Las tres variables aleatorias de una semana de un nodo. */
function weekNoise(nodeId: string, weekStart: string) {
  const rng = createRng(hashSeed(`week:${nodeId}:${weekStart}`));
  return { innovation: gaussian(rng(), rng()), badWeekDraw: rng() };
}

/** Un paso AR(1): desviación de la semana a partir de la de la semana anterior. */
function step(profile: NodeProfile, previousDeviation: number, nodeId: string, weekStart: string) {
  const { innovation, badWeekDraw } = weekNoise(nodeId, weekStart);
  const innovationSigma = profile.volatility * Math.sqrt(1 - profile.persistence ** 2);
  const deviation = profile.persistence * previousDeviation + innovationSigma * innovation;
  // La semana mala es un golpe aislado: no entra en el estado AR(1), no se arrastra.
  const badWeek = badWeekDraw < profile.badWeekProbability ? -profile.badWeekDepthSigmas * profile.volatility : 0;
  return { deviation, badWeek };
}

/**
 * Serie de `weekStarts` consecutivas (lunes ISO, del más viejo al más nuevo) de un nodo. Es
 * determinística: mismo nodo y mismas semanas, misma serie.
 */
export function generateSeries(input: {
  nodeId: string;
  nodeType: NodeType;
  weekStarts: string[];
  levelShift?: LevelShift;
}): number[] {
  const { nodeId, nodeType, weekStarts, levelShift } = input;
  const profile = profileForNode(nodeId, nodeType);

  // Arranque descartado para que el proceso llegue a su régimen estacionario.
  let deviation = 0;
  for (let b = BURN_IN_WEEKS; b >= 1; b--) {
    deviation = step(profile, deviation, nodeId, addWeeksIso(weekStarts[0], -b)).deviation;
  }

  return weekStarts.map((weekStart) => {
    const next = step(profile, deviation, nodeId, weekStart);
    deviation = next.deviation;
    const shifted = levelShift && weekStart >= levelShift.fromWeek ? levelShift.sigmas * profile.volatility : 0;
    return clamp(profile.level + shifted + next.deviation + next.badWeek);
  });
}

/**
 * Continúa la serie de un nodo `weeks` semanas más allá de su última semana registrada (monitoreo
 * vivo).
 *
 * **Sin estado oculto:** cada semana nueva se calcula SOLO a partir de lo ya registrado, así que el
 * resultado no depende de cómo el cliente parta el avance (de a una semana o de a varias).
 *
 * **Anclada a un nivel, no a la última observación:** si el nivel se estimara de las últimas semanas,
 * se desviaría con el tiempo como un paseo aleatorio (1,3 σ a las 52 semanas) y los nodos terminarían
 * derivando a valores irreales. El nivel es el del perfil del nodo; salvo que su ventana de
 * entrenamiento haya tenido un cambio de nivel (la verificación C24 lo detecta): ahí es el nivel
 * posterior al cambio, que se reestima con todo lo registrado desde entonces.
 */
export function continueSeries(input: {
  nodeId: string;
  nodeType: NodeType;
  /** TODAS las observaciones registradas del nodo, de la más vieja a la más nueva. */
  history: number[];
  lastWeekStart: string;
  weeks: number;
}): { weekStarts: string[]; values: number[] } {
  const { nodeId, nodeType, lastWeekStart, weeks } = input;
  const profile = profileForNode(nodeId, nodeType);
  const known = [...input.history];

  // El cambio de nivel, si lo hubo, se decide una sola vez: depende solo de la ventana de entrenamiento.
  const training = known.slice(0, TRAINING_WEEKS);
  const instability = training.length === TRAINING_WEEKS ? detectInstability(training) : null;
  const changePoint = instability?.alarm ? instability.changePointIndex : null;
  const levelNow = () => (changePoint !== null ? median(known.slice(changePoint)) : profile.level);

  const weekStarts: string[] = [];
  const values: number[] = [];
  for (let w = 1; w <= weeks; w++) {
    const weekStart = addWeeksIso(lastWeekStart, w);
    const level = levelNow();
    const previousDeviation = known[known.length - 1] - level;
    const next = step(profile, previousDeviation, nodeId, weekStart);
    const value = clamp(level + next.deviation + next.badWeek);
    known.push(value);
    weekStarts.push(weekStart);
    values.push(value);
  }
  return { weekStarts, values };
}
