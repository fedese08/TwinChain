/**
 * Prueba de rendimiento del motor de simulación (`runScenarioSimulation`).
 *
 *   npx tsx scripts/bench-engine.ts                 # matriz completa
 *   npx tsx scripts/bench-engine.ts --quick         # 1 repetición, sin los N más grandes
 *
 * Mide SOLO el motor (CPU puro). No incluye lectura/escritura en la base ni el arranque de la
 * función serverless: eso hay que medirlo en el entorno real (ver docs/rendimiento-motor.md).
 *
 * Cada corrida va en un proceso hijo aparte y con timeout, por dos motivos: la memoria pico
 * (`maxRSS`) es por proceso y no se puede "resetear", y una topología patológica puede colgar el
 * motor — el padre la mata y la registra como `timeout` en vez de colgarse con ella.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRng } from "../src/lib/domain/rng";
import { runScenarioSimulation } from "../src/lib/domain/simulate";
import type { DisruptionEvent, SupplyChainEdge, WeeklyPerformance } from "../src/lib/domain/types";

type Topology = "layered" | "dense" | "forward-complete";

interface Config {
  topology: Topology;
  nodes: number;
  horizon: number;
  seed: number;
}

interface Measurement {
  status: "ok" | "error" | "timeout";
  wallS?: number;
  cpuS?: number;
  maxRssMb?: number;
  heapDeltaMb?: number;
  reached?: number;
  rowKb?: number;
  curvesKb?: number;
  detail?: string;
}

const TIMEOUT_MS = 120_000;
const HISTORY_WEEKS = 16;

// ───────────────────────────── generación de la red ─────────────────────────────

function mondayIso(weeksAgo: number): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Red sintética donde el evento del peor caso (en el nodo raíz) alcanza TODOS los nodos.
 * - layered / dense: una raíz y 4 capas más; cada nodo tiene 2 (layered) o 4 (dense) padres en la
 *   capa anterior.
 * - forward-complete: el nodo i apunta a todos los j > i (el peor grafo posible para el BFS).
 */
function buildNetwork(config: Config) {
  const rng = createRng(config.seed);
  const ids = Array.from({ length: config.nodes }, (_, i) => `n${i}`);
  const edges: Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">[] = [];
  const transit = () => 1 + Math.floor(rng() * 6);

  if (config.topology === "forward-complete") {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) edges.push({ sourceNodeId: ids[i], targetNodeId: ids[j], transitTimeDays: transit() });
    }
  } else {
    const parentsPerNode = config.topology === "dense" ? 4 : 2;
    const rest = ids.length - 1;
    const layerCount = Math.min(4, rest);
    const layers: string[][] = [[ids[0]]];
    let cursor = 1;
    for (let l = 0; l < layerCount; l++) {
      const size = Math.ceil((rest - (cursor - 1)) / (layerCount - l));
      layers.push(ids.slice(cursor, cursor + size));
      cursor += size;
    }
    for (let l = 1; l < layers.length; l++) {
      for (const child of layers[l]) {
        const pool = [...layers[l - 1]];
        const take = Math.min(parentsPerNode, pool.length);
        for (let p = 0; p < take; p++) {
          const [parent] = pool.splice(Math.floor(rng() * pool.length), 1);
          edges.push({ sourceNodeId: parent, targetNodeId: child, transitTimeDays: transit() });
        }
      }
    }
  }

  const history: WeeklyPerformance[] = [];
  for (const nodeId of ids) {
    for (let w = HISTORY_WEEKS; w >= 1; w--) {
      const baseline = 90 + rng() * 6;
      const actual = baseline - rng() * 6;
      history.push({
        id: `${nodeId}-${w}`,
        nodeId,
        weekStart: mondayIso(w),
        actualValue: actual,
        baseline,
        baselineLowerBand: baseline - 2,
        baselineUpperBand: baseline + 2,
        deficit: Math.max(0, baseline - actual),
      });
    }
  }

  // Peor caso: magnitud máxima sobre la raíz, para que el piso de propagación corte lo más tarde posible.
  const events: DisruptionEvent[] = [
    { id: "e0", scenarioId: "s0", nodeId: ids[0], eventType: "corte", startDate: mondayIso(0), magnitude: 100 },
  ];
  return { nodes: ids.map((id) => ({ id })), edges, history, events };
}

// ───────────────────────────── hijo: una corrida medida ─────────────────────────────

function runChild(config: Config): Measurement {
  const { nodes, edges, history, events } = buildNetwork(config);
  const heap0 = process.memoryUsage().heapUsed;
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();

  const outcome = runScenarioSimulation(nodes, edges, events, history, config.horizon, { seed: config.seed });

  const wallS = Number(process.hrtime.bigint() - t0) / 1e9;
  const cpu = process.cpuUsage(cpu0);
  const heapDeltaMb = (process.memoryUsage().heapUsed - heap0) / 1024 / 1024;

  // Fila que hoy se guarda en `resultados`: solo tabla_k (10 filas), no depende de N.
  const row = {
    id: crypto.randomUUID(),
    escenarioId: crypto.randomUUID(),
    fechaCorrida: "2026-10-05",
    tablaK: outcome.kTable.map((r) => ({
      k: r.k,
      umbral_mediana: r.thresholdMedian,
      umbral_min: r.thresholdLow,
      umbral_max: r.thresholdHigh,
    })),
    replicas: outcome.replications,
    semilla: outcome.seed,
    semanaReconfiguracion: outcome.reconfigurationWeekIndex,
  };
  // Hipotético: guardar además las curvas por nodo (la corrección posible del bug de "curvas
  // recalculadas con la cadena actual" de docs/pendientes.md). Ahí sí escala con N.
  const curves = [...outcome.projectionByNode.entries()];

  return {
    status: "ok",
    wallS,
    cpuS: (cpu.user + cpu.system) / 1e6,
    maxRssMb: process.resourceUsage().maxRSS / 1024,
    heapDeltaMb,
    reached: outcome.projectionByNode.size,
    rowKb: Buffer.byteLength(JSON.stringify(row)) / 1024,
    curvesKb: Buffer.byteLength(JSON.stringify(curves)) / 1024,
  };
}

