// Topes del plan de la organización, validados en el SERVIDOR (la interfaz solo los anticipa).
//
// Todo se mide por organización, con el `organizacionId` de la sesión: nunca uno que venga del body o la URL.
// Los topes se verifican dos veces: antes de hacer trabajo caro (la corrida de la simulación, la llamada al modelo
// de ML) y de nuevo dentro de la transacción, con un candado por organización, para que dos pedidos simultáneos no
// se pasen del tope.
import { count, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Member } from "@/lib/auth/session";
import { cadenas, escenarios, nodos, type Database } from "@/lib/db";
import { fitsPlan, MAX_CHAINS_PER_ORGANIZATION, planLimitMessage, type PlanId, type PlanLimitKind, type Usage } from "@/lib/plans";

type Executor = Pick<Database, "select" | "execute">;

/** Se alcanzó un tope del plan. Las rutas lo traducen a un 409 con un mensaje claro. */
export class PlanLimitError extends Error {
  constructor(
    readonly kind: PlanLimitKind,
    message: string,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/** 409 con el código `plan_limit` (el cliente lo distingue de un conflicto cualquiera). */
export function planLimitResponse(error: PlanLimitError) {
  return NextResponse.json({ error: error.message, code: "plan_limit", limit: error.kind }, { status: 409 });
}

/** Cadenas, nodos y escenarios guardados de TODA la organización. */
export async function organizationUsage(db: Executor, organizationId: string): Promise<Usage> {
  const [[c], [n], [e]] = await Promise.all([
    db.select({ total: count() }).from(cadenas).where(eq(cadenas.organizacionId, organizationId)),
    db
      .select({ total: count() })
      .from(nodos)
      .innerJoin(cadenas, eq(nodos.cadenaId, cadenas.id))
      .where(eq(cadenas.organizacionId, organizationId)),
    db
      .select({ total: count() })
      .from(escenarios)
      .innerJoin(cadenas, eq(escenarios.cadenaId, cadenas.id))
      .where(eq(cadenas.organizacionId, organizationId)),
  ]);
  return { chains: c.total, nodes: n.total, scenarios: e.total };
}

/** Candado de la organización hasta el final de la transacción: serializa los pedidos que cambian lo que se cuenta. */
export async function lockOrganization(tx: Executor, organizationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);
}

/** Lanza `PlanLimitError` si agregar `adding` nodos (de una plantilla o uno suelto) excede el plan. */
export async function assertNodeCapacity(db: Executor, member: Pick<Member, "organizacionId" | "plan">, adding = 1): Promise<void> {
  const usage = await organizationUsage(db, member.organizacionId);
  if (!fitsPlan(member.plan, "nodes", usage, adding)) {
    throw new PlanLimitError("nodes", planLimitMessage(member.plan, "nodes", usage, adding));
  }
}

export async function assertScenarioCapacity(db: Executor, member: Pick<Member, "organizacionId" | "plan">): Promise<void> {
  const usage = await organizationUsage(db, member.organizacionId);
  if (!fitsPlan(member.plan, "scenarios", usage)) {
    throw new PlanLimitError("scenarios", planLimitMessage(member.plan, "scenarios", usage));
  }
}

/** Una cadena nueva: respeta el límite de una por organización y que los nodos de su plantilla entren en el plan. */
export async function assertChainCapacity(
  db: Executor,
  member: Pick<Member, "organizacionId" | "plan">,
  templateNodes: number,
): Promise<void> {
  const usage = await organizationUsage(db, member.organizacionId);
  if (usage.chains >= MAX_CHAINS_PER_ORGANIZATION) throw new PlanLimitError("chains", planLimitMessage(member.plan, "chains", usage));
  if (templateNodes > 0 && !fitsPlan(member.plan, "nodes", usage, templateNodes)) {
    throw new PlanLimitError("nodes", planLimitMessage(member.plan, "nodes", usage, templateNodes));
  }
}

export type { PlanId };
