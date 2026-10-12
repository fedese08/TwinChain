/**
 * Verifica que el motor actual dé EXACTAMENTE el mismo resultado que otra versión del motor
 * guardada en git: misma entrada, misma semilla, salida comparada bit a bit (tabla_k, déficit
 * total y las curvas de cada nodo). Sirve para cualquier optimización del motor que no deba
 * cambiar resultados — se usó para validar la poda por dominancia (docs/rendimiento-motor.md).
 *
 *   npx tsx scripts/verify-engine-equivalence.ts                 # contra HEAD, 600 casos
 *   npx tsx scripts/verify-engine-equivalence.ts 2000 --ref=abc123
 *
 * Sale con código 1 si encuentra alguna diferencia.
 */
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRng } from "../src/lib/domain/rng";
import { runScenarioSimulation as runNew } from "../src/lib/domain/simulate";
import type { DisruptionEvent, WeeklyPerformance } from "../src/lib/domain/types";

type Edge = { sourceNodeId: string; targetNodeId: string; transitTimeDays: number };

function mondayIso(weeksAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

function buildCase(seed: number) {
  const rng = createRng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const family = pick(["layered", "dense", "complete", "random-cycles", "line", "star"] as const);
  const n =
    family === "complete" ? 4 + Math.floor(rng() * 17) : family === "line" ? 3 + Math.floor(rng() * 12) : 5 + Math.floor(rng() * 40);
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges: Edge[] = [];
  const seen = new Set<string>();
  // Tránsitos variados, incluidos 0 y valores que redondean distinto (el motor usa máx(7, round(t/7)*7)).
  const transit = () => pick([0.5, 1, 3, 4, 6, 7, 10, 11, 14, 21, 30]);
  const add = (a: number, b: number) => {
    const key = `${a}>${b}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    edges.push({ sourceNodeId: ids[a], targetNodeId: ids[b], transitTimeDays: transit() });
  };

  if (family === "complete") for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) add(i, j);
  if (family === "line") for (let i = 0; i + 1 < n; i++) add(i, i + 1);
  if (family === "star") for (let i = 1; i < n; i++) add(0, i);
  if (family === "layered" || family === "dense") {
    const parents = family === "dense" ? 4 : 2;
    for (let i = 1; i < n; i++) {
      const layerStart = Math.max(0, i - 1 - Math.floor(rng() * 8));
      for (let p = 0; p < parents; p++) add(layerStart + Math.floor(rng() * (i - layerStart)), i);
    }
  }
  if (family === "random-cycles") {
    // Ciclos incluidos (A→B y B→A está permitido por el modelo): el tope de saltos es lo que corta.
    const m = n * (1 + Math.floor(rng() * 4));
    for (let e = 0; e < m; e++) add(Math.floor(rng() * n), Math.floor(rng() * n));
  }

  const history: WeeklyPerformance[] = [];
  const historyWeeks = 1 + Math.floor(rng() * 16);
  for (const nodeId of ids) {
    // Algunos nodos sin historial: el motor los saltea, tiene que seguir haciéndolo igual.
    if (rng() < 0.08) continue;
    for (let w = historyWeeks; w >= 1; w--) {
      const baseline = 70 + rng() * 28;
      const actual = baseline - rng() * 10;
      const width = rng() * 6;
      history.push({
        id: `${nodeId}-${w}`,
        nodeId,
        weekStart: mondayIso(w),
        actualValue: actual,
        baseline,
        baselineLowerBand: baseline - width,
        baselineUpperBand: baseline + width,
        deficit: Math.max(0, baseline - actual),
      });
    }
  }

  // Un escenario afecta un nodo, pero puede tener varios eventos sobre él, en fechas distintas.
  const target = ids[Math.floor(rng() * Math.min(n, 4))];
  const eventCount = 1 + Math.floor(rng() * 3);
  const events: DisruptionEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    id: `e${i}`,
    scenarioId: "s",
    nodeId: target,
    eventType: "corte",
    startDate: mondayIso(Math.floor(rng() * 6) - 3),
    // Incluye magnitudes cerca del piso de propagación (3) para ejercitar el corte.
    magnitude: pick([3, 4, 5, 6.5, 10, 20, 35, 50, 80, 100]),
  }));

  const horizon = pick([1, 4, 8, 12, 16, 26, 52]);
  const reconfig = rng() < 0.5 ? null : Math.floor(rng() * horizon);
  return { family, ids, edges, history, events, horizon, reconfig, seed: Math.floor(rng() * 2 ** 31) };
}

async function main() {
  const cases = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 600);
  const ref = process.argv.find((a) => a.startsWith("--ref="))?.slice("--ref=".length) ?? "HEAD";

  // La versión de referencia se extrae de git a un archivo temporal junto a este script, para que
  // resuelva los mismos imports (@/lib/domain/...) que el motor actual.
  const refPath = path.join(__dirname, "_engine-ref.ts");
  writeFileSync(refPath, execFileSync("git", ["show", `${ref}:src/lib/domain/simulate.ts`]));
  try {
    const { runScenarioSimulation: runOld } = (await import(refPath)) as { runScenarioSimulation: typeof runNew };
    const byFamily: Record<string, number> = {};
    let failures = 0;
    let oldMs = 0;
    let newMs = 0;

    for (let c = 0; c < cases; c++) {
      const t = buildCase(10_000 + c);
      const nodes = t.ids.map((id) => ({ id }));
      const options = { seed: t.seed, reconfigurationWeekIndex: t.reconfig };

      let s = performance.now();
      const before = runOld(nodes, t.edges, t.events, t.history, t.horizon, options);
      oldMs += performance.now() - s;
      s = performance.now();
      const after = runNew(nodes, t.edges, t.events, t.history, t.horizon, options);
      newMs += performance.now() - s;

      const a = JSON.stringify({ ...before, projectionByNode: [...before.projectionByNode] });
      const b = JSON.stringify({ ...after, projectionByNode: [...after.projectionByNode] });
      byFamily[t.family] = (byFamily[t.family] ?? 0) + 1;
      if (a !== b) {
        failures++;
        if (failures <= 3) console.log(`DIFERENCIA caso ${c} (${t.family}, n=${t.ids.length}, aristas=${t.edges.length})`);
      }
    }

    console.log(`referencia: ${ref} · casos: ${cases} · por familia: ${JSON.stringify(byFamily)}`);
    console.log(`diferencias: ${failures}`);
    console.log(`tiempo total motor de referencia: ${(oldMs / 1000).toFixed(2)} s · actual: ${(newMs / 1000).toFixed(2)} s`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    unlinkSync(refPath);
  }
}

main();
