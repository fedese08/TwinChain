import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "@/lib/domain/types";
import { advanceNode } from "./advance";
import { buildChainHistory, buildSingleNodeHistory, planLevelShifts } from "./build-history";
import { HISTORY_WEEKS, MAX_ADVANCE_WEEKS, TRAINING_WEEKS } from "./config";
import { detectInstability, evaluateChainStability } from "./cusum";
import { buildRows, estimateBaseline } from "./estimate-baseline";
import { continueSeries, generateSeries } from "./generate-series";
import { profileForNode, TYPE_RANGES } from "./node-profiles";
import { addWeeksIso, lastCompleteWeek, mondayOf, weekRange } from "./weeks";

const END = "2026-10-05"; // lunes fijo para que los tests no dependan de la fecha de hoy
const weeks = (count: number) => weekRange(END, count);

describe("semanas (UTC)", () => {
  it("mondayOf devuelve el lunes de la semana, incluido el domingo", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // domingo
  });

  it("addWeeksIso y weekRange son consecutivas y terminan donde se pide", () => {
    expect(addWeeksIso("2026-10-05", -1)).toBe("2026-09-28");
    const range = weekRange(END, 4);
    expect(range).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
  });

  it("lastCompleteWeek es el lunes anterior al de la semana en curso", () => {
    expect(lastCompleteWeek(new Date("2026-10-07T12:00:00Z"))).toBe("2026-09-28");
  });
});

describe("perfiles por tipo", () => {
  it("son deterministas: el mismo nodo siempre tiene el mismo perfil", () => {
    const id = randomUUID();
    expect(profileForNode(id, "Fabrica")).toEqual(profileForNode(id, "Fabrica"));
  });

  it("caen dentro del rango de su tipo y los nodos del mismo tipo difieren entre sí", () => {
    for (const type of NODE_TYPES) {
      const ranges = TYPE_RANGES[type];
      const profiles = Array.from({ length: 50 }, () => profileForNode(randomUUID(), type));
      for (const p of profiles) {
        expect(p.level).toBeGreaterThanOrEqual(ranges.level[0]);
        expect(p.level).toBeLessThanOrEqual(ranges.level[1]);
        expect(p.volatility).toBeGreaterThanOrEqual(ranges.volatility[0]);
        expect(p.volatility).toBeLessThanOrEqual(ranges.volatility[1]);
      }
      expect(new Set(profiles.map((p) => p.level)).size).toBeGreaterThan(40);
    }
  });
});

describe("generador de serie", () => {
  it("es determinista y queda dentro de [0, 100]", () => {
    for (const type of NODE_TYPES) {
      const id = randomUUID();
      const a = generateSeries({ nodeId: id, nodeType: type, weekStarts: weeks(40) });
      const b = generateSeries({ nodeId: id, nodeType: type, weekStarts: weeks(40) });
      expect(a).toEqual(b);
      expect(a.every((v) => v >= 0 && v <= 100)).toBe(true);
    }
  });

  it("el nivel medio se parece al perfil del nodo", () => {
    const id = randomUUID();
    const profile = profileForNode(id, "Proveedor");
    const values = generateSeries({ nodeId: id, nodeType: "Proveedor", weekStarts: weeks(400) });
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(mean - profile.level)).toBeLessThan(profile.volatility * 0.4);
  });

  it("el cambio de nivel corre la serie solo desde la semana indicada", () => {
    const id = randomUUID();
    const ws = weeks(30);
    const base = generateSeries({ nodeId: id, nodeType: "Fabrica", weekStarts: ws });
    const shifted = generateSeries({ nodeId: id, nodeType: "Fabrica", weekStarts: ws, levelShift: { fromWeek: ws[15], sigmas: -4 } });
    expect(shifted.slice(0, 15)).toEqual(base.slice(0, 15));
    const dropped = shifted.slice(15).reduce((s, v, i) => s + (base[15 + i] - v), 0) / 15;
    expect(dropped).toBeGreaterThan(10);
  });

  it("continuar la serie es determinista, consecutivo y no salta de nivel", () => {
    const id = randomUUID();
    const ws = weeks(HISTORY_WEEKS);
    const history = generateSeries({ nodeId: id, nodeType: "Almacen", weekStarts: ws });
    const next = continueSeries({ nodeId: id, nodeType: "Almacen", history: history, lastWeekStart: ws[ws.length - 1], weeks: 5 });
    expect(next.weekStarts).toEqual(weekRange(addWeeksIso(END, 5), 5));
    expect(next).toEqual(continueSeries({ nodeId: id, nodeType: "Almacen", history: history, lastWeekStart: ws[ws.length - 1], weeks: 5 }));
    expect(next.values.every((v) => v >= 0 && v <= 100)).toBe(true);
  });
});

