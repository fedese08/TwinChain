import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireApiMember } from "@/lib/auth/session";
import { generateInviteToken, INVITE_TTL_MS } from "@/lib/auth/tokens";
import { getDb, invitaciones, rolesUsuario, usuarios } from "@/lib/db";
import { ensureRoles } from "@/lib/db/roles";
import { inviteSchema } from "@/lib/validators/auth";

/** Invitaciones pendientes (no aceptadas ni vencidas) de la organización del usuario. */
export async function GET() {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;

  const rows = await getDb()
    .select({
      id: invitaciones.id,
      email: invitaciones.email,
      rol: rolesUsuario.nombre,
      expiraEn: invitaciones.expiraEn,
      creadoEn: invitaciones.creadoEn,
    })
    .from(invitaciones)
    .innerJoin(rolesUsuario, eq(invitaciones.rolId, rolesUsuario.id))
    .where(
      and(
        eq(invitaciones.organizacionId, access.user.organizacionId),
        isNull(invitaciones.aceptadaEn),
        gt(invitaciones.expiraEn, new Date()),
      ),
    )
    .orderBy(desc(invitaciones.creadoEn));

  return NextResponse.json({ invitaciones: rows });
}

/**
 * Crea una invitación y devuelve el link. Todavía no hay proveedor de email: el administrador
 * copia el link y se lo pasa a la persona. Es la única vez que el token viaja en claro.
 */
export async function POST(request: Request) {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;
  const { user } = access;

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", fields: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { email, rol } = parsed.data;

  const db = getDb();

  const [existingMember] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.organizacionId, user.organizacionId), sql`lower(${usuarios.email}) = ${email}`))
    .limit(1);
  if (existingMember) {
    return NextResponse.json({ error: "Esa persona ya es parte de la organización" }, { status: 409 });
  }

  const roles = await ensureRoles(db);
  const { token, hash } = generateInviteToken();
  const expiraEn = new Date(Date.now() + INVITE_TTL_MS);

  const invitacion = await db.transaction(async (tx) => {
    // Re-invitar al mismo email reemplaza la invitación pendiente anterior (su link deja de servir).
    await tx
      .delete(invitaciones)
      .where(
        and(
          eq(invitaciones.organizacionId, user.organizacionId),
          isNull(invitaciones.aceptadaEn),
          sql`lower(${invitaciones.email}) = ${email}`,
        ),
      );
    const [row] = await tx
      .insert(invitaciones)
      .values({
        organizacionId: user.organizacionId,
        email,
        rolId: roles[rol],
        invitadaPor: user.id,
        tokenHash: hash,
        expiraEn,
      })
      .returning({ id: invitaciones.id, email: invitaciones.email, expiraEn: invitaciones.expiraEn });
    return row;
  });

  const link = `${new URL(request.url).origin}/invitacion/${token}`;
  return NextResponse.json({ invitacion, link }, { status: 201 });
}
