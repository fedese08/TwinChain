// ⚠️ RUTA TEMPORAL — medición de rendimiento del motor en Vercel (docs/rendimiento-motor-vercel.md).
// Se borra apenas termina la medición. No la usa la app.
//
// Protegida por token: solo se guarda su SHA-256 acá; el token en claro no está en el repo.
// Los parámetros tienen tope en el servidor para que ni con el token sirva como quemador de CPU.
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { toEdge, toNode, toWeeklyPerformance } from "@/lib/data/mappers";
import { aristas, cadenas, desempenoSemanal, escenarios, eventos, getDb, nodos, resultados, usuarios } from "@/lib/db";
import { createRng } from "@/lib/domain/rng";
import { estimateSimulationWork, runScenarioSimulation } from "@/lib/domain/simulate";
import type { DisruptionEvent, SupplyChainEdge, WeeklyPerformance } from "@/lib/domain/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TOKEN_SHA256 = "5ad32e8dafc98e93b63eddb573a8f7fb5da96692ebd4f39d1980c56ff4da5999";

// Estado del módulo: vive mientras viva la instancia. Sirve para distinguir arranque en frío.
const instanceStartedAt = Date.now();
let invocations = 0;

type Topology = "layered" | "dense" | "complete" | "bidir";

function mondayIso(weeksAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

/** Mismas redes que scripts/bench-engine.ts: el evento del peor caso (en la raíz) alcanza todos los nodos. */
function buildNetwork(topology: Topology, n: number, eventCount: number, seed: number) {
  const rng = createRng(seed);
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges: Pick<SupplyChainEdge, "sourceNodeId" | "targetNodeId" | "transitTimeDays">[] = [];
  const transit = () => 1 + Math.floor(rng() * 6);

  if (topology === "complete") {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push({ sourceNodeId: ids[i], targetNodeId: ids[j], transitTimeDays: transit() });
  } else if (topology === "bidir") {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) edges.push({ sourceNodeId: ids[i], targetNodeId: ids[j], transitTimeDays: transit() });
  } else {
    const parentsPerNode = topology === "dense" ? 4 : 2;
    const rest = n - 1;
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
        for (let p = 0; p < Math.min(parentsPerNode, pool.length); p++) {
          const [parent] = pool.splice(Math.floor(rng() * pool.length), 1);
          edges.push({ sourceNodeId: parent, targetNodeId: child, transitTimeDays: transit() });
        }
      }
    }
  }

  const history: WeeklyPerformance[] = [];
  for (const nodeId of ids) {
    for (let w = 16; w >= 1; w--) {
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

  const events: DisruptionEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    id: `e${i}`,
    scenarioId: "s0",
    nodeId: ids[0],
    eventType: "corte",
    startDate: mondayIso(i % 4),
    magnitude: 100 - i,
  }));
  return { nodes: ids.map((id) => ({ id })), edges, history, events };
}

function snapshot() {
  const m = process.memoryUsage();
  return { rssMb: m.rss / 2 ** 20, heapUsedMb: m.heapUsed / 2 ** 20 };
}

class Rollback extends Error {}

