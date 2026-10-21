import { describe, expect, it } from "vitest";
import type { ProjectedWeek } from "@/lib/domain/simulate";
import { simulatedAlertTimeline } from "@/lib/domain/simulation-alerts";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";

/** Proyección de un nodo con línea base 100 y banda hasta 90 (margen K = 10) que rinde `actual` cada semana. */
const projection = (actual: number[]): ProjectedWeek[] =>
  actual.map((value, i) => ({
    weekStart: addWeeksIso("2026-11-02", i),
    baseline: 100,
    baselineLowerBand: 90,
    baselineUpperBand: 110,
    actualValue: value,
    actualValueLow: value,
    actualValueHigh: value,
    deficit: Math.max(0, 100 - value),
    deficitLow: 0,
    deficitHigh: 0,
  }));

describe("estado de alerta de un nodo en las semanas simuladas", () => {
  it("un nodo que no se afecta nunca llega a vigilancia ni a alerta", () => {
    const t = simulatedAlertTimeline(projection(Array(10).fill(98)), 2);
    expect(t.confirmedIndex).toBeNull();
    expect(t.attentionIndex).toBeNull();
    expect(t.weeks.every((w) => w.level === "normal" && w.accumulated === 0)).toBe(true);
  });

  it("una caída sostenida acumula, pasa por vigilancia y confirma la alerta en la semana que corresponde", () => {
    // 40 % de caída: cada semana suma 40 − 10 = 30; con h = 2 el umbral es 20 y confirma en la primera semana.
    const fast = simulatedAlertTimeline(projection(Array(6).fill(60)), 2);
    expect(fast.confirmedIndex).toBe(0);
    // 15 % de caída: suma 5 por semana; el umbral h = 2 (20) se cruza a la cuarta semana, y en la segunda ya está en vigilancia.
    const slow = simulatedAlertTimeline(projection(Array(8).fill(85)), 2);
    expect(slow.attentionIndex).toBe(1);
    expect(slow.confirmedIndex).toBe(3);
    expect(slow.weeks[3].level).toBe("alerta");
  });

  it("la alerta se mantiene unas semanas después de confirmar aunque el nodo se recupere (por una reconfiguración, por ejemplo)", () => {
    const t = simulatedAlertTimeline(projection([60, 60, 100, 100, 100, 100, 100, 100]), 2);
    expect(t.weeks[0].level).toBe("alerta");
    expect(t.weeks[3].level).toBe("alerta");
    expect(t.weeks[7].level).toBe("normal");
  });
});
