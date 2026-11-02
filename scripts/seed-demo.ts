/**
 * Caso de demo para la presentación: "Hogar Andino", un e-commerce mediano de hogar y deco que terceriza su logística.
 * Deja todo listo para mostrar el recorrido completo: una cadena de 10 nodos, una alerta de degradación sostenida
 * vigente en un proveedor clave, un nodo en vigilancia y tres simulaciones guardadas con sus resultados.
 *
 *   SEED_DEMO_PASSWORD='la-clave-que-quieras' npm run db:seed:demo
 *
 * Es idempotente: borra y recrea SOLO la organización de esta demo (la del administrador `presentacion@twinchain.dev`);
 * no toca ninguna otra. Los datos salen del mismo camino que usa la app: el historial de cada nodo lo genera el sensor
 * simulado, el modelo de ML estima su línea base (si `ML_SERVICE_URL` está configurado; si no, queda la provisoria) y las
 * simulaciones las corre el mismo motor. Sobre ese historial estable se escribe la historia del caso: las últimas semanas
 * de "Cerámica Cuyo" (paro de transporte en Mendoza) y de "CD Córdoba".
 *
 * Usa DIRECT_URL (o DATABASE_URL) de `.env.local`. Para probarlo sin tocar Neon, apuntalo a una base local.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

loadEnvConfig(process.cwd());

import * as schema from "../src/lib/db/schema";
import { ensureRoles } from "../src/lib/db/roles";
import { thresholdForCost } from "../src/lib/domain/cusum-config";
import { degradationPeriods, degradationStatus } from "../src/lib/domain/degradation";
import { deriveAlertScenario } from "../src/lib/domain/detection";
import { buildChainHistory, lastCompleteWeek } from "../src/lib/domain/synthetic";
import { mondayOf } from "../src/lib/domain/synthetic/weeks";
import type { DisruptionEvent, NodeType } from "../src/lib/domain/types";
import { ingestChainHistory } from "../src/lib/ingestion/ingest-history";
import { prepareSensorBaselines } from "../src/lib/ingestion/vendedor-setup";
import type { NodeBaseline } from "../src/lib/domain/vendedor/baseline";
import { runScenarioOnChain } from "../src/lib/simulation/run-scenario";

const ADMIN_EMAIL = "presentacion@twinchain.dev";
const OPERATOR_EMAIL = "operador.demo@twinchain.dev";
/** Sensibilidad de la cadena: "Media" (una falsa alarma cuesta 2 semanas de operar degradado). */
const FALSE_ALARM_COST = 2;

// ── El caso ───────────────────────────────────────────────────────────────────────────────────────

interface DemoNode {
  key: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  supply?: number;
  production?: number;
  storage?: number;
  stock?: number;
}

const NODES: DemoNode[] = [
  { key: "ceramica", type: "Proveedor", label: "Cerámica Cuyo", x: 0, y: 40, supply: 2400 },
  { key: "textiles", type: "Proveedor", label: "Textiles del Norte", x: 0, y: 200, supply: 3000 },
  { key: "maderas", type: "Proveedor", label: "Maderas Patagonia", x: 0, y: 360, supply: 1500 },
  { key: "taller", type: "Fabrica", label: "Taller de armado Pilar", x: 280, y: 200, production: 1800 },
  { key: "cdba", type: "Almacen", label: "CD Buenos Aires", x: 560, y: 120, storage: 6000, stock: 4200 },
  { key: "cdcor", type: "Almacen", label: "CD Córdoba", x: 560, y: 300, storage: 3000, stock: 1800 },
  { key: "tienda", type: "Vendedor", label: "Tienda online", x: 840, y: 40 },
  { key: "market", type: "Vendedor", label: "Marketplace", x: 840, y: 240 },
  { key: "amba", type: "Cliente", label: "Clientes AMBA", x: 1120, y: 120 },
  { key: "interior", type: "Cliente", label: "Clientes Interior", x: 1120, y: 320 },
];

/** [origen, destino, tránsito en días] */
const EDGES: [string, string, number][] = [
  ["ceramica", "taller", 6],
  ["textiles", "taller", 4],
  ["maderas", "taller", 5],
  ["taller", "cdba", 1],
  ["taller", "cdcor", 3],
  ["cdba", "tienda", 1],
  ["cdba", "market", 2],
  ["cdcor", "market", 3],
  ["tienda", "amba", 2],
  ["market", "amba", 3],
  ["market", "interior", 5],
  ["cdcor", "interior", 2],
];

