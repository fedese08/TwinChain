import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_FALSE_ALARM_COST, thresholdForCost } from "@/lib/domain/cusum-config";
import { runCusum } from "@/lib/domain/degradation";
import { assessNode } from "@/lib/domain/monitoring";
import { MAX_ADVANCE_WEEKS } from "@/lib/domain/synthetic/config";
import type { WeeklyPerformance } from "@/lib/domain/types";
import { weekRange } from "@/lib/domain/synthetic/weeks";
import { assignSellers } from "./assign";
import { baselineFromModel, PHASE1_WEEKS, provisionalVendedorBaseline } from "./baseline";
import { advanceVendedor, buildVendedorRows, type RealWeek } from "./history";

const prediction = { linea_base: 3.2, banda_inferior: 1.7, banda_superior: 4.6, banda_semanal_inferior: 0.6, banda_semanal_superior: 5.6 };
const real = (margins: number[]): RealWeek[] => margins.map((margen) => ({ margen, items: 2 }));
const END = "2026-10-05";

describe("línea base de un Vendedor", () => {
  it("la del modelo conserva ambas bandas y se marca como del modelo", () => {
    const b = baselineFromModel(prediction);
    expect(b).toMatchObject({ baseline: 3.2, lower: 1.7, upper: 4.6, weeklyLower: 0.6, weeklyUpper: 5.6, source: "ml" });
  });

  it("la provisoria es la media de la Fase I con su intervalo, sin banda semanal, y se marca provisoria", () => {
    const b = provisionalVendedorBaseline([2, 3, 4, 3]);
    expect(b.baseline).toBe(3);
    expect(b.lower).toBeLessThan(3);
    expect(b.upper).toBeGreaterThan(3);
    expect(b.weeklyLower).toBeUndefined();
    expect(b.source).toBe("provisoria");
  });

  it("con las 4 semanas idénticas la banda no colapsa a cero", () => {
    const b = provisionalVendedorBaseline([3, 3, 3, 3]);
    expect(b.upper - b.lower).toBeGreaterThan(0);
  });

  it("exige exactamente 4 semanas", () => {
    expect(() => provisionalVendedorBaseline([1, 2, 3])).toThrow(RangeError);
    expect(PHASE1_WEEKS).toBe(4);
  });
});

describe("asignación de vendedores a nodos", () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, weeks: i < 3 ? 20 : 40 }));

  it("es determinística y solo usa vendedores con semanas suficientes", () => {
    const a = assignSellers(["n1", "n2", "n3"], pool, new Set(), 28);
    expect(a).toEqual(assignSellers(["n1", "n2", "n3"], pool, new Set(), 28));
    for (const id of a.values()) expect(["s00", "s01", "s02"]).not.toContain(id);
  });

  it("no repite vendedores dentro de la cadena mientras haya libres", () => {
    const nodes = Array.from({ length: 9 }, (_, i) => `node-${i}`);
    expect(new Set(assignSellers(nodes, pool, new Set(), 28).values()).size).toBe(9);
  });

  it("evita los que ya usa la cadena y, agotados, repite en vez de fallar", () => {
    const used = new Set(["s03", "s04"]);
    for (const id of assignSellers(["a", "b", "c"], pool, used, 28).values()) expect(used.has(id)).toBe(false);
    const many = assignSellers(Array.from({ length: 12 }, (_, i) => `x${i}`), pool, new Set(), 28);
    expect(many.size).toBe(12);
  });

  it("falla con un mensaje claro si no hay ninguno elegible", () => {
    expect(() => assignSellers(["a"], pool, new Set(), 99)).toThrow(/pool/);
  });
});

describe("historial de un Vendedor", () => {
  const baseline = baselineFromModel(prediction);
  const margins = Array.from({ length: 40 }, (_, i) => 3 + Math.sin(i));

  it("pone las semanas activas en las semanas de la cadena, con la línea base congelada", () => {
    const rows = buildVendedorRows({ nodeId: "v", realWeeks: real(margins), weekStarts: weekRange(END, 28), baseline });
    expect(rows).toHaveLength(28);
    expect(rows[27].weekStart).toBe(END);
    expect(rows.map((r) => r.actualValue)).toEqual(margins.slice(0, 28));
    expect(new Set(rows.map((r) => r.baseline)).size).toBe(1);
    for (const r of rows) {
      expect(r.deficit).toBeCloseTo(Math.max(0, 3.2 - r.actualValue));
      expect(r.weeklyBandLower).toBe(0.6);
    }
  });

  it("con línea base provisoria las filas no llevan banda semanal", () => {
    const rows = buildVendedorRows({ nodeId: "v", realWeeks: real(margins), weekStarts: weekRange(END, 28), baseline: provisionalVendedorBaseline(margins.slice(0, 4)) });
    expect(rows.every((r) => r.weeklyBandLower === undefined)).toBe(true);
  });

  it("falla si el vendedor no tiene semanas suficientes", () => {
    expect(() => buildVendedorRows({ nodeId: "v", realWeeks: real(margins.slice(0, 10)), weekStarts: weekRange(END, 28), baseline })).toThrow(RangeError);
  });
});

