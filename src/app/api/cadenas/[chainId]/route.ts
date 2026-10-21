import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { cadenas, getDb } from "@/lib/db";
import { patchChainSchema } from "@/lib/validators/chain-api";

/**
 * Elimina la cadena y TODO lo que cuelga de ella (nodos, aristas, desempeño semanal, escenarios,
 * eventos y corridas) por ON DELETE CASCADE. No se puede deshacer: la UI pide confirmación.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  await db.delete(cadenas).where(eq(cadenas.id, chainId));
  return NextResponse.json({ ok: true });
}

/** Ajusta la cadena: el costo de una falsa alarma, que define el umbral del CUSUM de todos sus nodos. */
export async function PATCH(request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const body = await readJson(request, patchChainSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const [row] = await db
    .update(cadenas)
    .set({ costoFalsaAlarma: body.data.costoFalsaAlarma })
    .where(eq(cadenas.id, chainId))
    .returning({ costoFalsaAlarma: cadenas.costoFalsaAlarma });
  return NextResponse.json({ costoFalsaAlarma: row.costoFalsaAlarma });
}

