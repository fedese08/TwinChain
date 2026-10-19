import { describe, expect, it } from "vitest";
import type { WeeklyPerformance } from "@/lib/domain/types";
import { adaptForEngine, formatPerformance, MIN_BASELINE_DAYS, unitOfNode } from "./units";

const row = (nodeId: string, over: Partial<WeeklyPerformance> = {}): WeeklyPerformance => ({
  id: `${nodeId}-r`,
  nodeId,
  weekStart: "2026-01-05",
  actualValue: 90,
  baseline: 92,
  baselineLowerBand: 90,
  baselineUpperBand: 94,
  deficit: 2,
  ...over,
});

describe("unidad de un nodo", () => {
  it("es días solo si tiene un vendedor real de Olist asociado", () => {
    expect(unitOfNode({ olistSellerId: "abc" })).toBe("dias");
    expect(unitOfNode({ olistSellerId: undefined })).toBe("pct");
  });
});

describe("adaptador hacia el motor", () => {
  it("sin nodos en días devuelve EXACTAMENTE las mismas filas: los resultados de siempre no cambian", () => {
    const rows = [row("a"), row("b")];
    const adapter = adaptForEngine([{ id: "a" }, { id: "b" }], rows);
    expect(adapter.rows).toBe(rows);
    expect(adapter.toDisplay("a", 12.5)).toBe(12.5);
  });

  it("los nodos en 0-100 de una cadena mixta pasan sin tocar", () => {
    const pct = row("a");
    const adapter = adaptForEngine([{ id: "a" }, { id: "v", olistSellerId: "s" }], [pct, row("v", { baseline: 3, actualValue: 2, deficit: 1, baselineLowerBand: 2, baselineUpperBand: 4 })]);
    expect(adapter.rows[0]).toBe(pct);
  });

  it("un nodo en días queda con la línea base en 100 y todo lo demás relativo a ella", () => {
    const v = row("v", {
      baseline: 3, baselineLowerBand: 1.5, baselineUpperBand: 4.5, weeklyBandLower: 0.6, weeklyBandUpper: 6, actualValue: 2.4, deficit: 0.6,
    });
    const [scaled] = adaptForEngine([{ id: "v", olistSellerId: "s" }], [v]).rows;
    expect(scaled.baseline).toBeCloseTo(100);
    expect(scaled.baselineLowerBand).toBeCloseTo(50);
    expect(scaled.baselineUpperBand).toBeCloseTo(150);
    expect(scaled.weeklyBandLower).toBeCloseTo(20);
    expect(scaled.actualValue).toBeCloseTo(80);
    expect(scaled.deficit).toBeCloseTo(20); // 0,6 de 3 días = 20 % de la línea base
  });

  it("toDisplay deshace la escala: vuelve a días", () => {
    const adapter = adaptForEngine([{ id: "v", olistSellerId: "s" }], [row("v", { baseline: 4, baselineLowerBand: 2, baselineUpperBand: 6, actualValue: 3, deficit: 1 })]);
    expect(adapter.toDisplay("v", 100)).toBeCloseTo(4);
    expect(adapter.toDisplay("v", 25)).toBeCloseTo(1);
    expect(adapter.unitOf("v")).toBe("dias");
  });

  it("un vendedor crónicamente tarde (línea base ≤ 0) no desaparece del motor", () => {
    const [scaled] = adaptForEngine(
      [{ id: "v", olistSellerId: "s" }],
      [row("v", { baseline: -1.5, baselineLowerBand: -3, baselineUpperBand: 0.4, actualValue: -2, deficit: 0 })],
    ).rows;
    expect(scaled.baseline).toBeCloseTo(100);
    expect(scaled.baselineLowerBand).toBe(0);
    expect(MIN_BASELINE_DAYS).toBeGreaterThan(0);
  });
});

describe("formato con unidad", () => {
  it("muestra días o porcentaje según el nodo", () => {
    expect(formatPerformance(3.24, "dias")).toBe("3.2 d");
    expect(formatPerformance(87.04, "pct", 0)).toBe("87 %");
  });
});