describe("avance de un Vendedor", () => {
  const baseline = baselineFromModel(prediction);
  const realMargins = Array.from({ length: 32 }, (_, i) => 3 + 0.8 * Math.sin(i * 1.3));
  const stateAt = (history: number[]) => ({ nodeId: "v", history, realMargins, lastWeekStart: END, baseline });

  it("primero entrega las semanas reales que siguen y copia la línea base congelada", () => {
    const rows = advanceVendedor(stateAt(realMargins.slice(0, 28)), 3);
    expect(rows.map((r) => r.actualValue)).toEqual(realMargins.slice(28, 31));
    for (const r of rows) {
      expect(r.baseline).toBe(3.2);
      expect(r.weeklyBandUpper).toBe(5.6);
    }
  });

  it("agotadas las reales sigue con semanas simuladas, deterministas y en el dominio del modelo", () => {
    const history = realMargins.slice(0, 28);
    const a = advanceVendedor(stateAt(history), MAX_ADVANCE_WEEKS);
    const b = advanceVendedor(stateAt(history), MAX_ADVANCE_WEEKS);
    expect(a).toEqual(b);
    const simulated = advanceVendedor(stateAt(realMargins), 8).map((r) => r.actualValue);
    expect(simulated.every((v) => Math.abs(v) <= 60)).toBe(true);
    expect(simulated).not.toEqual(realMargins.slice(0, 8));
  });

  it("el resultado no depende de cómo se parta el avance", () => {
    const history = realMargins.slice(0, 28);
    const together = advanceVendedor(stateAt(history), 8).map((r) => r.actualValue);
    const stepped: number[] = [];
    let current = history;
    let last = END;
    for (let i = 0; i < 8; i++) {
      const [next] = advanceVendedor({ ...stateAt(current), lastWeekStart: last }, 1);
      stepped.push(next.actualValue);
      current = [...current, next.actualValue];
      last = next.weekStart;
    }
    expect(stepped).toEqual(together);
  });

  it("no deriva: tras muchas semanas simuladas el nivel sigue siendo el del vendedor", () => {
    let history = realMargins.slice();
    let last = END;
    for (let block = 0; block < 25; block++) {
      const rows = advanceVendedor({ ...stateAt(history), lastWeekStart: last }, 8);
      history = [...history, ...rows.map((r) => r.actualValue)];
      last = rows[rows.length - 1].weekStart;
    }
    const tail = history.slice(-100);
    expect(Math.abs(tail.reduce((s, v) => s + v, 0) / tail.length - 3)).toBeLessThan(0.7);
  });

  it("rechaza avances fuera de rango", () => {
    expect(() => advanceVendedor(stateAt(realMargins), 0)).toThrow(RangeError);
    expect(() => advanceVendedor(stateAt(realMargins), MAX_ADVANCE_WEEKS + 1)).toThrow(RangeError);
  });
});

describe("estado de un Vendedor con línea base del modelo: CUSUM sobre el residuo", () => {
  const h = thresholdForCost(DEFAULT_FALSE_ALARM_COST);
  const withActuals = (actuals: number[]): WeeklyPerformance[] =>
    actuals.map((actualValue, i) => ({
      id: String(i), nodeId: "v", weekStart: weekRange(END, actuals.length)[i], actualValue,
      baseline: 3.2, baselineLowerBand: 2.3, baselineUpperBand: 4.1, deficit: Math.max(0, 3.2 - actualValue),
    }));

  it("una semana mala aislada no alcanza; una degradación sostenida se confirma como crítica", () => {
    expect(assessNode(withActuals([3, 3.4, 3, 3.2, 3, 3.3, 1.8]), { cusumH: h }).level).toBe("normal");
    const sustained = assessNode(withActuals([3, 3.4, 3, 3.2, 1, 1, 1, 1]), { cusumH: h });
    expect(sustained.level).toBe("critico");
    expect(sustained.sustained?.weeks).toBeGreaterThanOrEqual(1);
  });

  it("sin umbral del CUSUM (nodos anteriores, 0-100) usa la regla por σ de siempre", () => {
    const rows = withActuals([3, 3.4, 2.8, 3.1, 3.3, 2.9, 3.2, 3.0]);
    expect(assessNode(rows).level).toBe("normal");
  });

  it("en vendedores reales que el modelo no vio, las falsas alarmas son pocas (el costo de una falsa alarma es el máximo)", () => {
    const golden = JSON.parse(readFileSync(new URL("../../../../twinchain-ml/tests/fixtures/golden_sellers.json", import.meta.url), "utf8")).sellers as {
      fase1: { margin_mean: number }[];
      fase2_margin_mean: number[];
      esperado: Record<string, number>;
    }[];
    let confirmations = 0;
    let weeks = 0;
    for (const s of golden) {
      const actuals = [...s.fase1.map((w) => w.margin_mean), ...s.fase2_margin_mean];
      const e = s.esperado;
      const rows = actuals.slice(4).map((actualValue, i) => ({
        weekStart: weekRange(END, actuals.length - 4)[i], actualValue, baseline: e.linea_base, baselineLowerBand: e.banda_inferior,
      }));
      confirmations += runCusum(rows, h).episodes.length;
      weeks += rows.length;
    }
    expect(weeks).toBeGreaterThan(500);
    // La calibración sobre estos mismos vendedores dio 0,59 falsas alarmas por cada 26 semanas en el costo máximo.
    expect((confirmations / weeks) * 26).toBeLessThan(1.5);
  });
});
