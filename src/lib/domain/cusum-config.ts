// Umbral del CUSUM según el costo f de una falsa alarma, a partir de la calibración (`scripts/calibrate-cusum.ts`).
//
// El umbral es CONFIGURABLE (HU1): lo que elige quien administra la cadena es cuánto cuesta una falsa alarma, en
// semanas de operar degradado, y el umbral h* sale de la tabla calibrada. f = 0 ignora las falsas alarmas (el detector
// más sensible); f = k, el costo de reconfigurar, es la cota superior (el más conservador).
import calibration from "@/data/cusum-calibracion.json";
import { interpolateThreshold } from "@/lib/domain/cusum-calibration";

/** Cota superior de f: el costo de una reconfiguración completa, igual al k por defecto de la tabla de resultados. */
export const MAX_FALSE_ALARM_COST = 3;
export const DEFAULT_FALSE_ALARM_COST = MAX_FALSE_ALARM_COST;

/** Los costos que se ofrecen para elegir, de más sensible a más conservador. */
export const FALSE_ALARM_COST_CHOICES = [0, 1, 2, 3] as const;

export const CUSUM_CALIBRATION = calibration;

const table = calibration.table.map((row) => ({ f: row.f, h: row.h }));

/** h* (en múltiplos del margen de la línea base) para un costo de falsa alarma, acotado a [0, MAX_FALSE_ALARM_COST]. */
export function thresholdForCost(f: number): number {
  return interpolateThreshold(table, Math.min(MAX_FALSE_ALARM_COST, Math.max(0, f)));
}
