// Edición del perfil propio: cualquier usuario con sesión puede cambiar su nombre (no hace falta una organización).
// El email no se edita: es la identidad de la cuenta y todavía no se verifica, así que cambiarlo abriría una vía para
// pasar por otra persona.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/api/http";
import { requireApiUser } from "@/lib/auth/session";
import { getDb, usuarios } from "@/lib/db";
import { updateProfileSchema } from "@/lib/validators/account";

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
