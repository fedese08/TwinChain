import { describe, expect, it } from "vitest";
import { MAX_SHIPMENTS_PER_FILE, parseDate, parseShipmentsCsv, shipmentsTemplate, summarizeShipments } from "@/lib/ingestion/shipments-csv";

describe("CSV de envíos", () => {
  it("lee un archivo con encabezado, con coma como separador y punto decimal", () => {
    const parsed = parseShipmentsCsv("fecha,margen\n2026-10-19,2.5\n2026-10-20,-1\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.envios).toEqual([
      { fecha: "2026-10-19", margen: 2.5 },
      { fecha: "2026-10-20", margen: -1 },
    ]);
  });

  it("también lee un archivo sin encabezado y con saltos de línea de Windows", () => {
    const parsed = parseShipmentsCsv("2026-10-19,3\r\n2026-10-21,4\r\n");
    expect(parsed.envios).toHaveLength(2);
    expect(parsed.badRows).toBe(0);
  });

  it("acepta punto y coma con decimal en coma y fechas DD/MM/AAAA, como una planilla en español", () => {
    const parsed = parseShipmentsCsv("Fecha;Margen\n19/10/2026;2,5\n20/10/2026;-1,25\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.envios).toEqual([
      { fecha: "2026-10-19", margen: 2.5 },
      { fecha: "2026-10-20", margen: -1.25 },
    ]);
  });

  it("reconoce las columnas por su nombre aunque estén en otro orden y haya columnas de más", () => {
    const parsed = parseShipmentsCsv("pedido,margin_days,date\nA1,2,2026-10-19\nA2,3,2026-10-20\n");
    expect(parsed.envios).toEqual([
      { fecha: "2026-10-19", margen: 2 },
      { fecha: "2026-10-20", margen: 3 },
    ]);
  });

  it("marca las filas con problemas indicando el número de fila y no las importa", () => {
    const parsed = parseShipmentsCsv("fecha,margen\n2026-13-45,2\n2026-10-20,abc\n2026-10-21,99\n2026-10-22,1\n");
    expect(parsed.envios).toEqual([{ fecha: "2026-10-22", margen: 1 }]);
    expect(parsed.badRows).toBe(3);
    expect(parsed.errors[0]).toContain("Fila 2");
    expect(parsed.errors.join(" ")).toContain("fuera de rango");
  });

  it("rechaza un archivo vacío o sin envíos", () => {
    expect(parseShipmentsCsv("").badRows).toBe(1);
    expect(parseShipmentsCsv("fecha,margen\n").errors[0]).toContain("no tiene envíos");
  });

  it("no acepta más envíos por carga de los que admite el servidor", () => {
    const rows = Array.from({ length: MAX_SHIPMENTS_PER_FILE + 1 }, () => "2026-10-19,1").join("\n");
    expect(parseShipmentsCsv(rows).errors.join(" ")).toContain("máximo");
  });

  it("valida que la fecha exista (no existe el 31 de febrero)", () => {
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("29/02/2024")).toBe("2024-02-29");
  });

  it("resume por semana y cuenta los envíos de semanas que el nodo ya tiene", () => {
    const envios = [
      { fecha: "2026-10-12", margen: 1 },
      { fecha: "2026-10-19", margen: 2 },
      { fecha: "2026-10-20", margen: 4 },
    ];
    const summary = summarizeShipments(envios, "2026-10-12");
    expect(summary.weeks).toEqual([
      { weekStart: "2026-10-12", items: 1, mean: 1 },
      { weekStart: "2026-10-19", items: 2, mean: 3 },
    ]);
    expect(summary.staleShipments).toBe(1);
  });

  it("la plantilla descargable se lee sin errores", () => {
    const parsed = parseShipmentsCsv(shipmentsTemplate("2026-10-26"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envios).toHaveLength(4);
    expect(parsed.envios[0].fecha).toBe("2026-10-26");
  });
});
