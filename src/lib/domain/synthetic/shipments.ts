// Sensor simulado a nivel de ENVÍO individual (RF009) y su agregación semanal (RF010).
//
// En una instalación real cada nodo tendría sensores IoT que reportan cada envío (cuánto se adelantó o se atrasó
// respecto de su plazo). Acá el simulador de sensores hace ese papel: para cada semana del nodo emite sus envíos, y la
// ingesta los agrega por semana ANTES de cualquier análisis (media del margen y cantidad de envíos). Lo que sigue
// (línea base del modelo, CUSUM, simulación) solo ve el lote semanal, nunca de dónde vienen los envíos.
//
// La fuente es intercambiable: `aggregateShipments` agrega envíos de CUALQUIER origen (el simulador, un CSV semanal o
// sensores reales) y es lo único que el resto del sistema necesita.
import { createRng, hashSeed } from "@/lib/domain/rng";
import type { NodeType } from "@/lib/domain/types";
import { continueSeries, generateSeries, generateWeeklyItems, type LevelShift } from "./generate-series";
import { profileForNode } from "./node-profiles";
import { gaussian } from "./stats";
import { addDaysIso, mondayOf } from "./weeks";

/** Un envío: cuándo se despachó y su margen de despacho en días (positivo = antes de su plazo). */
export interface Shipment {
  /** Fecha ISO (YYYY-MM-DD) del envío. */
  date: string;
  margin: number;
}

/** El lote de una semana, ya agregado: lo que se guarda como desempeño semanal del nodo. */
export interface WeeklyBatch {
  /** Lunes de la semana. */
  weekStart: string;
  /** Media del margen de los envíos de la semana, en días. */
  actualValue: number;
  /** Cantidad de envíos de la semana. */
  items: number;
}

const MAX_ABS_DAYS = 15;
const clampDays = (value: number) => Math.min(MAX_ABS_DAYS, Math.max(-MAX_ABS_DAYS, value));

/** Agrega envíos por semana (lunes ISO), de la más vieja a la más nueva. Las semanas sin envíos no producen lote. */
export function aggregateShipments(shipments: Shipment[]): WeeklyBatch[] {
  const byWeek = new Map<string, number[]>();
  for (const shipment of shipments) {
    const week = mondayOf(shipment.date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), shipment.margin]);
  }
  return [...byWeek]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, margins]) => ({
      weekStart,
      actualValue: margins.reduce((sum, m) => sum + m, 0) / margins.length,
      items: margins.length,
    }));
}

/** Los envíos que emite el sensor de un nodo en una semana: `count` envíos con margen = nivel de la semana + ruido propio. */
export function shipmentsForWeek(input: { nodeId: string; nodeType: NodeType; weekStart: string; level: number; count: number }): Shipment[] {
  const profile = profileForNode(input.nodeId, input.nodeType, "dias");
  const rng = createRng(hashSeed(`shipments:${input.nodeId}:${input.weekStart}`));
  return Array.from({ length: input.count }, () => {
    const margin = clampDays(input.level + profile.shipmentSigma * gaussian(rng(), rng()));
    // Días hábiles: lunes a viernes.
    return { date: addDaysIso(input.weekStart, Math.floor(rng() * 5)), margin };
  });
}

/** Emite los envíos de cada semana a partir del nivel de esa semana y los agrega: el lote semanal de cada una. */
function batchesFromLevels(nodeId: string, nodeType: NodeType, weekStarts: string[], levels: number[]): WeeklyBatch[] {
  const counts = generateWeeklyItems({ nodeId, nodeType, weekStarts });
  const batches = weekStarts.map((weekStart, i) =>
    aggregateShipments(shipmentsForWeek({ nodeId, nodeType, weekStart, level: levels[i], count: counts[i] }))[0],
  );
  return batches;
}

/**
 * Historial de un nodo con sensor simulado: para cada semana, sus envíos agregados. Determinístico por (nodo, semana):
 * el mismo nodo produce siempre el mismo historial.
 */
export function sensorWeeks(input: { nodeId: string; nodeType: NodeType; weekStarts: string[]; levelShift?: LevelShift }): WeeklyBatch[] {
  const levels = generateSeries({ ...input, unit: "dias" });
  return batchesFromLevels(input.nodeId, input.nodeType, input.weekStarts, levels);
}

/**
 * Continúa el sensor de un nodo `weeks` semanas más allá de su última semana (monitoreo vivo): cada semana nueva se
 * calcula SOLO a partir de lo ya registrado, así el resultado no depende de cómo se parta el avance.
 */
export function continueSensorWeeks(input: {
  nodeId: string;
  nodeType: NodeType;
  /** Medias semanales ya registradas, de la más vieja a la más nueva. */
  history: number[];
  lastWeekStart: string;
  weeks: number;
}): WeeklyBatch[] {
  // Se avanza de a UNA semana y cada una se apoya en lo que quedó registrado (los lotes ya agregados), igual que
  // cuando el avance se pide en partes: por eso el resultado no depende de cómo se parta.
  const history = [...input.history];
  let lastWeekStart = input.lastWeekStart;
  const batches: WeeklyBatch[] = [];
  for (let w = 0; w < input.weeks; w++) {
    const next = continueSeries({ nodeId: input.nodeId, nodeType: input.nodeType, history, lastWeekStart, weeks: 1, unit: "dias" });
    const [batch] = batchesFromLevels(input.nodeId, input.nodeType, next.weekStarts, next.values);
    batches.push(batch);
    history.push(batch.actualValue);
    lastWeekStart = batch.weekStart;
  }
  return batches;
}

/** Lo que se necesita saber de un nodo para ponerle filas nuevas: su línea base congelada y su última semana. */
export interface FrozenBaselineState {
  nodeId: string;
  lastWeekStart: string;
  baseline: number;
  baselineLowerBand: number;
  baselineUpperBand: number;
  weeklyBandLower?: number;
  weeklyBandUpper?: number;
}

/**
 * Convierte lotes semanales (de cualquier fuente: el simulador, un CSV o sensores reales) en filas de desempeño del nodo,
 * con la línea base congelada (RF014: no se recalcula con datos nuevos) y el déficit sin valores negativos (RF013).
 * Las semanas tienen que ser posteriores a la última registrada: el historial no se reescribe.
 */
export function rowsFromBatches(state: FrozenBaselineState, batches: WeeklyBatch[]) {
  const stale = batches.find((b) => b.weekStart <= state.lastWeekStart);
  if (stale) {
    throw new RangeError(`La semana ${stale.weekStart} no es posterior a la última registrada (${state.lastWeekStart})`);
  }
  return batches.map((b) => ({
    nodeId: state.nodeId,
    weekStart: b.weekStart,
    actualValue: b.actualValue,
    baseline: state.baseline,
    baselineLowerBand: state.baselineLowerBand,
    baselineUpperBand: state.baselineUpperBand,
    ...(state.weeklyBandLower !== undefined && state.weeklyBandUpper !== undefined
      ? { weeklyBandLower: state.weeklyBandLower, weeklyBandUpper: state.weeklyBandUpper }
      : {}),
    deficit: Math.max(0, state.baseline - b.actualValue),
  }));
}
