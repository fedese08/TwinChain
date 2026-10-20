import { describe, expect, it } from "vitest";
import { deriveAlertScenario } from "@/lib/domain/detection";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "@/lib/domain/types";

const START = "2026-03-02";

/** Un nodo con línea base 3 d, banda semanal 0.4–6 y los valores semanales dados. */
function rows(values: number[]): WeeklyPerformance[] {
  return values.map((actualValue, i) => ({
    id: `r${i}`,
    nodeId: "n1",
    weekStart: addWeeksIso(START, i),
    actualValue,
    baseline: 3,
    baselineLowerBand: 2.4,
    baselineUpperBand: 3.6,
    weeklyBandLower: 0.4,
    weeklyBandUpper: 6,
    deficit: Math.max(0, 3 - actualValue),
  }));
}

describe("deriveAlertScenario", () => {
  it("no hay simulación que ofrecer si el nodo está normal", () => {
    expect(deriveAlertScenario(rows(Array(20).fill(3)))).toBeNull();
    expect(deriveAlertScenario([])).toBeNull();
  });

  it("deriva nodo, inicio, semana de decisión y d0 de lo observado", () => {
    // 17 semanas normales y 3 por debajo de la banda semanal (0.4): crítico.
    const data = rows([...Array(17).fill(3), 0.2, 0.2, 0.2]);
    const alert = deriveAlertScenario(data)!;
    expect(alert.level).toBe("critico");
    expect(alert.nodeId).toBe("n1");
    expect(alert.observedWeeks).toBe(3);
    expect(alert.startDate).toBe(addWeeksIso(START, 17));
    expect(alert.detectionWeek).toBe(addWeeksIso(START, 19));
    expect(alert.decisionWeek).toBe(addWeeksIso(START, 20));
    expect(alert.magnitudePct).toBe(93); // (3 − 0.2) / 3
  });

  it("el desvío empieza en la primera semana de la racha por debajo de la línea base, aunque antes no alertara", () => {
    const data = rows([...Array(14).fill(3), 2.5, 2, 1.5, 0.3, 0.2, 0.3]);
    const alert = deriveAlertScenario(data)!;
    expect(alert.startDate).toBe(addWeeksIso(START, 14));
    expect(alert.observedWeeks).toBe(6);
  });

  it("no mira más atrás de 12 semanas", () => {
    const data = rows(Array(30).fill(0.2));
    expect(deriveAlertScenario(data)!.observedWeeks).toBeLessThanOrEqual(12);
  });
});
