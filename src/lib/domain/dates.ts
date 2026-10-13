const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // retrocede hasta el lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * 7 * DAY_MS);
}

export function addDaysIso(isoDate: string, days: number): string {
  return toIsoDate(new Date(new Date(isoDate).getTime() + days * DAY_MS));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatWeekLabel(isoDate: string): string {
  const d = new Date(isoDate);
  // `new Date("YYYY-MM-DD")` es medianoche UTC: formatearlo en hora local corre la fecha un día hacia
  // atrás en zonas al oeste de UTC (en Argentina, un lunes se veía como domingo).
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
}
