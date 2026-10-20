// Pruebas del motor contra las definiciones de la tesis (docs/definiciones-motor.md).
import { describe, expect, it } from "vitest";
import { createRng } from "@/lib/domain/rng";
import { PROPAGATION_FRACTIONS } from "@/lib/domain/k-table";
import {
  crossingWeek,
  estimateSimulationWork,
  K_MAX,
  runScenarioSimulation,
  shareWorthwhile,
  summarize,
  thresholdAtCost,
  transitLagWeeks,
} from "@/lib/domain/simulate";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { DisruptionEvent, SupplyChainEdge, WeeklyPerformance } from "@/lib/domain/types";

const START = "2026-06-01"; // un lunes

type Edge = Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">;
const edge = (sourceNodeId: string, targetNodeId: string, transitTimeDays = 7): Edge => ({ sourceNodeId, targetNodeId, transitTimeDays });
const nodesOf = (...ids: string[]) => ids.map((id) => ({ id }));
const event = (nodeId: string, magnitude: number, startDate = START): DisruptionEvent => ({
  id: `e-${nodeId}-${startDate}`,
  scenarioId: "s",
  nodeId,
  eventType: "corte",
  startDate,
  magnitude,
});

/** Historial de 6 semanas con línea base 100 y banda angosta: el nivel normal no se mueve entre réplicas. */
function history(ids: string[], baseline = 100, lower = baseline, upper = baseline): WeeklyPerformance[] {
  return ids.flatMap((nodeId) =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `${nodeId}-${i}`,
      nodeId,
      weekStart: addWeeksIso("2026-04-20", i),
      actualValue: baseline,
      baseline,
      baselineLowerBand: lower,
      baselineUpperBand: upper,
      deficit: 0,
    })),
  );
}

// ── Referencia independiente: enumeración de caminos en un grafo sin ciclos ─────────────────────────────────────
// d_j(u) = max sobre los caminos o→…→j con arribo ≤ u de c^saltos · d0.
function referenceLoss(edges: Edge[], origin: string, d0: number, c: number, H: number, ids: string[]): number[] {
  const out = new Map<string, Edge[]>();
  for (const e of edges) out.set(e.sourceNodeId, [...(out.get(e.sourceNodeId) ?? []), e]);
  const arrivals = new Map<string, { at: number; value: number }[]>(ids.map((id) => [id, []]));
  const walk = (node: string, at: number, value: number) => {
    arrivals.get(node)!.push({ at, value });
    for (const e of out.get(node) ?? []) walk(e.targetNodeId, at + transitLagWeeks(e.transitTimeDays), value * c);
  };
  walk(origin, 0, d0);
  return Array.from({ length: H }, (_, u) =>
    ids.reduce((sum, id) => sum + Math.max(0, ...arrivals.get(id)!.filter((a) => a.at <= u).map((a) => a.value)), 0),
  );
}

function referenceThreshold(loss: number[], d0: number, k: number): number {
  let cumulative = 0;
  for (let t = 0; t < loss.length; t++) {
    cumulative += loss[t];
    if (cumulative >= k * d0 - 1e-12) return t + 1;
  }
  return Infinity;
}

const rowFor = (kTable: ReturnType<typeof runScenarioSimulation>["kTable"], c: number, k: number) =>
  kTable.find((r) => r.k === k && Math.abs((r.propagationFraction ?? 0) - c) < 1e-9)!;

