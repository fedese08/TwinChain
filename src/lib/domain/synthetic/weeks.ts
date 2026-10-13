// Aritmética de semanas en UTC. `dates.ts` trabaja en hora local y corta el ISO en UTC, lo que puede
// correr una semana un día al este de UTC (ver docs/pendientes.md); acá todo es UTC de punta a punta.
const DAY_MS = 24 * 60 * 60 * 1000;

function parseIso(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Lunes de la semana que contiene la fecha ISO (YYYY-MM-DD). */
export function mondayOf(iso: string): string {
  const ms = parseIso(iso);
  const dayOfWeek = new Date(ms).getUTCDay();
  const back = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return toIso(ms + back * DAY_MS);
}

export function addWeeksIso(iso: string, weeks: number): string {
  return toIso(parseIso(iso) + weeks * 7 * DAY_MS);
}

/** Última semana COMPLETA: el lunes anterior al de la semana en curso. */
export function lastCompleteWeek(now: Date = new Date()): string {
  return addWeeksIso(mondayOf(toIso(now.getTime())), -1);
}

/** `count` lunes consecutivos que terminan en `endWeek`, del más viejo al más nuevo. */
export function weekRange(endWeek: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addWeeksIso(endWeek, i - (count - 1)));
}