export async function GET(request: Request) {
  const handlerStart = performance.now();
  const token = request.headers.get("x-bench-token") ?? "";
  if (createHash("sha256").update(token).digest("hex") !== TOKEN_SHA256) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  invocations++;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "engine";
  const runtime = {
    region: process.env.VERCEL_REGION ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    node: process.version,
    cpus: (await import("node:os")).cpus().length,
    instanceInvocation: invocations,
    instanceAgeS: (Date.now() - instanceStartedAt) / 1000,
  };

  if (mode === "ping") return NextResponse.json({ runtime });

  if (mode === "engine") {
    const topology = (url.searchParams.get("topology") ?? "dense") as Topology;
    if (!["layered", "dense", "complete", "bidir"].includes(topology)) return NextResponse.json({ error: "topología" }, { status: 400 });
    const n = Math.min(Math.max(Number(url.searchParams.get("n") ?? 6), 2), 300);
    const horizon = Math.min(Math.max(Number(url.searchParams.get("h") ?? 52), 1), 52);
    const eventCount = Math.min(Math.max(Number(url.searchParams.get("events") ?? 1), 1), 20);
    const seed = Number(url.searchParams.get("seed") ?? 1) >>> 0;

    const net = buildNetwork(topology, n, eventCount, seed);
    const before = snapshot();
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    const estimate = estimateSimulationWork(net.edges, net.events, horizon);
    const outcome = runScenarioSimulation(net.nodes, net.edges, net.events, net.history, horizon, { seed });
    const engineS = (performance.now() - t0) / 1000;
    const cpu = process.cpuUsage(cpu0);
    const after = snapshot();

    const row = {
      id: randomUUID(),
      escenarioId: randomUUID(),
      fechaCorrida: new Date().toISOString().slice(0, 10),
      tablaK: outcome.kTable.map((r) => ({ k: r.k, umbral_mediana: r.thresholdMedian, umbral_min: r.thresholdLow, umbral_max: r.thresholdHigh })),
      replicas: outcome.replications,
      semilla: outcome.seed,
      semanaReconfiguracion: outcome.reconfigurationWeekIndex,
    };
    return NextResponse.json({
      runtime,
      input: { topology, n, edges: net.edges.length, horizon, eventCount, seed },
      engine: {
        wallS: engineS,
        cpuS: (cpu.user + cpu.system) / 1e6,
        reached: outcome.projectionByNode.size,
        estimatedWorkM: estimate / 1e6,
      },
      memory: { before, after },
      rowKb: Buffer.byteLength(JSON.stringify(row)) / 1024,
      handlerS: (performance.now() - handlerStart) / 1000,
    });
  }

  if (mode === "db") {
    // Reproduce la carga de base de POST /api/escenarios sobre una cadena real, sin dejar nada:
    // las mismas lecturas, el motor, y las tres escrituras dentro de una transacción que se revierte.
    const db = getDb();
    const steps: Record<string, number> = {};
    const step = async <T,>(name: string, fn: () => Promise<T>) => {
      const s = performance.now();
      const value = await fn();
      steps[name] = (performance.now() - s) / 1000;
      return value;
    };
    const cpu0 = process.cpuUsage();

    const [user] = await step("1_usuario_sesion", () => db.select().from(usuarios).where(isNotNull(usuarios.organizacionId)).limit(1));
    const [chain] = await step("2_acceso_cadena", () =>
      db.select().from(cadenas).where(eq(cadenas.organizacionId, user.organizacionId!)).limit(1),
    );
    const nodeRows = await step("3_leer_nodos", () => db.select().from(nodos).where(eq(nodos.cadenaId, chain.id)));
    const nodeIds = nodeRows.map((n) => n.id);
    await step("4_nodo_afectado", () =>
      db.select({ id: nodos.id }).from(nodos).where(and(eq(nodos.id, nodeIds[0]), eq(nodos.cadenaId, chain.id))).limit(1),
    );
    const [edgeRows, weeklyRows] = await step("5_aristas_y_desempeno", () =>
      Promise.all([
        db.select().from(aristas).where(inArray(aristas.nodoOrigenId, nodeIds)),
        db.select().from(desempenoSemanal).where(inArray(desempenoSemanal.nodoId, nodeIds)),
      ]),
    );

    const scenarioId = randomUUID();
    const events = [{ id: randomUUID(), scenarioId, nodeId: nodeIds[0], eventType: "corte", startDate: mondayIso(0), magnitude: 40 }];
    const t0 = performance.now();
    const outcome = runScenarioSimulation(nodeRows.map(toNode), edgeRows.map(toEdge), events, weeklyRows.map(toWeeklyPerformance), 16, { seed: 1 });
    steps["6_motor"] = (performance.now() - t0) / 1000;

    await step("7_transaccion_revertida", async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(escenarios).values({ id: scenarioId, nombre: "bench (revertido)", horizonteProyeccion: 16, usuarioId: user.id, cadenaId: chain.id });
          await tx.insert(eventos).values(events.map((e) => ({ id: e.id, tipo: e.eventType, fechaInicio: e.startDate, magnitud: e.magnitude, nodoId: e.nodeId, escenarioId: scenarioId })));
          await tx.insert(resultados).values({
            escenarioId: scenarioId,
            fechaCorrida: new Date().toISOString().slice(0, 10),
            tablaK: outcome.kTable.map((r) => ({ k: r.k, umbral_mediana: r.thresholdMedian, umbral_min: r.thresholdLow, umbral_max: r.thresholdHigh })),
            replicas: outcome.replications,
            semilla: outcome.seed,
            semanaReconfiguracion: null,
          });
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    });
    const cpu = process.cpuUsage(cpu0);
    // Comprobación de que no quedó nada.
    const leftovers = await db.select({ id: escenarios.id }).from(escenarios).where(eq(escenarios.id, scenarioId));

    return NextResponse.json({
      runtime,
      chain: { nodes: nodeRows.length, edges: edgeRows.length, weeks: weeklyRows.length },
      steps,
      dbS: Object.entries(steps).filter(([k]) => k !== "6_motor").reduce((s, [, v]) => s + v, 0),
      cpuS: (cpu.user + cpu.system) / 1e6,
      memory: snapshot(),
      leftovers: leftovers.length,
      handlerS: (performance.now() - handlerStart) / 1000,
    });
  }

  return NextResponse.json({ error: "modo" }, { status: 400 });
}