describe("umbral N(k)", () => {
  it("coincide con la enumeración de caminos en una red sin ciclos, para cada fracción y cada k", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const edges = [edge("a", "b", 7), edge("a", "c", 14), edge("b", "d", 7), edge("c", "d", 7), edge("d", "e", 21), edge("b", "e", 7)];
    const H = 14;
    const outcome = runScenarioSimulation(nodesOf(...ids), edges, [event("a", 40)], history(ids), H, { seed: 1, replications: 3 });
    for (const c of PROPAGATION_FRACTIONS) {
      const loss = referenceLoss(edges, "a", 0.4, c, H, ids);
      for (let k = 1; k <= K_MAX; k++) {
        const expected = referenceThreshold(loss, 0.4, k);
        const row = rowFor(outcome.kTable, c, k);
        expect(row.thresholdMedian).toBe(Number.isFinite(expected) ? expected : null);
      }
    }
  });

  it("en una cadena lineal da los valores calculados a mano", () => {
    // a → b → c con tránsito de una semana, 40 % en a, c = 0.55: D = 0.4, 0.62, 0.682, 0.682…
    const ids = ["a", "b", "c"];
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b"), edge("b", "c")], [event("a", 40)], history(ids), 8, {
      seed: 7,
      replications: 2,
    });
    // K = k·0.4: k=1 → 0.4 (semana 1); k=2 → 0.8 (E: 0.4, 1.02 → semana 2); k=4 → 1.6 (E: 1.02, 1.702 → semana 3).
    expect(rowFor(outcome.kTable, 0.55, 1).thresholdMedian).toBe(1);
    expect(rowFor(outcome.kTable, 0.55, 2).thresholdMedian).toBe(2);
    expect(rowFor(outcome.kTable, 0.55, 4).thresholdMedian).toBe(3);
    expect(outcome.d0).toBeCloseTo(0.4, 12);
  });

  it("no decrece cuando k aumenta, y con k = 0 es la semana 1", () => {
    const ids = ["a", "b", "c"];
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b"), edge("b", "c")], [event("a", 35)], history(ids), 10, {
      seed: 3,
      replications: 5,
    });
    for (const c of PROPAGATION_FRACTIONS) {
      const medians = outcome.kTable.filter((r) => r.propagationFraction === c).map((r) => r.thresholdMedian ?? Infinity);
      for (let i = 1; i < medians.length; i++) expect(medians[i]).toBeGreaterThanOrEqual(medians[i - 1]);
    }
    expect(crossingWeek([0.1, 0.5], 0)).toBe(1);
    expect(crossingWeek([0, 0], 0)).toBe(1);
  });

  it("por encima de k_max no cruza: se informa \"no cruza\" (null), nunca un número, y la fracción de réplicas que sí cruzan", () => {
    const ids = ["a"];
    // Solo el nodo afectado: D = 0.5 por semana, E(H) = 0.5·H, así que k_max = H = 4.
    const outcome = runScenarioSimulation(nodesOf(...ids), [], [event("a", 50)], history(ids), 4, { seed: 1, replications: 3 });
    expect(outcome.breakEvenKs.every((k) => Math.abs(k - 4) < 1e-9)).toBe(true);
    for (const c of PROPAGATION_FRACTIONS) {
      expect(rowFor(outcome.kTable, c, 4).thresholdMedian).toBe(4);
      expect(rowFor(outcome.kTable, c, 5).thresholdMedian).toBeNull();
      expect(rowFor(outcome.kTable, c, 5).crossingShare).toBe(0);
      expect(rowFor(outcome.kTable, c, 10).thresholdHigh).toBeNull();
    }
    expect(shareWorthwhile(outcome.breakEvenKs, 4)).toBe(1);
    expect(shareWorthwhile(outcome.breakEvenKs, 5)).toBe(0);
  });

  it("el rango es p10–p90 y una réplica que no cruza cuenta como +∞", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, Infinity]);
    expect(s.low).toBe(1);
    expect(s.high).toBe(9);
    expect(s.median).toBe(5.5);
    const half = summarize([1, 2, Infinity, Infinity]);
    expect(half.median).toBe(Infinity);
    expect(summarize([2, 4]).median).toBe(3);
  });
});

describe("umbral por costo en semanas de operación", () => {
  it("coincide con N(k) cuando el costo es k·d0, y es 'no cruza' por encima de lo que se evita", () => {
    const ids = ["a", "b"];
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40)], history(ids), 8, { seed: 1, replications: 3 });
    const central = 0.55;
    for (const k of [1, 2, 3]) {
      const byK = outcome.kTable.find((r) => r.k === k && r.propagationFraction === central)!;
      expect(thresholdAtCost(outcome.replicaCurves, k * outcome.d0, central).median).toBe(byK.thresholdMedian);
    }
    const avoidable = outcome.avoidableFromWeek[0];
    expect(thresholdAtCost(outcome.replicaCurves, avoidable + 0.01, central).median).toBeNull();
    expect(thresholdAtCost(outcome.replicaCurves, avoidable - 0.01, central).median).not.toBeNull();
  });
});

