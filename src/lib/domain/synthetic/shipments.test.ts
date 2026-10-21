// Sensor por envío (RF009) y agregación semanal (RF010).
import { describe, expect, it } from "vitest";
import type { NodeType } from "@/lib/domain/types";
import { buildChainHistory, historyWeekStarts } from "./build-history";
import { profileForNode } from "./node-profiles";
import { aggregateShipments, continueSensorWeeks, rowsFromBatches, sensorWeeks, shipmentsForWeek, type Shipment } from "./shipments";
import { stdDev } from "./stats";

const weeks = historyWeekStarts("2026-10-12");
const TYPES: NodeType[] = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"];

describe("agregación semanal de envíos", () => {
  it("agrupa por semana (lunes), promedia el margen y cuenta los envíos, sin importar el origen", () => {
    const shipments: Shipment[] = [
      { date: "2026-10-05", margin: 2 }, // lunes
      { date: "2026-10-09", margin: 4 }, // viernes de la misma semana
      { date: "2026-10-12", margin: -1 }, // lunes siguiente
      { date: "2026-10-11", margin: 6 }, // domingo: pertenece a la semana del 5
    ];
    expect(aggregateShipments(shipments)).toEqual([
      { weekStart: "2026-10-05", actualValue: 4, items: 3 },
      { weekStart: "2026-10-12", actualValue: -1, items: 1 },
    ]);
    expect(aggregateShipments([])).toEqual([]);
  });
});

describe("sensor simulado por envío", () => {
  it("emite envíos en días hábiles de la semana pedida, determinísticos por (nodo, semana)", () => {
    const a = shipmentsForWeek({ nodeId: "n1", nodeType: "Fabrica", weekStart: "2026-10-05", level: 3.5, count: 6 });
    expect(a).toHaveLength(6);
    expect(shipmentsForWeek({ nodeId: "n1", nodeType: "Fabrica", weekStart: "2026-10-05", level: 3.5, count: 6 })).toEqual(a);
    expect(a.every((s) => s.date >= "2026-10-05" && s.date <= "2026-10-09")).toBe(true);
    expect(a.every((s) => Math.abs(s.margin) <= 15)).toBe(true);
  });

  it("el historial es el lote semanal de esos envíos: mismos valores que guarda la cadena", () => {
    const batches = sensorWeeks({ nodeId: "n1", nodeType: "Almacen", weekStarts: weeks });
    expect(batches).toHaveLength(weeks.length);
    expect(batches.every((b) => b.items >= 1 && Number.isInteger(b.items))).toBe(true);
    const { rows } = buildChainHistory([{ id: "n1", type: "Almacen", baseline: { baseline: 3, lower: 2, upper: 4, source: "ml" } }], { endWeek: "2026-10-12" });
    expect(rows.map((r) => r.actualValue)).toEqual(batches.map((b) => b.actualValue));
  });

  it("la variabilidad semanal que ve el sistema sigue siendo la calibrada con Olist (la de cada perfil)", () => {
    for (const type of TYPES) {
      const ratios: number[] = [];
      for (let i = 0; i < 80; i++) {
        const id = `sig-${type}-${i}`;
        const values = sensorWeeks({ nodeId: id, nodeType: type, weekStarts: weeks }).map((b) => b.actualValue);
        ratios.push(stdDev(values) / profileForNode(id, type, "dias").weeklyVolatility);
      }
      const typical = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      expect(typical).toBeGreaterThan(0.8);
      expect(typical).toBeLessThan(1.25);
    }
  });

  it("el avance semanal no depende de cómo se parta (de a una semana o de a varias)", () => {
    const history = sensorWeeks({ nodeId: "n1", nodeType: "Proveedor", weekStarts: weeks });
    const base = { nodeId: "n1", nodeType: "Proveedor" as NodeType, history: history.map((b) => b.actualValue), lastWeekStart: weeks[weeks.length - 1] };
    const four = continueSensorWeeks({ ...base, weeks: 4 });
    const a = continueSensorWeeks({ ...base, weeks: 2 });
    const b = continueSensorWeeks({ ...base, history: [...base.history, ...a.map((x) => x.actualValue)], lastWeekStart: a[1].weekStart, weeks: 2 });
    expect([...a, ...b]).toEqual(four);
  });
});

describe("ingesta de envíos de otra fuente (reemplaza al simulador sin cambiar el resto)", () => {
  const state = { nodeId: "n1", lastWeekStart: "2026-10-05", baseline: 3, baselineLowerBand: 2.1, baselineUpperBand: 3.9 };

  it("agrega los envíos por semana y arma filas con la línea base congelada y el déficit sin negativos", () => {
    const batches = aggregateShipments([
      { date: "2026-10-12", margin: 1 },
      { date: "2026-10-14", margin: 2 },
      { date: "2026-10-19", margin: 5 },
    ]);
    const rows = rowsFromBatches(state, batches);
    expect(rows).toEqual([
      { nodeId: "n1", weekStart: "2026-10-12", actualValue: 1.5, baseline: 3, baselineLowerBand: 2.1, baselineUpperBand: 3.9, deficit: 1.5 },
      { nodeId: "n1", weekStart: "2026-10-19", actualValue: 5, baseline: 3, baselineLowerBand: 2.1, baselineUpperBand: 3.9, deficit: 0 },
    ]);
  });

  it("rechaza semanas que ya estaban registradas: el historial no se reescribe", () => {
    expect(() => rowsFromBatches(state, aggregateShipments([{ date: "2026-10-06", margin: 2 }]))).toThrow(RangeError);
  });

  it("los envíos del simulador y los de otra fuente dan el mismo lote semanal", () => {
    const sim = shipmentsForWeek({ nodeId: "n1", nodeType: "Fabrica", weekStart: "2026-10-12", level: 3, count: 4 });
    const [batch] = aggregateShipments(sim);
    expect(batch.items).toBe(4);
    expect(batch.actualValue).toBeCloseTo(sim.reduce((s, x) => s + x.margin, 0) / 4, 12);
  });
});
