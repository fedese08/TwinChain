import { describe, expect, it } from "vitest";
import { deriveAlertScenario } from "@/lib/domain/detection";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "@/lib/domain/types";

const START = "2026-03-02";

/** Nodo con línea base 3 d y banda de la línea base de 2,1 a 3,9 d (margen de 0,9 d). */
function rows(values: number[]): WeeklyPerformance[] {
  return values.map((actualValue, i) => ({
    id: `r${i}`,
    nodeId: "n1",
    weekStart: addWeeksIso(START, i),
    actualValue,
    baseline: 3,
    baselineLowerBand: 2.1,
    baselineUpperBand: 3.9,
    deficit: Math.max(0, 3 - actualValue),
  }));
}

describe("simulación desde una degradación sostenida confirmada (CUSUM)", () => {
  const options = { cusumH: 2 };

  it("no hay de dónde partir si el nodo está normal o solo en vigilancia (sin confirmar)", () => {
    expect(deriveAlertScenario(rows(Array(20).fill(3)), options)).toBeNull();
    expect(deriveAlertScenario(rows([...Array(17).fill(3), 1.5, 1.5]), options)).toBeNull(); // se acumula pero no llega a h·K
    expect(deriveAlertScenario([], options)).toBeNull();
  });

  it("deriva nodo, inicio del desvío, semana de decisión y d0 de lo que confirmó el detector", () => {
    // 17 semanas normales y 4 con un déficit de 2,2 d (1,3 d sobre el margen cada semana): confirma en la segunda.
    const data = rows([...Array(17).fill(3), 0.8, 0.8, 0.8, 0.8]);
    const alert = deriveAlertScenario(data, options)!;
    expect(alert.nodeId).toBe("n1");
    expect(alert.level).toBe("critico");
    expect(alert.startDate).toBe(addWeeksIso(START, 17));
    expect(alert.detectionWeek).toBe(addWeeksIso(START, 20)); // la confirmación más reciente (confirmó en 18 y en 20)
    expect(alert.decisionWeek).toBe(addWeeksIso(START, 21)); // s_r = última confirmación + 1
    expect(alert.observedWeeks).toBe(4);
    expect(alert.magnitudePct).toBe(73); // 2,2 / 3
  });

  it("la semana de decisión sale de la última confirmación, no de la última semana registrada", () => {
    const data = rows([...Array(10).fill(3), 0.8, 0.8, 3, 3, 3]); // confirma en la semana 11 y el nodo ya se recuperó
    const alert = deriveAlertScenario(data, options)!;
    expect(alert.detectionWeek).toBe(addWeeksIso(START, 11));
    expect(alert.decisionWeek).toBe(addWeeksIso(START, 12));
  });
});

describe("nodos anteriores (0-100), sin CUSUM: regla provisoria", () => {
  const legacy = (values: number[]) =>
    values.map((actualValue, i) => ({
      id: `l${i}`, nodeId: "n1", weekStart: addWeeksIso(START, i), actualValue,
      baseline: 92, baselineLowerBand: 88, baselineUpperBand: 96, deficit: Math.max(0, 92 - actualValue),
    }));

  it("no hay simulación si el nodo está normal; sí si el déficit reciente es raro para el nodo", () => {
    expect(deriveAlertScenario(legacy(Array(24).fill(92)))).toBeNull();
    const alert = deriveAlertScenario(legacy([...Array(24).fill(92), 60, 58, 55]))!;
    expect(alert.observedWeeks).toBeGreaterThanOrEqual(3);
    expect(alert.decisionWeek).toBe(addWeeksIso(START, 24 + 3));
  });
});