describe("propagación", () => {
  it("toma el mayor de lo que llega por varios caminos, con el retraso de cada uno, y tope en 1", () => {
    const ids = ["a", "b", "c"];
    // a→c directo (2 semanas) y a→b→c (1 + 1): llegan a la vez, c·(c·d0) < c·d0, así que manda el directo.
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "c", 14), edge("a", "b", 7), edge("b", "c", 7)], [event("a", 100)], history(ids), 6, {
      seed: 1,
      replications: 1,
    });
    const c = outcome.projectionByNode.get("c")!;
    expect(c[0].deficit).toBe(0);
    expect(c[1].deficit).toBe(0);
    expect(c[2].deficit).toBeGreaterThan(0);
    expect(Math.max(...[...outcome.projectionByNode.get("a")!].map((w) => w.deficit))).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("no tiene piso de magnitud: un evento chico llega a toda la red", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    const outcome = runScenarioSimulation(nodesOf(...ids), edges, [event("a", 1)], history(ids), 8, { seed: 1, replications: 2 });
    expect([...outcome.projectionByNode.keys()].sort()).toEqual(ids);
  });

  it("termina y es finita con ciclos en la red", () => {
    const ids = ["a", "b", "c"];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const outcome = runScenarioSimulation(nodesOf(...ids), edges, [event("a", 60)], history(ids), 20, { seed: 1, replications: 2 });
    expect(Number.isFinite(outcome.totalDeficit.median)).toBe(true);
    for (const weeks of outcome.projectionByNode.values()) for (const w of weeks) expect(w.deficit).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("los eventos de un mismo nodo no se apilan: cuenta el mayor de los ya iniciados", () => {
    const ids = ["a"];
    const outcome = runScenarioSimulation(
      nodesOf(...ids),
      [],
      [event("a", 20, START), event("a", 50, addWeeksIso(START, 2)), event("a", 10, addWeeksIso(START, 3))],
      history(ids),
      6,
      { seed: 1, replications: 1 },
    );
    const deficits = outcome.projectionByNode.get("a")!.map((w) => w.deficit);
    expect(deficits.map((d) => Math.round(d))).toEqual([20, 20, 50, 50, 50, 50]);
  });

  it("la tardanza del tránsito se redondea a semanas y vale al menos una", () => {
    expect(transitLagWeeks(0)).toBe(1);
    expect(transitLagWeeks(3)).toBe(1);
    expect(transitLagWeeks(10)).toBe(1);
    expect(transitLagWeeks(11)).toBe(2);
    expect(transitLagWeeks(21)).toBe(3);
  });
});

describe("reconfiguración", () => {
  it("al decidir en s_r (simulación manual) la red queda sin pérdida: toda la pérdida es evitable", () => {
    const ids = ["a", "b"];
    const withRec = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40)], history(ids), 6, { seed: 1, replications: 2, reconfigurationWeekIndex: 0 });
    expect(withRec.totalDeficit.median).toBe(0);
    const without = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40)], history(ids), 6, { seed: 1, replications: 2 });
    expect(without.totalDeficit.median).toBeGreaterThan(0);
    // La pérdida evitable de la semana 0 es la del horizonte entero.
    expect(without.avoidableFromWeek[0]).toBeCloseTo(without.totalDeficit.median, 9);
  });

  it("es un escalón en la semana w: el déficit del nodo cae de golpe y el de abajo lo sigue con el retraso del tránsito", () => {
    const ids = ["a", "b"];
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b", 14)], [event("a", 40)], history(ids), 8, { seed: 1, replications: 1, reconfigurationWeekIndex: 3 });
    const a = outcome.projectionByNode.get("a")!.map((w) => Math.round(w.deficit));
    const b = outcome.projectionByNode.get("b")!.map((w) => Math.round(w.deficit));
    expect(a).toEqual([40, 40, 40, 0, 0, 0, 0, 0]);
    // b recibe c·0.4 con dos semanas de retraso: su déficit aparece en la semana 2 y cae en la 5 (3 + 2).
    expect(b.slice(0, 2)).toEqual([0, 0]);
    expect(b[2]).toBeGreaterThan(0);
    expect(b[4]).toBeGreaterThan(0);
    expect(b[5]).toBe(0);
  });

  it("una reconfiguración tardía evita menos: la pérdida evitable decrece con la semana", () => {
    const ids = ["a", "b", "c"];
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b"), edge("b", "c")], [event("a", 40)], history(ids), 10, { seed: 1, replications: 3 });
    for (let w = 1; w < 10; w++) expect(outcome.avoidableFromWeek[w]).toBeLessThanOrEqual(outcome.avoidableFromWeek[w - 1] + 1e-12);
  });
});