describe("estimador de línea base", () => {
  it("la banda contiene a la línea base y se angosta con más datos", () => {
    const id = randomUUID();
    const short = estimateBaseline(generateSeries({ nodeId: id, nodeType: "Vendedor", weekStarts: weeks(12) }));
    const long = estimateBaseline(generateSeries({ nodeId: id, nodeType: "Vendedor", weekStarts: weeks(60) }));
    for (const e of [short, long]) {
      expect(e.lower).toBeLessThanOrEqual(e.baseline);
      expect(e.upper).toBeGreaterThanOrEqual(e.baseline);
    }
    expect(long.upper - long.lower).toBeLessThan(short.upper - short.lower);
  });

  it("una semana mala aislada casi no mueve la línea base (media recortada)", () => {
    const clean = Array.from({ length: 24 }, (_, i) => 90 + (i % 3));
    const withOutlier = [...clean.slice(0, 23), 20];
    expect(Math.abs(estimateBaseline(withOutlier).baseline - estimateBaseline(clean).baseline)).toBeLessThan(1.5);
  });

  it("exige un mínimo de semanas", () => {
    expect(() => estimateBaseline([90, 91, 92])).toThrow(RangeError);
  });

  it("el déficit es max(base − real, 0): nunca negativo, y la base es la misma en toda la serie", () => {
    const values = [80, 95, 90, 99, 70, 92, 91, 88];
    const rows = buildRows({ nodeId: "n", weekStarts: weeks(values.length), values, estimate: { baseline: 90, lower: 88, upper: 92 } });
    for (const row of rows) {
      expect(row.deficit).toBeGreaterThanOrEqual(0);
      expect(row.deficit).toBeCloseTo(Math.max(0, 90 - row.actualValue));
      expect(row.baseline).toBe(90);
    }
  });
});

describe("RF017: la línea base sale solo del historial del propio nodo", () => {
  it("el historial de un nodo es idéntico con o sin otros nodos en la cadena", () => {
    const target = { id: randomUUID(), type: "Fabrica" as const };
    const others = Array.from({ length: 10 }, () => ({ id: randomUUID(), type: "Vendedor" as const }));
    const alone = buildChainHistory([target], { endWeek: END }).rows.filter((r) => r.nodeId === target.id);
    const crowded = buildChainHistory([...others, target], { endWeek: END }).rows.filter((r) => r.nodeId === target.id);
    expect(crowded).toEqual(alone);
  });

  it("agregar un nodo suelto da lo mismo que cargarlo con la cadena", () => {
    const node = { id: randomUUID(), type: "Almacen" as const };
    const viaChain = buildChainHistory([node], { endWeek: END }).rows;
    expect(buildSingleNodeHistory(node, { endWeek: END })).toEqual(viaChain);
  });
});

describe("historial de cadena", () => {
  const nodes = NODE_TYPES.flatMap((type) => Array.from({ length: 3 }, () => ({ id: randomUUID(), type })));

  it("genera HISTORY_WEEKS filas por nodo, con una única línea base congelada por nodo", () => {
    const { rows } = buildChainHistory(nodes, { endWeek: END });
    expect(rows).toHaveLength(nodes.length * HISTORY_WEEKS);
    for (const node of nodes) {
      const own = rows.filter((r) => r.nodeId === node.id);
      expect(new Set(own.map((r) => r.baseline)).size).toBe(1);
      expect(own[own.length - 1].weekStart).toBe(END);
      expect(own.every((r) => r.baselineLowerBand <= r.baseline && r.baseline <= r.baselineUpperBand)).toBe(true);
    }
  });

  it("sin el interruptor la cadena es estable; con él, alerta con la semana del cambio", () => {
    const stable = buildChainHistory(nodes, { endWeek: END });
    expect(stable.stability.status).toBe("estable");

    const broken = buildChainHistory(nodes, { endWeek: END, withLevelShift: true });
    expect(broken.stability.status).toBe("alerta");
    expect(broken.stability.unstableNodeCount).toBeGreaterThanOrEqual(1);
    const shiftWeek = weeks(HISTORY_WEEKS)[Math.floor(TRAINING_WEEKS * 0.6)];
    const gapWeeks = Math.abs((Date.parse(broken.stability.changePointWeek!) - Date.parse(shiftWeek)) / (7 * 86_400_000));
    expect(gapWeeks).toBeLessThanOrEqual(2);
  });

  it("el cambio de nivel siempre toca al menos un nodo, y es determinista", () => {
    const ids = [randomUUID()];
    expect(planLevelShifts(ids, weeks(HISTORY_WEEKS)).size).toBe(1);
    const many = Array.from({ length: 20 }, () => randomUUID());
    expect(planLevelShifts(many, weeks(HISTORY_WEEKS))).toEqual(planLevelShifts(many, weeks(HISTORY_WEEKS)));
    expect(planLevelShifts(many, weeks(HISTORY_WEEKS)).size).toBe(6);
  });
});

