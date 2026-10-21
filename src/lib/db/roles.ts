import { inArray } from "drizzle-orm";
import type { Database } from "./index";
import { rolesUsuario } from "./schema";

// Catálogo de roles del modelo (RolUsuario). El significado de cada permiso lo define la app.
export const ROLE_DEFINITIONS = {
  admin: {
    nombre: "Administrador",
    permisos: ["organization:manage", "chain:read", "chain:write", "scenario:read", "scenario:run"],
  },
  // Consulta la red, simula y ve resultados y alertas; no modifica la estructura de la red ni gestiona usuarios.
  operator: {
    nombre: "Operador",
    permisos: ["chain:read", "scenario:read", "scenario:run"],
  },
} as const;

export type RoleKey = keyof typeof ROLE_DEFINITIONS;

/**
 * Garantiza que los roles existan y devuelve sus ids. Es idempotente y se llama desde el registro,
 * así la app no depende de haber corrido el seed para poder crear la primera organización.
 */
export async function ensureRoles(db: Database): Promise<Record<RoleKey, string>> {
  const definitions = Object.values(ROLE_DEFINITIONS);
  await db
    .insert(rolesUsuario)
    .values(definitions.map((r) => ({ nombre: r.nombre, permisos: [...r.permisos] })))
    .onConflictDoNothing({ target: rolesUsuario.nombre });

  const rows = await db
    .select()
    .from(rolesUsuario)
    .where(inArray(rolesUsuario.nombre, definitions.map((r) => r.nombre)));

  const byName = new Map(rows.map((r) => [r.nombre, r.id]));
  return {
    admin: byName.get(ROLE_DEFINITIONS.admin.nombre)!,
    operator: byName.get(ROLE_DEFINITIONS.operator.nombre)!,
  };
}
