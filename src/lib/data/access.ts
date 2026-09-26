import { and, eq, or, type SQL } from "drizzle-orm";
import type { Member } from "@/lib/auth/session";
import { aristas, cadenas, nodos, type Database } from "@/lib/db";

/**
 * Cadenas que el miembro puede ver: las de su organización que son compartidas, más las privadas
 * que creó él. ESTA es la condición de aislamiento multi-tenant: toda query que llegue a una
 * cadena, un nodo o una arista pasa por acá. El `organizacionId` sale de la sesión, nunca del request.
 */
export function chainVisibleTo(member: Member): SQL {
  return and(
    eq(cadenas.organizacionId, member.organizacionId),
    or(eq(cadenas.visibilidad, "shared"), eq(cadenas.creadaPor, member.id)),
  ) as SQL;
}

export async function findVisibleChain(db: Database, member: Member, chainId: string) {
  const [chain] = await db
    .select()
    .from(cadenas)
    .where(and(eq(cadenas.id, chainId), chainVisibleTo(member)))
    .limit(1);
  return chain ?? null;
}

export async function findVisibleNode(db: Database, member: Member, nodeId: string) {
  const [row] = await db
    .select({ nodo: nodos, cadena: cadenas })
    .from(nodos)
    .innerJoin(cadenas, eq(nodos.cadenaId, cadenas.id))
    .where(and(eq(nodos.id, nodeId), chainVisibleTo(member)))
    .limit(1);
  return row ?? null;
}

export async function findVisibleEdge(db: Database, member: Member, edgeId: string) {
  const [row] = await db
    .select({ arista: aristas, cadena: cadenas })
    .from(aristas)
    .innerJoin(nodos, eq(aristas.nodoOrigenId, nodos.id))
    .innerJoin(cadenas, eq(nodos.cadenaId, cadenas.id))
    .where(and(eq(aristas.id, edgeId), chainVisibleTo(member)))
    .limit(1);
  return row ?? null;
}
