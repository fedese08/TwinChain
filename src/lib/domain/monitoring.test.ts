import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NODE_TYPES, type WeeklyPerformance } from "@/lib/domain/types";
import { DEFAULT_FALSE_ALARM_COST, thresholdForCost } from "./cusum-config";
import { runCusum } from "./degradation";
import { assessChain, assessNode, ATTENTION_SIGMAS, CRITICAL_SIGMAS } from "./monitoring";
import { sensorWeeks } from "./synthetic/shipments";
import { provisionalVendedorBaseline } from "./vendedor/baseline";
import { advanceNode } from "./synthetic/advance";
import { buildNodeHistory } from "./synthetic/build-history";
import { HISTORY_WEEKS, TRAINING_WEEKS } from "./synthetic/config";
import { addWeeksIso, weekRange } from "./synthetic/weeks";

/** Filas a mano: entrenamiento con ruido de ±5 y luego `recent` como últimas semanas. */
function rowsWith(recentActuals: number[], baseline = 90): WeeklyPerformance[] {
  const training = Array.from({ length: TRAINING_WEEKS }, (_, i) => baseline + (i % 2 === 0 ? 5 : -5));
  const actuals = [...training, ...recentActuals];
  return weekRange("2026-10-05", actuals.length).map((weekStart, i) => ({
    id: String(i),
    nodeId: "n",
    weekStart,
    actualValue: actuals[i],
    baseline,
    baselineLowerBand: baseline - 2,
    baselineUpperBand: baseline + 2,
    deficit: Math.max(0, baseline - actuals[i]),
  }));
}

describe("estado de un nodo", () => {
  it("sin datos es normal", () => {
    expect(assessNode([]).level).toBe("normal");
  });

  it("un déficit sostenido y grande es crítico; uno moderado, atención; el ruido normal, normal", () => {
    expect(assessNode(rowsWith([70, 70, 70])).level).toBe("critico");
    expect(assessNode(rowsWith([78, 78, 78])).level).toBe("atencion");
    expect(assessNode(rowsWith([88, 91, 86])).level).toBe("normal");
  });

  it("una sola semana muy mala, aislada, no alcanza para alarmar", () => {
    expect(assessNode(rowsWith([91, 91, 60])).level).toBe("normal");
  });

  it("no depende del orden en que vengan las filas", () => {
    const rows = rowsWith([70, 70, 70]);
    expect(assessNode([...rows].reverse())).toEqual(assessNode(rows));
  });

  it("el criterio es relativo a la variabilidad del nodo: la misma caída pesa más en un nodo estable", () => {
    const calm = rowsWith([84, 84, 84]).map((r, i) => (i < TRAINING_WEEKS ? { ...r, actualValue: 90 + (i % 2 === 0 ? 1 : -1) } : r));
    const noisy = rowsWith([84, 84, 84]).map((r, i) => (i < TRAINING_WEEKS ? { ...r, actualValue: 90 + (i % 2 === 0 ? 12 : -12) } : r));
    expect(assessNode(calm).deficitSigmas).toBeGreaterThan(assessNode(noisy).deficitSigmas * 4);
  });
});

describe("estado de la cadena", () => {
  it("cuenta los nodos en atención y críticos", () => {
    const map = new Map<string, WeeklyPerformance[]>([
      ["a", rowsWith([88, 91, 86])],
      ["b", rowsWith([78, 78, 78])],
      ["c", rowsWith([70, 70, 70])],
    ]);
    expect(assessChain(map)).toEqual({ nodeCount: 3, attentionCount: 1, criticalCount: 1 });
  });
});