describe("simulación desde una alerta", () => {
  // El nodo "a" rindió 60 de 100 durante 3 semanas observadas; se decide reconfigurar la semana siguiente.
  const ids = ["a", "b"];
  const firstObserved = "2026-05-04";
  const observed = {
    nodeId: "a",
    weeks: [0, 1, 2].map((i) => ({ weekStart: addWeeksIso(firstObserved, i), actualValue: 60 })),
  };
  const decision = addWeeksIso(firstObserved, 3);

  it("d0 sale del déficit observado y las semanas observadas no entran en el umbral", () => {
    const outcome = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40, firstObserved)], history(ids), 6, {
      seed: 1,
      replications: 2,
      decisionWeek: decision,
      observed,
    });
    expect(outcome.observedWeeks).toBe(3);
    expect(outcome.decisionWeek).toBe(decision);
    expect(outcome.d0).toBeCloseTo(0.4, 12); // (100 − 60) / 100
    // La primera semana proyectada es s_r, no el inicio del desvío.
    expect(outcome.projectionByNode.get("a")![0].weekStart).toBe(decision);
    // Reconfigurar al decidir deja pérdida solo por lo que ya estaba en camino (a→b, emitido antes de s_r).
    expect(outcome.avoidableFromWeek[0]).toBeGreaterThan(0);
    const manual = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40, decision)], history(ids), 6, { seed: 1, replications: 2 });
    expect(outcome.avoidableFromWeek[0]).toBeLessThan(manual.avoidableFromWeek[0] + 1e-9);
  });

  it("con semanas observadas, el nivel normal sorteado dentro de la banda sí mueve d0", () => {
    // Observado: 60. Con nivel normal 100 el déficit es 0.4; con una banda de 50 a 70 la mayoría de las réplicas
    // tiene un nivel normal cercano a lo observado y d0 se acerca a 0.
    const common = { seed: 5, replications: 20, decisionWeek: decision, observed };
    const narrow = runScenarioSimulation(nodesOf(...ids), [], [event("a", 40, firstObserved)], history(ids, 100, 100, 100), 6, common);
    const wide = runScenarioSimulation(nodesOf(...ids), [], [event("a", 40, firstObserved)], history(ids, 60, 50, 70), 6, common);
    expect(narrow.d0).toBeCloseTo(0.4, 12);
    expect(wide.d0).toBeLessThan(0.15);
  });
});

describe("réplicas", () => {
  it("con magnitud proporcional, el sorteo de la banda no cambia el umbral de una simulación manual", () => {
    const ids = ["a", "b"];
    const narrow = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40)], history(ids, 100, 100, 100), 8, { seed: 9, replications: 10 });
    const wide = runScenarioSimulation(nodesOf(...ids), [edge("a", "b")], [event("a", 40)], history(ids, 100, 60, 140), 8, { seed: 9, replications: 10 });
    expect(wide.kTable).toEqual(narrow.kTable);
  });

  it("es reproducible con la misma semilla y réplicas, y cada fracción de propagación tiene su propia fila", () => {
    const ids = ["a", "b", "c"];
    const run = () => runScenarioSimulation(nodesOf(...ids), [edge("a", "b"), edge("b", "c")], [event("a", 30)], history(ids, 100, 90, 110), 8, { seed: 42, replications: 7 });
    expect(run().kTable).toEqual(run().kTable);
    expect(run().kTable).toHaveLength(PROPAGATION_FRACTIONS.length * K_MAX);
    expect(run().replications).toBe(7);
  });

  it("sin eventos o sin nodos conocidos devuelve un resultado vacío en vez de fallar", () => {
    const outcome = runScenarioSimulation(nodesOf("a"), [], [], history(["a"]), 5, { seed: 1 });
    expect(outcome.kTable).toEqual([]);
    expect(outcome.weeklyLoss).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("costo estimado", () => {
  it("crece con las réplicas, el horizonte y la subred alcanzable, y no cuenta lo que no alcanza el evento", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("x", "y")];
    const base = estimateSimulationWork(edges, [event("a", 10)], 10, 10);
    expect(estimateSimulationWork(edges, [event("a", 10)], 20, 10)).toBeGreaterThan(base);
    expect(estimateSimulationWork(edges, [event("a", 10)], 10, 20)).toBeGreaterThan(base);
    expect(estimateSimulationWork(edges, [event("x", 10)], 10, 10)).toBeLessThan(base);
  });

  it("un sorteo aleatorio de redes sin ciclos coincide con la referencia (propiedad)", () => {
    const rng = createRng(2024);
    for (let trial = 0; trial < 25; trial++) {
      const n = 3 + Math.floor(rng() * 4);
      const ids = Array.from({ length: n }, (_, i) => `n${i}`);
      const edges: Edge[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rng() < 0.5) edges.push(edge(ids[i], ids[j], 3 + Math.floor(rng() * 25)));
      const magnitude = 5 + Math.floor(rng() * 90);
      const H = 4 + Math.floor(rng() * 12);
      const outcome = runScenarioSimulation(nodesOf(...ids), edges, [event("n0", magnitude)], history(ids), H, { seed: trial, replications: 2 });
      for (const c of PROPAGATION_FRACTIONS) {
        const loss = referenceLoss(edges, "n0", magnitude / 100, c, H, ids);
        for (const k of [1, 2, 3, 5, 8]) {
          const expected = referenceThreshold(loss, magnitude / 100, k);
          expect(rowFor(outcome.kTable, c, k).thresholdMedian, `trial ${trial} c=${c} k=${k}`).toBe(Number.isFinite(expected) ? expected : null);
        }
      }
    }
  });
});
