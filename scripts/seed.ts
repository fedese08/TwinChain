/**
 * Carga la data demo (la misma del mock: Andes Manufactura, Cadena Norte y Sur, escenarios y
 * corridas) en la base real. Es idempotente: borra y recrea SOLO la organización demo.
 *
 *   npm run db:seed
 *
 * Login demo: demo@twinchain.dev. La contraseña sale de SEED_DEMO_PASSWORD; si no está definida
 * se genera una al azar y se imprime una única vez.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

loadEnvConfig(process.cwd());

import * as schema from "../src/lib/db/schema";
import { ensureRoles } from "../src/lib/db/roles";
import { toKTableRows } from "../src/lib/data/mappers";
import {
  seedChains,
  seedEdges,
  seedEvents,
  seedNodes,
  seedOrganization,
  seedScenarios,
  seedVendedorNodes,
  buildSeedResults,
  buildSeedWeeklyPerformance,
} from "./seed-data";
import { prepareSensorBaselines, resolveVendedorBaseline } from "../src/lib/ingestion/vendedor-setup";
import { getSellerWeeks } from "../src/lib/olist/sample";
import { lastCompleteWeek } from "../src/lib/domain/synthetic";
import type { NodeBaseline } from "../src/lib/domain/vendedor/baseline";

const DEMO_EMAIL = "demo@twinchain.dev";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DIRECT_URL (o DATABASE_URL) en .env.local");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const roles = await ensureRoles(db);

    // Cada nodo de la demo recibe su línea base del modelo de ML, estimada con las primeras semanas de su sensor
    // simulado (si el servicio no está configurado o no contesta, queda la provisoria, marcada como tal en el nodo).
    // Los ids de la base se deciden ANTES: la serie del sensor depende del id del nodo.
    const nodeIds = new Map<string, string>(seedNodes.map((n) => [n.id, randomUUID()]));
    const seedIdOf = new Map([...nodeIds].map(([seedId, uuid]) => [uuid, seedId]));
    const endWeek = lastCompleteWeek();
    const sensorNodes = seedNodes.filter((n) => !n.olistSellerId);
    const byUuid = await prepareSensorBaselines(sensorNodes.map((n) => ({ id: nodeIds.get(n.id)!, tipo: n.nodeType })), endWeek);
    const baselines = new Map<string, NodeBaseline>(sensorNodes.map((n) => [n.id, byUuid.get(nodeIds.get(n.id)!)!]));
    for (const node of seedVendedorNodes) {
      baselines.set(node.id, await resolveVendedorBaseline(getSellerWeeks(node.olistSellerId!)!, 20_000));
    }
    const seedWeeklyPerformance = buildSeedWeeklyPerformance(baselines, (seedId) => nodeIds.get(seedId)!);
    const seedResults = buildSeedResults(
      seedWeeklyPerformance.map((w) => ({ ...w, nodeId: seedIdOf.get(w.nodeId)! })),
      baselines,
    );
    const fromModel = [...baselines.values()].filter((b) => b.source === "ml").length;
    console.log(`Nodos: ${baselines.size} (línea base del modelo: ${fromModel}, provisoria: ${baselines.size - fromModel})`);

    const password = process.env.SEED_DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);

    await db.transaction(async (tx) => {
      // --- Reset de la organización demo (y solo de esa) ---------------------------------
      const [demoUser] = await tx.select().from(schema.usuarios).where(eq(schema.usuarios.email, DEMO_EMAIL));
      if (demoUser?.organizacionId) {
        const orgId = demoUser.organizacionId;
        // Orden por las FK `restrict`: cadenas (cascada a nodos, escenarios, etc.) → usuarios → organización.
        await tx.delete(schema.cadenas).where(eq(schema.cadenas.organizacionId, orgId));
        await tx.delete(schema.usuarios).where(eq(schema.usuarios.organizacionId, orgId));
        await tx.delete(schema.organizaciones).where(eq(schema.organizaciones.id, orgId));
      } else if (demoUser) {
        await tx.delete(schema.usuarios).where(eq(schema.usuarios.id, demoUser.id));
      }

      // --- Organización y usuario ---------------------------------------------------------
      const orgId = randomUUID();
      const userId = randomUUID();
      await tx.insert(schema.organizaciones).values({
        id: orgId,
        nombre: seedOrganization.name,
        // La demo tiene dos cadenas, 14 nodos y 3 escenarios: solo entra en Max (el resto de las organizaciones nace en Freemium).
        plan: "max",
      });
      await tx.insert(schema.usuarios).values({
        id: userId,
        nombre: "Federico Sena",
        email: DEMO_EMAIL,
        contrasena: passwordHash,
        rolId: roles.admin,
        organizacionId: orgId,
      });

      // --- Cadenas, nodos, aristas -------------------------------------------------------
      const chainIds = new Map(seedChains.map((c) => [c.id, randomUUID()]));
      await tx.insert(schema.cadenas).values(
        seedChains.map((c) => ({
          id: chainIds.get(c.id)!,
          nombre: c.name,
          organizacionId: orgId,
          visibilidad: c.visibility,
          creadaPor: userId,
        })),
      );

      await tx.insert(schema.nodos).values(
        seedNodes.map((n) => ({
          id: nodeIds.get(n.id)!,
          tipo: n.nodeType,
          cadenaId: chainIds.get(n.chainId)!,
          etiqueta: n.label,
          posX: n.canvasPosition.x,
          posY: n.canvasPosition.y,
          capacidadSuministro: n.supplyCapacity ?? null,
          capacidadProduccion: n.productionCapacity ?? null,
          capacidadAlmacenamiento: n.storageCapacity ?? null,
          nivelStockActual: n.currentStockLevel ?? null,
          vendedorOlistId: n.olistSellerId ?? null,
          fuenteLineaBase: baselines.get(n.id)?.source ?? null,
        })),
      );

      await tx.insert(schema.aristas).values(
        seedEdges.map((e) => ({
          nodoOrigenId: nodeIds.get(e.sourceNodeId)!,
          nodoDestinoId: nodeIds.get(e.targetNodeId)!,
          tiempoTransito: e.transitTimeDays,
        })),
      );

      // --- Desempeño semanal -------------------------------------------------------------
      await tx.insert(schema.desempenoSemanal).values(
        seedWeeklyPerformance.map((w) => ({
          nodoId: w.nodeId,
          semana: w.weekStart,
          valorReal: w.actualValue,
          lineaBase: w.baseline,
          bandaInferior: w.baselineLowerBand,
          bandaSuperior: w.baselineUpperBand,
          bandaSemanalInferior: w.weeklyBandLower ?? null,
          bandaSemanalSuperior: w.weeklyBandUpper ?? null,
          deficit: w.deficit,
        })),
      );

      // --- Escenarios, eventos y corridas -------------------------------------------------
      const scenarioIds = new Map(seedScenarios.map((s) => [s.id, randomUUID()]));
      await tx.insert(schema.escenarios).values(
        seedScenarios.map((s) => ({
          id: scenarioIds.get(s.id)!,
          nombre: s.name,
          horizonteProyeccion: s.projectionHorizonWeeks,
          usuarioId: userId,
          cadenaId: chainIds.get(s.chainId)!,
          creadoEn: new Date(s.createdAt),
        })),
      );

      await tx.insert(schema.eventos).values(
        seedEvents.map((e) => ({
          tipo: e.eventType,
          fechaInicio: e.startDate,
          magnitud: e.magnitude,
          nodoId: nodeIds.get(e.nodeId)!,
          escenarioId: scenarioIds.get(e.scenarioId)!,
        })),
      );

      await tx.insert(schema.resultados).values(
        seedResults.map((r, i) => ({
          escenarioId: scenarioIds.get(r.scenarioId)!,
          fechaCorrida: r.runDate,
          tablaK: toKTableRows(r.kTable),
          replicas: r.replications,
          semilla: r.seed,
          semanaReconfiguracion: r.reconfigurationWeekIndex,
          // Las corridas se ordenan por `creado_en`: separadas 1 s para conservar el orden del seed.
          creadoEn: new Date(Date.now() + i * 1000),
        })),
      );
    });

    const counts = {
      organizaciones: (await db.select().from(schema.organizaciones)).length,
      nodos: (await db.select().from(schema.nodos)).length,
      resultados: (await db.select().from(schema.resultados)).length,
    };
    console.log("Seed OK:", counts);
    console.log(`\nLogin demo:  ${DEMO_EMAIL}`);
    if (process.env.SEED_DEMO_PASSWORD) console.log("Contraseña:  la de SEED_DEMO_PASSWORD");
    else console.log(`Contraseña:  ${password}   (generada; guardala, no se vuelve a mostrar)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
