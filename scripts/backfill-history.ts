/**
 * Carga el historial de desempeño de los nodos que todavía no tienen ninguno (cadenas creadas antes de
 * que existiera el pipeline de ingesta). Es idempotente: los nodos que ya tienen historial no se tocan.
 *
 *   npx tsx scripts/backfill-history.ts                 # simulacro: solo cuenta, NO escribe
 *   npx tsx scripts/backfill-history.ts --apply         # escribe
 *   npx tsx scripts/backfill-history.ts --apply --chain <uuid>
 *
 * Usa DIRECT_URL (o DATABASE_URL). OJO: apunta a la base que diga el entorno; si .env.local apunta a
 * producción, `--apply` escribe en producción.
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, notExists } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

loadEnvConfig(process.cwd());

import * as schema from "../src/lib/db/schema";
import { ingestChainHistory } from "../src/lib/ingestion/ingest-history";
import { prepareSensorBaselines, prepareVendedorPlans } from "../src/lib/ingestion/vendedor-setup";
import { chainLatestWeek } from "../src/lib/ingestion/ingest-history";
import { lastCompleteWeek } from "../src/lib/domain/synthetic";
import type { NodeType } from "../src/lib/domain/types";

async function main() {
  const apply = process.argv.includes("--apply");
  const chainFlag = process.argv.indexOf("--chain");
  const onlyChain = chainFlag !== -1 ? process.argv[chainFlag + 1] : null;

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DIRECT_URL (o DATABASE_URL)");
  const host = new URL(url).host;
  console.log(`Base: ${host} · modo: ${apply ? "ESCRIBE (--apply)" : "simulacro (no escribe)"}`);

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const pending = await db
      .select({ chainId: schema.nodos.cadenaId, nodeId: schema.nodos.id, tipo: schema.nodos.tipo })
      .from(schema.nodos)
      .where(
        notExists(db.select({ one: schema.desempenoSemanal.id }).from(schema.desempenoSemanal).where(eq(schema.desempenoSemanal.nodoId, schema.nodos.id))),
      );

    const byChain = new Map<string, number>();
    const vendedoresByChain = new Map<string, string[]>();
    for (const row of pending) {
      if (onlyChain && row.chainId !== onlyChain) continue;
      byChain.set(row.chainId, (byChain.get(row.chainId) ?? 0) + 1);
      if (row.tipo === "Vendedor") vendedoresByChain.set(row.chainId, [...(vendedoresByChain.get(row.chainId) ?? []), row.nodeId]);
    }
    if (byChain.size === 0) {
      console.log("No hay nodos sin historial. Nada para hacer.");
      return;
    }

    for (const [chainId, nodeCount] of byChain) {
      if (!apply) {
        console.log(`  cadena ${chainId}: ${nodeCount} nodos sin historial`);
        continue;
      }
      // Los Vendedores usan vendedores reales de Olist y la línea base del modelo de ML: se preparan ANTES de la
      // transacción (no se la deja abierta esperando la red) y evitan los que la cadena ya usa.
      const used = await db
        .select({ id: schema.nodos.vendedorOlistId })
        .from(schema.nodos)
        .where(eq(schema.nodos.cadenaId, chainId));
      const vendedorPlans = await prepareVendedorPlans(
        vendedoresByChain.get(chainId) ?? [],
        new Set(used.flatMap((u) => (u.id ? [u.id] : []))),
      );
      // Los demás nodos: línea base del modelo de ML con las primeras semanas de su sensor simulado.
      const endWeek = (await chainLatestWeek(db, chainId)) ?? lastCompleteWeek();
      const pending = await db
        .select({ id: schema.nodos.id, tipo: schema.nodos.tipo })
        .from(schema.nodos)
        .where(
          and(
            eq(schema.nodos.cadenaId, chainId),
            notExists(db.select({ one: schema.desempenoSemanal.id }).from(schema.desempenoSemanal).where(eq(schema.desempenoSemanal.nodoId, schema.nodos.id))),
          ),
        );
      const baselines = await prepareSensorBaselines(
        pending.filter((n) => !vendedorPlans.has(n.id)).map((n) => ({ id: n.id, tipo: n.tipo as NodeType })),
        endWeek,
      );
      const result = await db.transaction((tx) => ingestChainHistory(tx, chainId, { vendedorPlans, baselines, endWeek }));
      console.log(
        `  cadena ${chainId}: ${nodeCount} nodos · ${result.weeklyPerformance.length} filas · estabilidad: ${result.stability?.status ?? "sin datos"}`,
      );
    }
    if (!apply) console.log("\nSimulacro terminado. Para escribir: agregá --apply.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
