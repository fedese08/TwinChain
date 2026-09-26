import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { requireApiUser } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { getDb, invitaciones, usuarios } from "@/lib/db";
import { acceptInviteSchema } from "@/lib/validators/auth";

const NOT_AVAILABLE = { error: "La invitación no existe, ya se usó o venció" };

/**
 * Une al usuario logueado a la organización que lo invitó. Exige DOS cosas: el token del link (lo
 * tiene quien recibió la invitación) y que el email de la cuenta coincida con el invitado. Como
 * todavía no se verifica el email al registrarse, el token es lo que prueba que se recibió el link.
 */
export async function POST(request: Request) {
  const access = await requireApiUser();
  if (!access.ok) return access.response;
  const { user } = access;

  const parsed = acceptInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invitación inválida" }, { status: 400 });

  if (user.organizacionId) {
    return NextResponse.json({ error: "Ya pertenecés a una organización" }, { status: 409 });
  }

  const db = getDb();
  const [invitacion] = await db
    .select()
    .from(invitaciones)
    .where(
      and(
        eq(invitaciones.tokenHash, hashToken(parsed.data.token)),
        isNull(invitaciones.aceptadaEn),
        gt(invitaciones.expiraEn, new Date()),
      ),
    )
    .limit(1);
  if (!invitacion) return NextResponse.json(NOT_AVAILABLE, { status: 404 });

  if (invitacion.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "Esta invitación es para otro email" }, { status: 403 });
  }

  const joined = await db.transaction(async (tx) => {
    // Marcarla aceptada con `aceptada_en IS NULL` en el WHERE es la reserva atómica: si dos
    // requests llegan a la vez, solo una obtiene la fila.
    const [claimed] = await tx
      .update(invitaciones)
      .set({ aceptadaEn: new Date() })
      .where(and(eq(invitaciones.id, invitacion.id), isNull(invitaciones.aceptadaEn)))
      .returning({ id: invitaciones.id });
    if (!claimed) return false;

    await tx
      .update(usuarios)
      .set({ rolId: invitacion.rolId, organizacionId: invitacion.organizacionId })
      .where(eq(usuarios.id, user.id));
    return true;
  });

  if (!joined) return NextResponse.json(NOT_AVAILABLE, { status: 404 });
  return NextResponse.json({ ok: true });
}
