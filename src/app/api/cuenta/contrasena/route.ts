// Cambio de contraseña propia: exige la actual. Las cuentas sin contraseña (inicio con Google, cuando se sume) no
// pueden cambiarla por acá.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/api/http";
import { requireApiUser } from "@/lib/auth/session";
import { getDb, usuarios } from "@/lib/db";
import { changePasswordSchema } from "@/lib/validators/account";

export async function PUT(request: Request) {
  const access = await requireApiUser();
  if (!access.ok) return access.response;

  const body = await readJson(request, changePasswordSchema);
  if (!body.ok) return body.response;
  const { actual, nueva } = body.data;

  const db = getDb();
  const [user] = await db.select({ contrasena: usuarios.contrasena }).from(usuarios).where(eq(usuarios.id, access.user.id));
  if (!user?.contrasena) {
    return NextResponse.json({ error: "Esta cuenta no tiene contraseña propia." }, { status: 400 });
  }
  if (!(await bcrypt.compare(actual, user.contrasena))) {
    return NextResponse.json({ error: "La contraseña actual no es correcta.", fields: { actual: ["Contraseña incorrecta"] } }, { status: 400 });
  }

  await db.update(usuarios).set({ contrasena: await bcrypt.hash(nueva, 12) }).where(eq(usuarios.id, access.user.id));
  return NextResponse.json({ ok: true });
}
