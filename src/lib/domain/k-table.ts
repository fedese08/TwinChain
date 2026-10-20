// Constantes y ayudas de la tabla k, compartidas por el motor y las pantallas.
import type { KTableRow } from "@/lib/domain/types";

/**
 * Fracciones de propagación `c` que barre el motor (RF027). Es un SUPUESTO del modelo, sin calibración: el
 * umbral se reporta para cada valor de `c`, no mezclado. El valor central es el que resumen las pantallas.
 */
export const PROPAGATION_FRACTIONS = [0.45, 0.55, 0.65] as const;
export const CENTRAL_PROPAGATION_FRACTION = 0.55;

/** La tabla k llega hasta este costo de reconfigurar, en semanas de operar como ahora. */
export const K_MAX = 10;

/** Las filas de UNA fracción de propagación. Las corridas viejas (sin fracción) se toman enteras. */
export function rowsForFraction(rows: KTableRow[], fraction: number): KTableRow[] {
  return rows.filter((r) => r.propagationFraction === undefined || Math.abs(r.propagationFraction - fraction) < 1e-9);
}

/** Las filas que resumen la corrida en un listado: las de la fracción central. */
export const centralRows = (rows: KTableRow[]): KTableRow[] => rowsForFraction(rows, CENTRAL_PROPAGATION_FRACTION);

/** Las fracciones que tiene una tabla (una sola, la implícita, si es de una corrida vieja). */
export function fractionsOf(rows: KTableRow[]): number[] {
  const set = new Set(rows.flatMap((r) => (r.propagationFraction === undefined ? [] : [r.propagationFraction])));
  return [...set].sort((a, b) => a - b);
}