/**
 * La historia del caso, en múltiplos del margen K de cada nodo (K = línea base − límite inferior de su banda): cuánto
 * por debajo de su línea base rindió cada una de las últimas semanas. Cerámica Cuyo se degrada de a poco (un paro de
 * transporte en Mendoza) y CD Córdoba empieza a mostrar un desvío que todavía no llega a confirmarse.
 */
const STORY: Record<string, number[]> = {
  ceramica: [0.9, 1.2, 1.5, 1.7, 1.8, 1.9, 1.9, 1.8],
  cdcor: [1.3, 1.45, 1.3],
};

// ── Armado ────────────────────────────────────────────────────────────────────────────────────────

/** Un uuid determinístico a partir de un texto. */
function stableId(text: string): string {
  const h = createHash("md5").update(`hogar-andino:${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DIRECT_URL (o DATABASE_URL) en .env.local");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const roles = await ensureRoles(db);
    // Ids de nodo fijos (salen de su clave y de una variante): la serie del sensor depende del id, así que cada vez que se
    // corre el seed el caso queda IDÉNTICO y lo que se ensayó es lo que se muestra. La variante se elige para que el
    // historial estable no tenga falsas alarmas y la historia del caso sea la única que se vea: el sensor es aleatorio y
    // con cualquier sensibilidad un nodo sano puede dar una falsa alarma de vez en cuando.
    const endWeek = lastCompleteWeek();
    const cusumH = thresholdForCost(FALSE_ALARM_COST);
    let nodeIds = new Map<string, string>();
    let baselines = new Map<string, NodeBaseline>();
    let variant = -1;
    let fewestPast = Infinity;
    for (let candidate = 0; candidate < 40 && fewestPast > 0; candidate++) {
      const ids = new Map(NODES.map((n) => [n.key, stableId(`${candidate}:${n.key}`)]));
      const prepared = await prepareSensorBaselines(NODES.map((n) => ({ id: ids.get(n.key)!, tipo: n.type })), endWeek);
      const history = buildChainHistory(
        NODES.map((n) => ({ id: ids.get(n.key)!, type: n.type, baseline: prepared.get(ids.get(n.key)!) })),
        { endWeek },
      );
      let past = 0;
      const levels = NODES.map((n) => {
        const rows = history.rows.filter((r) => r.nodeId === ids.get(n.key)).sort((x, y) => x.weekStart.localeCompare(y.weekStart));
        const story = STORY[n.key];
        if (story) {
          for (const [i, row] of rows.slice(-story.length).entries()) {
            row.actualValue = row.baseline - story[i] * (row.baseline - row.baselineLowerBand);
            row.deficit = Math.max(0, row.baseline - row.actualValue);
          }
        }
        // Períodos pasados que aparecerían en el historial de alertas (la alerta vigente de Cerámica Cuyo no cuenta).
        past += degradationPeriods(rows, cusumH).length - (n.key === "ceramica" ? 1 : 0);
        return [n.key, degradationStatus(rows, cusumH).level] as const;
      });
      const expected = (key: string) => (key === "ceramica" ? "alerta" : key === "cdcor" ? "atencion" : "normal");
      if (levels.every(([key, level]) => level === expected(key)) && past < fewestPast) {
        fewestPast = past;
        variant = candidate;
        nodeIds = ids;
        baselines = new Map(NODES.map((n) => [n.key, prepared.get(ids.get(n.key)!)!] as [string, NodeBaseline]));
      }
    }
    if (variant < 0) throw new Error("Ninguna variante del sensor dejó la historia del caso limpia: probá con otra sensibilidad o más variantes.");
    const idToBaseline = new Map(NODES.map((n) => [nodeIds.get(n.key)!, baselines.get(n.key)!]));
    const chainId = randomUUID();
    const orgId = randomUUID();
    const adminId = randomUUID();
    const operatorId = randomUUID();
    const fromModel = [...baselines.values()].filter((b) => b.source === "ml").length;
    console.log(`Variante del sensor: ${variant} (alertas pasadas en el historial: ${fewestPast}). Nodos: ${NODES.length} (línea base del modelo: ${fromModel}, provisoria: ${NODES.length - fromModel})`);

    const password = process.env.SEED_DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);

    await db.transaction(async (tx) => {
      // Reset de la organización de esta demo (y solo de esa).
      const [previous] = await tx.select().from(schema.usuarios).where(eq(schema.usuarios.email, ADMIN_EMAIL));
      if (previous?.organizacionId) {
        const previousOrg = previous.organizacionId;
        await tx.delete(schema.cadenas).where(eq(schema.cadenas.organizacionId, previousOrg));
        await tx.delete(schema.usuarios).where(eq(schema.usuarios.organizacionId, previousOrg));
        await tx.delete(schema.organizaciones).where(eq(schema.organizaciones.id, previousOrg));
      } else if (previous) {
        await tx.delete(schema.usuarios).where(eq(schema.usuarios.id, previous.id));
      }
      await tx.delete(schema.usuarios).where(eq(schema.usuarios.email, OPERATOR_EMAIL));

      // Plan Pro: la demo tiene 10 nodos y 3 simulaciones guardadas, más de lo que admite Freemium.
      await tx.insert(schema.organizaciones).values({ id: orgId, nombre: "Hogar Andino S.A.", plan: "pro" });
      await tx.insert(schema.usuarios).values([
        { id: adminId, nombre: "Carolina Méndez", email: ADMIN_EMAIL, contrasena: passwordHash, rolId: roles.admin, organizacionId: orgId },
        { id: operatorId, nombre: "Julián Rossi", email: OPERATOR_EMAIL, contrasena: passwordHash, rolId: roles.operator, organizacionId: orgId },
      ]);
      await tx.insert(schema.cadenas).values({
        id: chainId,
        nombre: "Abastecimiento Hogar Andino",
        organizacionId: orgId,
        visibilidad: "shared",
        creadaPor: adminId,
        costoFalsaAlarma: FALSE_ALARM_COST,
      });
      await tx.insert(schema.nodos).values(
        NODES.map((n) => ({
          id: nodeIds.get(n.key)!,
          tipo: n.type,
          cadenaId: chainId,
          etiqueta: n.label,
          posX: n.x,
          posY: n.y,
          capacidadSuministro: n.supply ?? null,
          capacidadProduccion: n.production ?? null,
          capacidadAlmacenamiento: n.storage ?? null,
          nivelStockActual: n.stock ?? null,
        })),
      );
      await tx.insert(schema.aristas).values(
        EDGES.map(([from, to, days]) => ({ nodoOrigenId: nodeIds.get(from)!, nodoDestinoId: nodeIds.get(to)!, tiempoTransito: days })),
      );
      // El historial de 28 semanas de cada nodo, igual que cuando se crea una cadena en la app.
      await ingestChainHistory(tx, chainId, { baselines: idToBaseline, endWeek });
    });

    // ── La historia del caso: las últimas semanas de dos nodos ────────────────────────────────────
    for (const [key, factors] of Object.entries(STORY)) {
      const nodeId = nodeIds.get(key)!;
      const rows = await db.select().from(schema.desempenoSemanal).where(eq(schema.desempenoSemanal.nodoId, nodeId)).orderBy(asc(schema.desempenoSemanal.semana));
      const target = rows.slice(-factors.length);
      for (const [i, row] of target.entries()) {
        const margin = row.lineaBase - row.bandaInferior;
        const actual = row.lineaBase - factors[i] * margin;
        await db
          .update(schema.desempenoSemanal)
          .set({ valorReal: actual, deficit: Math.max(0, row.lineaBase - actual) })
          .where(eq(schema.desempenoSemanal.id, row.id));
      }
    }

    // ── Las simulaciones guardadas ─────────────────────────────────────────────────────────────────
    const ceramicaRows = (await db.select().from(schema.desempenoSemanal).where(eq(schema.desempenoSemanal.nodoId, nodeIds.get("ceramica")!)).orderBy(asc(schema.desempenoSemanal.semana))).map(
      (r) => ({ id: r.id, nodeId: r.nodoId, weekStart: r.semana, actualValue: r.valorReal, baseline: r.lineaBase, baselineLowerBand: r.bandaInferior, baselineUpperBand: r.bandaSuperior, deficit: r.deficit }),
    );
    const status = degradationStatus(ceramicaRows, cusumH);
    const alert = deriveAlertScenario(ceramicaRows, { cusumH });
    if (!alert) throw new Error("La historia del caso no generó una alerta en Cerámica Cuyo: hay que ajustar STORY.");
    console.log(`Alerta de Cerámica Cuyo: desde ${alert.startDate}, ${alert.observedWeeks} semanas, caída media ${alert.magnitudePct} %, estado ${status.level}.`);

    // Estado de cada nodo tal como lo va a ver la persona que mira la app (con la sensibilidad de la cadena).
    for (const n of NODES) {
      const rows = (await db.select().from(schema.desempenoSemanal).where(eq(schema.desempenoSemanal.nodoId, nodeIds.get(n.key)!)).orderBy(asc(schema.desempenoSemanal.semana))).map(
        (r) => ({ id: r.id, nodeId: r.nodoId, weekStart: r.semana, actualValue: r.valorReal, baseline: r.lineaBase, baselineLowerBand: r.bandaInferior, baselineUpperBand: r.bandaSuperior, deficit: r.deficit }),
      );
      console.log(`  ${n.label.padEnd(24)} ${degradationStatus(rows, cusumH).level}`);
    }

    const monday = mondayOf(new Date().toISOString().slice(0, 10));
    const scenarios = [
      {
        id: randomUUID(),
        name: "Cómo sigue Cerámica Cuyo (desde la alerta)",
        horizon: 16,
        decisionWeek: alert.decisionWeek,
        event: { nodeKey: "ceramica", eventType: "degradacion_detectada", startDate: alert.startDate, magnitude: alert.magnitudePct },
        runs: [1, null] as (number | null)[],
      },
      {
        id: randomUUID(),
        name: "Corte total en Cerámica Cuyo por paro de transporte",
        horizon: 12,
        decisionWeek: undefined,
        event: { nodeKey: "ceramica", eventType: "corte", startDate: monday, magnitude: 90 },
        runs: [null] as (number | null)[],
      },
      {
        id: randomUUID(),
        name: "Huelga en el CD Córdoba",
        horizon: 8,
        decisionWeek: undefined,
        event: { nodeKey: "cdcor", eventType: "huelga", startDate: monday, magnitude: 60 },
        runs: [null] as (number | null)[],
      },
    ];

    let order = 0;
    for (const s of scenarios) {
      const event: DisruptionEvent = { id: randomUUID(), scenarioId: s.id, nodeId: nodeIds.get(s.event.nodeKey)!, eventType: s.event.eventType, startDate: s.event.startDate, magnitude: s.event.magnitude };
      await db.insert(schema.escenarios).values({
        id: s.id,
        nombre: s.name,
        horizonteProyeccion: s.horizon,
        usuarioId: adminId,
        cadenaId: chainId,
        semanaDecision: s.decisionWeek ?? null,
        creadoEn: new Date(Date.now() + order++ * 1000),
      });
      await db.insert(schema.eventos).values({ id: event.id, tipo: event.eventType, fechaInicio: event.startDate, magnitud: event.magnitude, nodoId: event.nodeId, escenarioId: s.id });
      for (const reconfiguration of s.runs) {
        const run = await runScenarioOnChain(db, { scenarioId: s.id, chainId, horizonWeeks: s.horizon, events: [event], reconfigurationWeekIndex: reconfiguration, decisionWeek: s.decisionWeek });
        await db.insert(schema.resultados).values({
          id: run.id,
          escenarioId: s.id,
          fechaCorrida: run.fechaCorrida,
          tablaK: run.tablaK,
          replicas: run.replicas,
          semilla: run.semilla,
          semanaReconfiguracion: run.semanaReconfiguracion,
          creadoEn: new Date(Date.now() + order++ * 1000),
        });
      }
    }

    console.log("\nDemo lista: organización «Hogar Andino S.A.» (plan Pro), 1 cadena de 10 nodos y 3 simulaciones guardadas.");
    console.log(`\nAdministradora:  ${ADMIN_EMAIL}`);
    console.log(`Operador:        ${OPERATOR_EMAIL}`);
    if (process.env.SEED_DEMO_PASSWORD) console.log("Contraseña:      la de SEED_DEMO_PASSWORD (la misma para las dos cuentas)");
    else console.log(`Contraseña:      ${password}   (única vez; para elegir una: SEED_DEMO_PASSWORD='...')`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