describe("calibración: operación estable (Monte Carlo)", () => {
  it("un nodo sano casi nunca sale en crítico y raras veces en atención, ni siquiera tras un año de avance", () => {
    const base = weekRange("2026-10-05", HISTORY_WEEKS);
    let weeks = 0;
    let attention = 0;
    let critical = 0;
    for (let i = 0; i < 80; i++) {
      const node = { id: randomUUID(), type: NODE_TYPES[i % NODE_TYPES.length] };
      let rows: WeeklyPerformance[] = buildNodeHistory(node, base).rows.map((r, k) => ({ ...r, id: String(k) }));
      const frozen = rows[0];
      let last = base[base.length - 1];
      for (let block = 0; block < 6; block++) {
        const next = advanceNode(
          {
            nodeId: node.id,
            nodeType: node.type,
            history: rows.map((r) => r.actualValue),
            lastWeekStart: last,
            baseline: frozen.baseline,
            baselineLowerBand: frozen.baselineLowerBand,
            baselineUpperBand: frozen.baselineUpperBand,
          },
          8,
        );
        rows = [...rows, ...next.map((r, k) => ({ ...r, id: `${block}-${k}` }))];
        last = addWeeksIso(last, 8);
      }
      for (let end = HISTORY_WEEKS; end <= rows.length; end++) {
        const { level } = assessNode(rows.slice(0, end));
        weeks++;
        if (level === "atencion") attention++;
        if (level === "critico") critical++;
      }
    }
    expect(critical / weeks).toBeLessThan(0.005);
    expect(attention / weeks).toBeLessThan(0.05);
  });

  it("los umbrales están ordenados", () => {
    expect(CRITICAL_SIGMAS).toBeGreaterThan(ATTENTION_SIGMAS);
  });
});

describe("CUSUM sobre nodos con sensor por envío (Monte Carlo)", () => {
  // Línea base provisoria de cada nodo (media de su fase I, ± el intervalo de esa media): no hace falta el servicio de ML.
  // Es el peor caso para las falsas alarmas: la línea base sale de solo cuatro semanas y no tiene el encogimiento del
  // modelo. La calibración real, sobre vendedores de Olist con el modelo, está en `scripts/calibrate-cusum.ts`.
  function trialRows(id: string, type: (typeof NODE_TYPES)[number], weeks: string[], drop: number, dropFrom: number) {
    const values = sensorWeeks({ nodeId: id, nodeType: type, weekStarts: weeks }).map((b) => b.actualValue);
    const b = provisionalVendedorBaseline(values.slice(0, 4));
    const margin = b.baseline - b.lower;
    return {
      margin,
      rows: values.slice(4).map((v, k) => ({ weekStart: weeks[k + 4], actualValue: k >= dropFrom ? v - drop * margin : v, baseline: b.baseline, baselineLowerBand: b.lower })),
    };
  }

  it("en operación estable, con el costo máximo de falsa alarma, saltan pocas falsas alarmas por semestre", () => {
    const h = thresholdForCost(DEFAULT_FALSE_ALARM_COST);
    const weeks = weekRange("2026-10-05", 52);
    let confirmations = 0;
    let exposure = 0;
    for (let i = 0; i < 150; i++) {
      const { rows } = trialRows(`mc-${i}`, NODE_TYPES[i % NODE_TYPES.length], weeks, 0, 999);
      confirmations += runCusum(rows, h).episodes.length;
      exposure += rows.length;
    }
    expect((confirmations / exposure) * 26).toBeLessThan(1.5);
  });

  it("una caída sostenida de dos márgenes se detecta casi siempre y en pocas semanas", () => {
    const h = thresholdForCost(DEFAULT_FALSE_ALARM_COST);
    const weeks = weekRange("2026-10-05", 40);
    const delays: number[] = [];
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      const { rows } = trialRows(`pw-${i}`, NODE_TYPES[i % NODE_TYPES.length], weeks, 2, 12);
      const first = runCusum(rows, h).episodes.find((e) => rows.findIndex((r) => r.weekStart === e.confirmedWeek) >= 12);
      if (first) delays.push(rows.findIndex((r) => r.weekStart === first.confirmedWeek) - 12 + 1);
    }
    expect(delays.length / trials).toBeGreaterThan(0.9);
    expect(delays.sort((a, b) => a - b)[Math.floor(delays.length / 2)]).toBeLessThanOrEqual(4);
  });

  it("un umbral más sensible avisa antes y avisa de más (HU1: umbral configurable)", () => {
    const weeks = weekRange("2026-10-05", 52);
    const count = (f: number) => {
      const h = thresholdForCost(f);
      let c = 0;
      for (let i = 0; i < 60; i++) c += runCusum(trialRows(`cfg-${i}`, NODE_TYPES[i % NODE_TYPES.length], weeks, 0, 999).rows, h).episodes.length;
      return c;
    };
    expect(count(0)).toBeGreaterThan(count(3));
    expect(thresholdForCost(0)).toBeLessThan(thresholdForCost(3));
  });
});
