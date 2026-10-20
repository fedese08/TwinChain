// El generador como SENSOR en días: la métrica del modelo de ML (margen de despacho) en todos los tipos de nodo.
import { describe, expect, it } from "vitest";
import type { NodeType, SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";
import { adaptForEngine, unitOfNode } from "@/lib/domain/units";
import { provisionalVendedorBaseline, type NodeBaseline } from "@/lib/domain/vendedor/baseline";
import { advanceNode } from "./advance";
import { buildChainHistory, historyWeekStarts, sensorPhase1 } from "./build-history";
import { TRAINING_WEEKS } from "./config";
import { detectInstability } from "./cusum";
import { generateSeries, generateWeeklyItems } from "./generate-series";
import { profileForNode } from "./node-profiles";

const TYPES: NodeType[] = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"];
const weeks = historyWeekStarts("2026-10-12");
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

const MODEL_BASELINE: NodeBaseline = { baseline: 3.2, lower: 2.4, upper: 4.0, weeklyLower: 0.4, weeklyUpper: 6.0, source: "ml" };

describe("sensor simulado en días", () => {
  it("es determinístico por (nodo, semana) y queda en un rango de días razonable", () => {
    const a = generateSeries({ nodeId: "n1", nodeType: "Fabrica", weekStarts: weeks, unit: "dias" });
    expect(generateSeries({ nodeId: "n1", nodeType: "Fabrica", weekStarts: weeks, unit: "dias" })).toEqual(a);
    expect(a.every((v) => v >= -15 && v <= 15)).toBe(true);
  });

  it("el nivel de cada perfil cae donde el modelo de ML tiene datos (2,8 a 4,2 días) y la serie lo respeta", () => {
    for (const type of TYPES) {
      const levels: number[] = [];
      const means: number[] = [];
      for (let i = 0; i < 60; i++) {
        const profile = profileForNode(`n-${type}-${i}`, type, "dias");
        expect(profile.level).toBeGreaterThanOrEqual(2.8);
        expect(profile.level).toBeLessThanOrEqual(4.2);
        levels.push(profile.level);
        means.push(mean(generateSeries({ nodeId: `n-${type}-${i}`, nodeType: type, weekStarts: weeks, unit: "dias" })));
      }
      // La media de la serie sigue al nivel del perfil (hay semanas malas y ruido, pero no deriva).
      expect(Math.abs(mean(means) - mean(levels))).toBeLessThan(0.3);
    }
  });

  it("no cambia la escala anterior: sin `unit`, la serie sigue en 0-100", () => {
    const v = generateSeries({ nodeId: "n1", nodeType: "Proveedor", weekStarts: weeks });
    expect(v.every((x) => x >= 0 && x <= 100)).toBe(true);
    expect(mean(v)).toBeGreaterThan(50);
  });

  it("el volumen semanal es entero, positivo y determinístico", () => {
    const items = generateWeeklyItems({ nodeId: "n1", nodeType: "Vendedor", weekStarts: weeks });
    expect(items).toEqual(generateWeeklyItems({ nodeId: "n1", nodeType: "Vendedor", weekStarts: weeks }));
    expect(items.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
  });

  it("la Fase I que se le da al modelo son las MISMAS primeras semanas que quedan guardadas en el historial", () => {
    const phase1 = sensorPhase1({ id: "n1", type: "Almacen" }, weeks);
    expect(phase1).toHaveLength(4);
    const { rows } = buildChainHistory([{ id: "n1", type: "Almacen", baseline: MODEL_BASELINE }], { endWeek: "2026-10-12" });
    expect(rows.slice(0, 4).map((r) => r.actualValue)).toEqual(phase1.map((w) => w.margen));
  });

  it("falsas alarmas del C24 con series estables en días: prácticamente cero", () => {
    let alarms = 0;
    let total = 0;
    for (const type of TYPES) {
      for (let i = 0; i < 200; i++) {
        const v = generateSeries({ nodeId: `fa-${type}-${i}`, nodeType: type, weekStarts: weeks, unit: "dias" }).slice(0, TRAINING_WEEKS);
        total++;
        if (detectInstability(v).alarm) alarms++;
      }
    }
    expect(alarms / total).toBeLessThan(0.005);
  });
});

describe("historial de un nodo con línea base del modelo", () => {
  const { rows, stability } = buildChainHistory(
    [
      { id: "a", type: "Proveedor", baseline: MODEL_BASELINE },
      { id: "b", type: "Cliente", baseline: provisionalVendedorBaseline([3, 3.5, 2.8, 3.1]) },
    ],
    { endWeek: "2026-10-12" },
  );

  it("congela la línea base y las bandas en todas las semanas y calcula el déficit sin negativos", () => {
    const a = rows.filter((r) => r.nodeId === "a");
    expect(a).toHaveLength(28);
    expect(new Set(a.map((r) => r.baseline))).toEqual(new Set([3.2]));
    expect(a.every((r) => r.weeklyBandLower === 0.4 && r.weeklyBandUpper === 6.0)).toBe(true);
    expect(rows.every((r) => r.deficit >= 0)).toBe(true);
    expect(a.every((r) => r.deficit === Math.max(0, 3.2 - r.actualValue))).toBe(true);
  });

  it("la línea base provisoria no trae banda semanal", () => {
    const b = rows.filter((r) => r.nodeId === "b");
    expect(b.every((r) => r.weeklyBandLower === undefined)).toBe(true);
  });

  it("sigue evaluando la estabilidad (C24) sobre estos nodos", () => {
    expect(stability).not.toBeNull();
    expect(stability!.nodeCount).toBe(2);
  });
});

describe("avance semanal de un nodo en días", () => {
  it("continúa en días, copia la línea base y las dos bandas, y no depende de cómo se parta el avance", () => {
    const { rows } = buildChainHistory([{ id: "a", type: "Fabrica", baseline: MODEL_BASELINE }], { endWeek: "2026-10-12" });
    const state = {
      nodeId: "a",
      nodeType: "Fabrica" as NodeType,
      history: rows.map((r) => r.actualValue),
      lastWeekStart: rows[rows.length - 1].weekStart,
      baseline: 3.2,
      baselineLowerBand: 2.4,
      baselineUpperBand: 4.0,
      weeklyBandLower: 0.4,
      weeklyBandUpper: 6.0,
      unit: "dias" as const,
    };
    const four = advanceNode(state, 4);
    expect(four.every((r) => r.baseline === 3.2 && r.weeklyBandLower === 0.4 && r.weeklyBandUpper === 6.0)).toBe(true);
    expect(four.every((r) => r.actualValue >= -15 && r.actualValue <= 15)).toBe(true);
    const two = advanceNode(state, 2);
    const nextTwo = advanceNode({ ...state, history: [...state.history, ...two.map((r) => r.actualValue)], lastWeekStart: two[1].weekStart }, 2);
    expect([...two, ...nextTwo].map((r) => r.actualValue)).toEqual(four.map((r) => r.actualValue));
  });
});

describe("unidades y adaptador", () => {
  const node = (id: string, baselineSource?: "ml" | "provisoria"): Pick<SupplyChainNode, "id" | "olistSellerId" | "baselineSource"> => ({ id, baselineSource });

  it("un nodo está en días si tiene fuente de línea base; sin ella (nodos anteriores) está en 0-100", () => {
    expect(unitOfNode(node("a", "ml"))).toBe("dias");
    expect(unitOfNode(node("a", "provisoria"))).toBe("dias");
    expect(unitOfNode(node("a"))).toBe("pct");
  });

  it("una cadena entera en días llega al motor con cada línea base en 100", () => {
    const { rows } = buildChainHistory(
      [
        { id: "a", type: "Proveedor", baseline: MODEL_BASELINE },
        { id: "b", type: "Cliente", baseline: { ...MODEL_BASELINE, baseline: 4.0 } },
      ],
      { endWeek: "2026-10-12" },
    );
    const full: WeeklyPerformance[] = rows.map((r, i) => ({ id: String(i), ...r }));
    const adapter = adaptForEngine([node("a", "ml"), node("b", "ml")], full);
    expect(new Set(adapter.rows.map((r) => Math.round(r.baseline)))).toEqual(new Set([100]));
    expect(adapter.toDisplay("a", 100)).toBeCloseTo(3.2, 6);
    expect(adapter.toDisplay("b", 100)).toBeCloseTo(4.0, 6);
  });
});
