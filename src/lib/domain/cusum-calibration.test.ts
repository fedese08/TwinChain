import { describe, expect, it } from "vitest";
import { evaluateThresholds, interpolateThreshold, optimalThreshold, thresholdByCost, type CalibrationTrial } from "@/lib/domain/cusum-calibration";
import { createRng } from "@/lib/domain/rng";
import { gaussian } from "@/lib/domain/synthetic/stats";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";

/** Nodo con línea base 3 d y margen K = 1 d; ruido de 1,2 d; a partir de `episodeStart`, una caída de `drop` d. */
function trial(seed: number, clean: number, episode: number, drop: number): CalibrationTrial {
  const rng = createRng(seed);
  const rows = Array.from({ length: clean + episode }, (_, i) => ({
    weekStart: addWeeksIso("2025-01-06", i),
    actualValue: 3 - (i >= clean ? drop : 0) + 1.2 * gaussian(rng(), rng()),
    baseline: 3,
    baselineLowerBand: 2,
  }));
  return { rows, episodeStart: clean, episodeWeeks: episode };
}
const trials = Array.from({ length: 60 }, (_, i) => trial(i + 1, 30, 12, [1, 2, 3][i % 3]));
const hGrid = [1, 2, 3, 4, 6, 8, 12];

describe("evaluación de umbrales", () => {
  const points = evaluateThresholds(trials, hGrid);

  it("un umbral más alto da menos falsas alarmas y más retardo", () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i].falseAlarms).toBeLessThanOrEqual(points[i - 1].falseAlarms + 1e-9);
      expect(points[i].delay).toBeGreaterThanOrEqual(points[i - 1].delay - 1e-9);
    }
  });

  it("con un umbral enorme no se detecta nada y el retardo es el del episodio entero", () => {
    const [none] = evaluateThresholds(trials, [1000]);
    expect(none.detected).toBe(0);
    expect(none.delay).toBe(12);
    expect(none.falseAlarms).toBe(0);
  });
});

describe("umbral óptimo según el costo de una falsa alarma", () => {
  const points = evaluateThresholds(trials, hGrid);

  it("si las falsas alarmas no cuestan, conviene el umbral más bajo; si cuestan mucho, uno más alto", () => {
    expect(optimalThreshold(points, 0).h).toBe(hGrid[0]);
    expect(optimalThreshold(points, 1000).h).toBeGreaterThan(optimalThreshold(points, 0).h);
  });

  it("h*(f) no decrece cuando f aumenta, y se informa a partir de qué f deja de moverse", () => {
    const { table, fStable } = thresholdByCost(points, [0, 0.5, 1, 2, 3, 5, 8, 50, 500]);
    for (let i = 1; i < table.length; i++) expect(table[i].h).toBeGreaterThanOrEqual(table[i - 1].h);
    expect(fStable).not.toBeNull();
    const last = table[table.length - 1].h;
    expect(table.filter((r) => r.f >= fStable!).every((r) => r.h === last)).toBe(true);
  });

  it("interpola h entre los puntos de la tabla y no se sale de sus extremos", () => {
    const table = [{ f: 0, h: 2 }, { f: 2, h: 4 }, { f: 4, h: 5 }];
    expect(interpolateThreshold(table, -1)).toBe(2);
    expect(interpolateThreshold(table, 1)).toBe(3);
    expect(interpolateThreshold(table, 3)).toBe(4.5);
    expect(interpolateThreshold(table, 99)).toBe(5);
  });
});
