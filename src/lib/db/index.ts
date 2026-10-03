import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

// Next.js recarga módulos en dev (HMR): cachear el cliente en `globalThis` evita abrir un pool
// nuevo por cada recarga y agotar las conexiones de Neon.
const globalForDb = globalThis as unknown as { twinchainDb?: Database };

/**
 * Cliente de Drizzle sobre el endpoint **pooled** de Neon (`DATABASE_URL`). Se crea recién al
 * primer uso, así importar este módulo (por ejemplo durante `next build`) no exige la variable.
 *
 * `prepare: false` es obligatorio: el pooler de Neon corre PgBouncer en modo transaction y no
 * soporta prepared statements. Las migraciones NO pasan por acá: usan `DIRECT_URL`.
 */
export function getDb(): Database {
  if (globalForDb.twinchainDb) return globalForDb.twinchainDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Falta DATABASE_URL. Copiá .env.example a .env.local y completá la connection string de Neon.");
  }

  const client = postgres(url, {
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 1 : 5,
    idle_timeout: 20,
  });
  const db = drizzle(client, { schema });

  if (process.env.NODE_ENV !== "production") globalForDb.twinchainDb = db;
  return db;
}

export * from "./schema";
