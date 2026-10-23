import { describe, expect, it } from "vitest";
import { buildSystemAlerts, countActiveAlerts } from "@/lib/domain/alerts";
import { thresholdForCost } from "@/lib/domain/cusum-config";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "@/lib/domain/types";

const START = "2026-01-05";
const chain = { id: "c1", name: "Cadena Norte", falseAlarmCost: 3 };
/** Nodo con línea base del modelo: mide en días y se evalúa con el CUSUM. */
const node = (id: string) => ({ id, chainId: "c1", label: id.toUpperCase(), nodeType: "Proveedor" as const, baselineSource: "ml" as const });
const series = (nodeId: string, values: number[]): WeeklyPerformance[] =>
  values.map((actualValue, i) => ({
    id: `${nodeId}-${i}`,
    nodeId,
    weekStart: addWeeksIso(START, i),
    actualValue,
    baseline: 3,
    baselineLowerBand: 2,
    baselineUpperBand: 4,
    deficit: Math.max(0, 3 - actualValue),
  }));

const STABLE = Array(30).fill(3);
// Con el umbral por defecto (2 márgenes) una caída fuerte sostenida se confirma en pocas semanas.
const DEGRADED = [...Array(20).fill(3), ...Array(10).fill(0)];
const RECOVERED = [...Array(5).fill(0), ...Array(25).fill(3)];

describe("alertas del sistema", () => {
  it("un nodo estable no genera alertas", () => {
    const alerts = buildSystemAlerts({ chains: [chain], nodes: [node("a")], rows: series("a", STABLE) });
    expect(alerts).toHaveLength(0);
  });

  it("una degradación sostenida vigente es una alerta crítica con desde cuándo y déficit acumulado", () => {
    const alerts = buildSystemAlerts({ chains: [chain], nodes: [node("a")], rows: series("a", DEGRADED) });
    const [alert] = alerts;
    expect(alert.kind).toBe("sostenida");
    expect(alert.severity).toBe("critico");
    expect(alert.active).toBe(true);
    expect(alert.since).toBe(addWeeksIso(START, 20));
    expect(alert.accumulatedDeficit).toBeGreaterThan(0);
    expect(countActiveAlerts(alerts)).toBeGreaterThan(0);
    expect(thresholdForCost(chain.falseAlarmCost)).toBeGreaterThan(0);
  });

  it("una degradación que ya se recuperó queda en el historial, no como alerta vigente", () => {
    const alerts = buildSystemAlerts({ chains: [chain], nodes: [node("a")], rows: series("a", RECOVERED) });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "sostenida", severity: "pasada", active: false });
    expect(countActiveAlerts(alerts)).toBe(0);
  });

  it("lo vigente va antes que lo pasado", () => {
    const alerts = buildSystemAlerts({
      chains: [chain],
      nodes: [node("a"), node("b")],
      rows: [...series("a", RECOVERED), ...series("b", DEGRADED)],
    });
    expect(alerts.map((a) => a.active)).toEqual([true, false]);
    expect(alerts[0].nodeId).toBe("b");
  });

  it("el cambio de nivel del historial de la cadena es una alerta de la cadena, sin nodo", () => {
    const alerts = buildSystemAlerts({
      chains: [chain],
      nodes: [node("a")],
      rows: series("a", STABLE),
      stabilityByChain: new Map([["c1", { status: "alerta", changePointWeek: "2026-02-02", unstableNodeCount: 2, nodeCount: 5 }]]),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "historial", active: true, unstableNodes: 2, totalNodes: 5 });
    expect(alerts[0].nodeId).toBeUndefined();
  });
});
