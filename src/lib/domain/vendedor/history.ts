// Historial y avance de un nodo Vendedor con datos REALES de Olist (DÍAS de margen).
//
// Las semanas del vendedor son semanas CON ACTIVIDAD (la 1ª, la 2ª, ...), no calendario consecutivo: el modelo
// las define así. Para ponerlas en el eje de tiempo de la cadena, la k-ésima semana activa va en la k-ésima semana
// de la cadena ("tiempo comprimido"). Cuando se agotan las semanas reales, el avance sigue con una simulación
// anclada al nivel REAL del vendedor, así el monitoreo en vivo no se corta.
import { createRng, hashSeed } from "@/lib/domain/rng";
import { MAX_ADVANCE_WEEKS } from "@/lib/domain/synthetic/config";
import type { NewWeeklyRow } from "@/lib/domain/synthetic/estimate-baseline";
import { gaussian, median, stdDev } from "@/lib/domain/synthetic/stats";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { VendedorBaseline } from "./baseline";

export interface RealWeek {
  /** Promedio de margin_days de los ítems despachados esa semana. */
  margen: number;
  items: number;
}

/** Los campos de línea base que se copian a cada fila (están congelados). */
type BaselineFields = Pick<NewWeeklyRow, "baseline" | "baselineLowerBand" | "baselineUpperBand" | "weeklyBandLower" | "weeklyBandUpper">;

const baselineFields = (b: VendedorBaseline): BaselineFields => ({
  baseline: b.baseline,
  baselineLowerBand: b.lower,
  baselineUpperBand: b.upper,
  ...(b.weeklyLower !== undefined && b.weeklyUpper !== undefined ? { weeklyBandLower: b.weeklyLower, weeklyBandUpper: b.weeklyUpper } : {}),
});

function row(nodeId: string, weekStart: string, margin: number, fields: BaselineFields): NewWeeklyRow {
  return { nodeId, weekStart, actualValue: margin, ...fields, deficit: Math.max(0, fields.baseline - margin) };
}

/** Historial de un Vendedor: sus primeras `weekStarts.length` semanas activas, con la línea base congelada. */
export function buildVendedorRows(input: { nodeId: string; realWeeks: RealWeek[]; weekStarts: string[]; baseline: VendedorBaseline }): NewWeeklyRow[] {
  const { nodeId, realWeeks, weekStarts, baseline } = input;
  if (realWeeks.length < weekStarts.length) {
    throw new RangeError(`El vendedor tiene ${realWeeks.length} semanas y se piden ${weekStarts.length}`);
  }
  const fields = baselineFields(baseline);
  return weekStarts.map((weekStart, i) => row(nodeId, weekStart, realWeeks[i].margen, fields));
}

// --- Continuación simulada cuando se agotan las semanas reales ---------------------------------------------------
const LEVEL_WINDOW = 26;
const PERSISTENCE = 0.3;
const MIN_SIGMA_DAYS = 0.3;
const MAX_ABS_DAYS = 60; // el dominio del modelo: |margin_days| ≤ 60

/**
 * Siguiente semana simulada. El nivel y la variabilidad salen de las semanas REALES del vendedor (que no
 * cambian), no de las últimas observaciones: si se estimaran de las simuladas, el nivel derivaría como un paseo
 * aleatorio. El ruido de cada semana sale de un generador sembrado con (nodo, semana): la serie es función pura
 * de lo ya guardado y no depende de cómo se parta el avance.
 */
function simulatedNext(nodeId: string, weekStart: string, realMargins: number[], known: number[]): number {
  const tail = realMargins.slice(-LEVEL_WINDOW);
  const level = median(tail);
  const sigma = Math.max(tail.length > 1 ? stdDev(tail) : 0, MIN_SIGMA_DAYS);
  const rng = createRng(hashSeed(`vendedor-week:${nodeId}:${weekStart}`));
  const innovation = gaussian(rng(), rng());
  const deviation = PERSISTENCE * (known[known.length - 1] - level) + sigma * Math.sqrt(1 - PERSISTENCE ** 2) * innovation;
  return Math.min(MAX_ABS_DAYS, Math.max(-MAX_ABS_DAYS, level + deviation));
}

export interface VendedorAdvanceState {
  nodeId: string;
  /** Todo lo guardado del nodo, de la semana más vieja a la más nueva (reales y, si las hay, simuladas). */
  history: number[];
  /** El margen real completo del vendedor en el pool. */
  realMargins: number[];
  lastWeekStart: string;
  baseline: VendedorBaseline;
}

/** Avanza `weeks` semanas: las siguientes semanas reales del vendedor y, agotadas, semanas simuladas. */
export function advanceVendedor(state: VendedorAdvanceState, weeks: number): NewWeeklyRow[] {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_ADVANCE_WEEKS) {
    throw new RangeError(`Se puede avanzar entre 1 y ${MAX_ADVANCE_WEEKS} semanas por vez`);
  }
  const fields = baselineFields(state.baseline);
  const known = [...state.history];
  const rows: NewWeeklyRow[] = [];
  for (let w = 1; w <= weeks; w++) {
    const weekStart = addWeeksIso(state.lastWeekStart, w);
    const index = known.length; // la semana activa nº (index + 1) del vendedor
    const margin = index < state.realMargins.length ? state.realMargins[index] : simulatedNext(state.nodeId, weekStart, state.realMargins, known);
    known.push(margin);
    rows.push(row(state.nodeId, weekStart, margin, fields));
  }
  return rows;
}

/** ¿La semana nº `index` (base 0) de este vendedor es un dato real? */
export const isRealWeek = (index: number, realWeekCount: number) => index < realWeekCount;
