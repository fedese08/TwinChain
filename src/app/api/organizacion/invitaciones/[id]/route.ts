import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireApiMember } from "@/lib/auth/session";
import { getDb, invitaciones } from "@/lib/db";

/** Revoca una invitación pendiente: su link deja de funcionar. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;
  const { id } = await params;

  // El filtro por organización es lo que impide revocar invitaciones de otra organización.
  const deleted = await getDb()
    .delete(invitaciones)
    .where(
      and(
        eq(invitaciones.id, id),
        eq(invitaciones.organizacionId, access.user.organizacionId),
        isNull(invitaciones.aceptadaEn),
      ),
    )
    .returning({ id: invitaciones.id });

  if (deleted.length === 0) return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
