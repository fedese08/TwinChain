import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, organizaciones, rolesUsuario, usuarios } from "@/lib/db";

export interface CurrentUser {
  id: string;
  nombre: string;
  email: string;
  organizacionId: string | null;
  organizacionNombre: string | null;
  rolId: string | null;
  rolNombre: string | null;
  permisos: string[];
}

/** Usuario que además pertenece a una organización (todo lo de negocio exige esto). */
export type Member = CurrentUser & {
  organizacionId: string;
  organizacionNombre: string;
  rolId: string;
  rolNombre: string;
};

/**
 * Usuario de la sesión, leído de la base (no del token) para que organización y rol estén siempre
 * al día. `cache` de React lo deduplica dentro de un mismo request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const [row] = await getDb()
    .select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      email: usuarios.email,
      organizacionId: usuarios.organizacionId,
      organizacionNombre: organizaciones.nombre,
      rolId: usuarios.rolId,
      rolNombre: rolesUsuario.nombre,
      permisos: rolesUsuario.permisos,
    })
    .from(usuarios)
    .leftJoin(organizaciones, eq(usuarios.organizacionId, organizaciones.id))
    .leftJoin(rolesUsuario, eq(usuarios.rolId, rolesUsuario.id))
    .where(eq(usuarios.id, id))
    .limit(1);

  if (!row) return null;
  return { ...row, permisos: row.permisos ?? [] };
});

export function isMember(user: CurrentUser): user is Member {
  return user.organizacionId !== null && user.rolId !== null;
}

export function can(user: CurrentUser, permission: string): boolean {
  return user.permisos.includes(permission);
}

// --- Para páginas y layouts (Server Components): redirigen ------------------------------

export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePageMember(): Promise<Member> {
  const user = await requirePageUser();
  if (!isMember(user)) redirect("/sin-organizacion");
  return user;
}

// --- Para API Routes: devuelven la respuesta de error lista para retornar -----------------

type ApiResult<T> = { ok: true; user: T } | { ok: false; response: NextResponse };

const unauthorized = () => NextResponse.json({ error: "Tenés que iniciar sesión" }, { status: 401 });
const forbidden = (message: string) => NextResponse.json({ error: message }, { status: 403 });

export async function requireApiUser(): Promise<ApiResult<CurrentUser>> {
  const user = await getCurrentUser();
  return user ? { ok: true, user } : { ok: false, response: unauthorized() };
}

/**
 * Miembro de una organización, opcionalmente con un permiso puntual. El `orgId` que devuelve es
 * el ÚNICO que las queries de negocio deben usar: nunca uno que venga en el body o la URL.
 */
export async function requireApiMember(permission?: string): Promise<ApiResult<Member>> {
  const result = await requireApiUser();
  if (!result.ok) return result;
  if (!isMember(result.user)) return { ok: false, response: forbidden("No pertenecés a ninguna organización") };
  if (permission && !can(result.user, permission)) {
    return { ok: false, response: forbidden("No tenés permiso para hacer esto") };
  }
  return { ok: true, user: result.user };
}
