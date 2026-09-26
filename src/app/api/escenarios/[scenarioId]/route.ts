import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isUuid, notFound } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleScenario } from "@/lib/data/access";
import { escenarios, getDb } from "@/lib/db";

/**
 * Elimina el escenario con sus eventos y TODAS sus corridas (ON DELETE CASCADE). No se puede
 * deshacer: la UI pide confirmación. Exige el mismo permiso que crearlo (`scenario:run`).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ scenarioId: string }> }) {
  const access = await requireApiMember("scenario:run");
  if (!access.ok) return access.response;
  const { scenarioId } = await params;
  if (!isUuid(scenarioId)) return notFound("Escenario no encontrado");

  const db = getDb();
  if (!(await findVisibleScenario(db, access.user, scenarioId))) return notFound("Escenario no encontrado");

  await db.delete(escenarios).where(eq(escenarios.id, scenarioId));
  return NextResponse.json({ ok: true });
}