describe("avance semanal (monitoreo vivo)", () => {
  const node = { id: randomUUID(), type: "Proveedor" as const };
  const history = buildChainHistory([node], { endWeek: END }).rows;
  const state = {
    nodeId: node.id,
    nodeType: node.type,
    history: history.map((r) => r.actualValue),
    lastWeekStart: END,
    baseline: history[0].baseline,
    baselineLowerBand: history[0].baselineLowerBand,
    baselineUpperBand: history[0].baselineUpperBand,
  };

  it("copia la línea base y la banda congeladas, y suma semanas consecutivas", () => {
    const rows = advanceNode(state, 6);
    expect(rows.map((r) => r.weekStart)).toEqual(weekRange(addWeeksIso(END, 6), 6));
    for (const row of rows) {
      expect(row.baseline).toBe(state.baseline);
      expect(row.baselineLowerBand).toBe(state.baselineLowerBand);
      expect(row.baselineUpperBand).toBe(state.baselineUpperBand);
      expect(row.deficit).toBeCloseTo(Math.max(0, state.baseline - row.actualValue));
    }
  });

  it("avanzar de a una semana varias veces equivale a avanzar todas juntas", () => {
    const together = advanceNode(state, 4);
    const oneByOne: typeof together = [];
    let current = state;
    for (let i = 0; i < 4; i++) {
      const [row] = advanceNode(current, 1);
      oneByOne.push(row);
      current = { ...current, history: [...current.history, row.actualValue], lastWeekStart: row.weekStart };
    }
    expect(oneByOne.map((r) => r.actualValue)).toEqual(together.map((r) => r.actualValue));
  });

  it("no deriva: tras muchas semanas los valores siguen centrados en el nivel del nodo", () => {
    const ws = weeks(HISTORY_WEEKS);
    const drift: number[] = [];
    for (let i = 0; i < 60; i++) {
      const type = NODE_TYPES[i % NODE_TYPES.length];
      const id = randomUUID();
      const profile = profileForNode(id, type);
      const history = generateSeries({ nodeId: id, nodeType: type, weekStarts: ws });
      const next = continueSeries({ nodeId: id, nodeType: type, history, lastWeekStart: ws[ws.length - 1], weeks: 312 });
      const tail = next.values.slice(-52);
      drift.push((tail.reduce((s, v) => s + v, 0) / tail.length - profile.level) / profile.volatility);
    }
    // Con un paseo aleatorio esto daba ~3 σ; anclado, el desvío medio queda cerca de cero.
    const meanAbsDrift = drift.reduce((s, d) => s + Math.abs(d), 0) / drift.length;
    expect(meanAbsDrift).toBeLessThan(0.5);
  });

  it("un nodo con cambio de nivel sigue en su nivel nuevo, no vuelve al viejo", () => {
    const id = randomUUID();
    const ws = weeks(HISTORY_WEEKS);
    const profile = profileForNode(id, "Fabrica");
    const history = generateSeries({
      nodeId: id,
      nodeType: "Fabrica",
      weekStarts: ws,
      levelShift: { fromWeek: ws[Math.floor(TRAINING_WEEKS * 0.6)], sigmas: -4 },
    });
    expect(detectInstability(history.slice(0, TRAINING_WEEKS)).alarm).toBe(true);
    const next = continueSeries({ nodeId: id, nodeType: "Fabrica", history, lastWeekStart: ws[ws.length - 1], weeks: 104 });
    const meanNext = next.values.reduce((s, v) => s + v, 0) / next.values.length;
    expect(meanNext).toBeLessThan(profile.level - 2.5 * profile.volatility);
  });

  it("rechaza avances fuera de rango", () => {
    expect(() => advanceNode(state, 0)).toThrow(RangeError);
    expect(() => advanceNode(state, MAX_ADVANCE_WEEKS + 1)).toThrow(RangeError);
  });
});

describe("CUSUM: calibración (Monte Carlo contra el generador real)", () => {
  const SERIES = 6000;
  const ws = weeks(TRAINING_WEEKS);
  const draw = (shift?: { at: number; sigmas: number }) =>
    Array.from({ length: SERIES }, (_, i) =>
      generateSeries({
        nodeId: randomUUID(),
        nodeType: NODE_TYPES[i % NODE_TYPES.length],
        weekStarts: ws,
        levelShift: shift ? { fromWeek: ws[shift.at], sigmas: shift.sigmas } : undefined,
      }),
    );

  it("falsas alarmas por nodo ≤ 0,5 % (objetivo 0,2 %): una cadena de 50 nodos casi nunca alerta sin motivo", () => {
    const alarms = draw().filter((s) => detectInstability(s).alarm).length;
    expect(alarms / SERIES).toBeLessThanOrEqual(0.005);
  });

  it("detecta un cambio de nivel de −4 σ en al menos el 93 % de los casos, con la semana bien ubicada", () => {
    const at = Math.floor(TRAINING_WEEKS * 0.6);
    const results = draw({ at, sigmas: -4 }).map((s) => detectInstability(s));
    const hits = results.filter((r) => r.alarm);
    expect(hits.length / SERIES).toBeGreaterThanOrEqual(0.93);
    const meanError = hits.reduce((s, r) => s + Math.abs((r.changePointIndex ?? 0) - at), 0) / hits.length;
    expect(meanError).toBeLessThan(1);
  });

  it("una serie perfectamente constante no dispara ni explota", () => {
    expect(detectInstability(Array(TRAINING_WEEKS).fill(100)).alarm).toBe(false);
    expect(evaluateChainStability([{ weekStarts: ws, values: Array(TRAINING_WEEKS).fill(95) }]).status).toBe("estable");
  });
});