// ───────────────────────────── padre: orquestación ─────────────────────────────

function measure(config: Config): Measurement {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const run = spawnSync(tsx, [__filename, "--child", JSON.stringify(config)], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return { status: "timeout" };
  if (run.status !== 0) return { status: "error", detail: (run.stderr || run.stdout || "").trim().split("\n").slice(-2).join(" | ").slice(0, 160) };
  const line = run.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  return line ? (JSON.parse(line) as Measurement) : { status: "error", detail: "sin salida" };
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (v: number | undefined, digits = 2) => (v === undefined ? "—" : v.toFixed(digits));

function row(label: string, config: Omit<Config, "seed">, reps: number) {
  const runs: Measurement[] = [];
  for (let r = 0; r < reps; r++) {
    const m = measure({ ...config, seed: 1000 + r });
    runs.push(m);
    if (m.status !== "ok") break; // si ya rompió, repetir no aporta
  }
  const bad = runs.find((m) => m.status !== "ok");
  const ok = runs.filter((m) => m.status === "ok");
  const pick = (f: (m: Measurement) => number | undefined, agg: (v: number[]) => number) => {
    const v = ok.map(f).filter((x): x is number => x !== undefined);
    return v.length ? agg(v) : undefined;
  };
  return (
    `| ${label} | ${config.nodes} | ${config.horizon} | ${ok.length}/${reps} | ` +
    `${fmt(pick((m) => m.wallS, median), 3)} | ${fmt(pick((m) => m.wallS, (v) => Math.max(...v)), 3)} | ` +
    `${fmt(pick((m) => m.cpuS, median), 3)} | ${fmt(pick((m) => m.maxRssMb, (v) => Math.max(...v)), 0)} | ` +
    `${fmt(pick((m) => m.heapDeltaMb, (v) => Math.max(...v)), 0)} | ${fmt(pick((m) => m.rowKb, median), 2)} | ` +
    `${fmt(pick((m) => m.curvesKb, median), 0)} | ${fmt(pick((m) => m.reached, median), 0)} | ` +
    `${bad ? `**${bad.status}** ${bad.detail ?? ""}` : "OK"} |`
  );
}

const HEADER =
  "| Topología | N | H (sem) | Corridas OK | Tiempo mediana (s) | Tiempo peor (s) | CPU mediana (s) | RSS pico (MB) | Heap del motor (MB) | Fila RESULTADO (KB) | Curvas por nodo (KB) | Nodos alcanzados | Resultado |\n" +
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|";

function main() {
  const childIndex = process.argv.indexOf("--child");
  if (childIndex !== -1) {
    console.log(JSON.stringify(runChild(JSON.parse(process.argv[childIndex + 1]) as Config)));
    return;
  }

  const quick = process.argv.includes("--quick");
  const reps = quick ? 1 : 5;
  console.log(`# Banco de pruebas del motor\n`);
  console.log(`- Máquina: ${os.cpus()[0].model} · ${os.cpus().length} núcleos · ${(os.totalmem() / 2 ** 30).toFixed(0)} GB · ${os.platform()} ${os.arch()}`);
  console.log(`- Node ${process.version} · ${reps} repetición(es) por fila · timeout ${TIMEOUT_MS / 1000} s\n`);

  const sizes = quick ? [6, 40, 150, 300] : [6, 40, 150, 300, 600, 1000, 2000];
  for (const horizon of [16, 52]) {
    console.log(`\n## Red en capas (2 padres por nodo), horizonte ${horizon} semanas\n`);
    console.log(HEADER);
    for (const n of sizes) console.log(row("capas", { topology: "layered", nodes: n, horizon }, reps));
  }

  console.log(`\n## Red densa (4 padres por nodo), horizonte 52 semanas\n`);
  console.log(HEADER);
  for (const n of sizes) console.log(row("densa", { topology: "dense", nodes: n, horizon: 52 }, reps));

  console.log(`\n## Peor topología posible: cada nodo apunta a todos los posteriores, horizonte 16\n`);
  console.log(HEADER);
  // Antes de la poda por dominancia esta red pasaba los 120 s con 26 nodos; se sigue de largo
  // para ver dónde está el techo ahora (50 es el tope actual de la API; 150/300, los de Max).
  for (const n of [6, 10, 14, 18, 22, 26, 50, 100, 150, 300]) {
    console.log(row("completa", { topology: "forward-complete", nodes: n, horizon: 16 }, quick ? 1 : 3));
  }
}

main();
