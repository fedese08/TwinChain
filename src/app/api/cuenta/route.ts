// Perfil propio: cualquier usuario con sesión puede cambiar su nombre o eliminar su cuenta (no hace falta una organización).
// El email no se edita: es la identidad de la cuenta y todavía no se verifica, así que cambiarlo abriría una vía para
// pasar por otra persona.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/api/http";
import { requireApiUser } from "@/lib/auth/session";
import { deleteAccount } from "@/lib/data/account-deletion";
import { getDb, usuarios } from "@/lib/db";
import { deleteAccountSchema, updateProfileSchema } from "@/lib/validators/account";

export async function PATCH(request: Request) {
  const access = await requireApiUser();
  if (!access.ok) return access.response;

  const body = await readJson(request, updateProfileSchema);
  if (!body.ok) return body.response;

  // El id sale de la sesión, nunca del body.
  const [row] = await getDb()
    .update(usuarios)
    .set({ nombre: body.data.nombre })
    .where(eq(usuarios.id, access.user.id))
    .returning({ nombre: usuarios.nombre });
  return NextResponse.json({ nombre: row.nombre });
}

/**
 * Elimina la cuenta propia y los datos personales asociados. Exige la contraseña actual. El id sale de la sesión,
 * nunca del body. Qué más se borra depende de la organización: ver `lib/data/account-deletion.ts`.
 */
export async function DELETE(request: Request) {
  const access = await requireApiUser();
  if (!access.ok) return access.response;

  const body = await readJson(request, deleteAccountSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const [account] = await db.select({ contrasena: usuarios.contrasena }).from(usuarios).where(eq(usuarios.id, access.user.id));
  if (account?.contrasena) {
    const valid = body.data.contrasena ? await bcrypt.compare(body.data.contrasena, account.contrasena) : false;
    if (!valid) {
      return NextResponse.json({ error: "La contraseña no es correcta.", fields: { contrasena: ["Contraseña incorrecta"] } }, { status: 400 });
    }
  }

  const result = await deleteAccount(db, access.user);
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 409 });
  return NextResponse.json({ ok: true, organizationDeleted: result.organizationDeleted });
}
