// Lectura del CSV de envíos de un nodo (la fuente real de la ingesta, RF009 y RF010): una fila por envío, con su fecha y su
// margen de despacho en días (positivo = despachó antes de su plazo). Es lo mismo que recibe `POST /api/cadenas/[id]/envios`
// y lo mismo que emite el simulador de sensores; el servidor los agrega por semana.
//
// Formato aceptado (la primera fila puede ser un encabezado o no):
//   fecha,margen
//   2026-10-19,2.5
//   2026-10-20,-1
// Separador: coma, punto y coma o tabulación. Con punto y coma o tabulación el decimal puede ser coma (2,5), como en una
// planilla en español. Fecha: AAAA-MM-DD o DD/MM/AAAA. Margen: entre −60 y 60 días.
import { mondayOf } from "@/lib/domain/synthetic/weeks";

export const MAX_SHIPMENTS_PER_FILE = 5000;
const MIN_MARGIN = -60;
const MAX_MARGIN = 60;

export interface ShipmentRow {
  fecha: string;
  margen: number;
}

export interface ParsedShipments {
  envios: ShipmentRow[];
  /** Problemas de las filas leídas (como mucho 5 mensajes); si hay alguno, no se debería importar. */
  errors: string[];
  /** Cuántas filas tienen problemas (puede ser más que los mensajes). */
  badRows: number;
}

const HEADER_DATE = ["fecha", "date", "fecha_envio", "fecha_despacho", "dia"];
const HEADER_MARGIN = ["margen", "margin", "margen_dias", "margin_days", "dias"];

function isRealDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Devuelve la fecha ISO (AAAA-MM-DD) o `null` si el texto no es una fecha válida. */
export function parseDate(raw: string): string | null {
  const text = raw.trim().replace(/^"|"$/g, "");
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (match) return isRealDate(+match[1], +match[2], +match[3]) ? `${match[1]}-${match[2]}-${match[3]}` : null;
  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) {
    const [day, month, year] = [+match[1], +match[2], +match[3]];
    return isRealDate(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  }
  return null;
}

function parseMargin(raw: string, decimalComma: boolean): number | null {
  const text = raw.trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  if (!text) return null;
  const normalized = decimalComma ? text.replace(",", ".") : text;
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

export function parseShipmentsCsv(input: string): ParsedShipments {
  const lines = input.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  const result: ParsedShipments = { envios: [], errors: [], badRows: 0 };
  if (lines.length === 0) {
    result.errors.push("El archivo está vacío.");
    result.badRows = 1;
    return result;
  }

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const decimalComma = delimiter !== ",";
  const split = (line: string) => line.split(delimiter);

  // ¿La primera fila es un encabezado? Lo es si su primera celda no es una fecha.
  let dateCol = 0;
  let marginCol = 1;
  let start = 0;
  const first = split(lines[0]);
  if (parseDate(first[0] ?? "") === null) {
    const names = first.map((cell) => cell.trim().toLowerCase().replace(/^"|"$/g, ""));
    const d = names.findIndex((n) => HEADER_DATE.includes(n));
    const m = names.findIndex((n) => HEADER_MARGIN.includes(n));
    if (d >= 0 && m >= 0) {
      dateCol = d;
      marginCol = m;
    }
    start = 1;
  }

  const fail = (lineNumber: number, message: string) => {
    result.badRows += 1;
    if (result.errors.length < 5) result.errors.push(`Fila ${lineNumber}: ${message}`);
  };

  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]);
    const lineNumber = i + 1;
    if (cells.length <= Math.max(dateCol, marginCol)) {
      fail(lineNumber, "faltan columnas (se esperan fecha y margen).");
      continue;
    }
    const fecha = parseDate(cells[dateCol]);
    if (fecha === null) {
      fail(lineNumber, `la fecha "${cells[dateCol].trim()}" no es válida (usá AAAA-MM-DD o DD/MM/AAAA).`);
      continue;
    }
    const margen = parseMargin(cells[marginCol], decimalComma);
    if (margen === null) {
      fail(lineNumber, `el margen "${cells[marginCol].trim()}" no es un número.`);
      continue;
    }
    if (margen < MIN_MARGIN || margen > MAX_MARGIN) {
      fail(lineNumber, `el margen ${margen} está fuera de rango (entre ${MIN_MARGIN} y ${MAX_MARGIN} días).`);
      continue;
    }
    result.envios.push({ fecha, margen });
  }

  if (result.envios.length === 0 && result.badRows === 0) {
    result.errors.push("El archivo no tiene envíos.");
    result.badRows = 1;
  }
  if (result.envios.length > MAX_SHIPMENTS_PER_FILE) {
    result.errors.push(`El archivo tiene ${result.envios.length} envíos y el máximo por carga es ${MAX_SHIPMENTS_PER_FILE}.`);
    result.badRows += 1;
  }
  return result;
}

export interface ShipmentsSummary {
  weeks: { weekStart: string; items: number; mean: number }[];
  from: string;
  to: string;
  /** Envíos de semanas que el nodo ya tiene registradas: el servidor los rechazaría. */
  staleShipments: number;
}

/** Lo que va a pasar al importar: cuántas semanas nuevas salen y cuántos envíos caen en semanas ya registradas. */
export function summarizeShipments(envios: ShipmentRow[], lastWeekStart: string | null): ShipmentsSummary {
  const byWeek = new Map<string, number[]>();
  for (const e of envios) {
    const week = mondayOf(e.fecha);
    byWeek.set(week, [...(byWeek.get(week) ?? []), e.margen]);
  }
  const weeks = [...byWeek]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, margins]) => ({ weekStart, items: margins.length, mean: margins.reduce((s, m) => s + m, 0) / margins.length }));
  const stale = lastWeekStart ? weeks.filter((w) => w.weekStart <= lastWeekStart).reduce((s, w) => s + w.items, 0) : 0;
  const dates = envios.map((e) => e.fecha).sort();
  return { weeks, from: dates[0] ?? "", to: dates[dates.length - 1] ?? "", staleShipments: stale };
}

/** Plantilla descargable: un encabezado y unos envíos de ejemplo de la semana siguiente a `lastWeekStart`. */
export function shipmentsTemplate(nextMonday: string): string {
  const day = (offset: number) => {
    const [y, m, d] = nextMonday.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  };
  return ["fecha,margen", `${day(0)},2.5`, `${day(1)},3`, `${day(2)},-1`, `${day(3)},4.5`, ""].join("\n");
}
