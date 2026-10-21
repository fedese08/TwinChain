// Eliminación de la cuenta propia y de los datos personales asociados (supresión, art. 6 de la Ley 25.326).
//
// Qué se borra depende de qué más depende de la cuenta:
//   - Sin organización (invitación pendiente de aceptar): se borra la cuenta y nada más.
//   - Única persona de su organización: se borra también la organización con todo lo suyo (cadenas, nodos,
//     historial, simulaciones, invitaciones). No queda nadie a quien pertenezca.
//   - Con otras personas en la organización: se borra la cuenta y las cadenas PRIVADAS que creó (eran solo suyas). Lo
//     que es de la organización (cadenas compartidas, simulaciones, invitaciones enviadas) pasa a otra persona
//     administradora, porque esos datos no son personales de quien se va.
//   - Única persona administradora de una organización con más gente: no puede irse, porque dejaría la organización sin
//     nadie que la administre. Antes tiene que hacer administradora a otra persona (o quitar a las demás) desde la
//     pantalla de la organización.
import { and, eq, ne, asc } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { lockOrganization } from "@/lib/data/plan-limits";
import { cadenas, escenarios, invitaciones, organizaciones, rolesUsuario, usuarios, type Database } from "@/lib/db";
import { ROLE_DEFINITIONS } from "@/lib/db/roles";

export type DeleteAccountResult =
  | { ok: true; organizationDeleted: boolean }
  | { ok: false; code: "last_admin_with_members"; message: string };

/** Quiénes más hay en la organización y si alguna otra persona puede hacerse cargo de lo que queda. */
export async function accountDeletionContext(db: Pick<Database, "select">, user: Pick<CurrentUser, "id" | "organizacionId">) {
  if (!user.organizacionId) return { otherMembers: 0, heirId: null as string | null };
  const others = await db
    .select({ id: usuarios.id, rol: rolesUsuario.nombre })
    .from(usuarios)
    .innerJoin(rolesUsuario, eq(usuarios.rolId, rolesUsuario.id))
    .where(and(eq(usuarios.organizacionId, user.organizacionId), ne(usuarios.id, user.id)))
    .orderBy(asc(usuarios.creadoEn));
  const heir = others.find((m) => m.rol === ROLE_DEFINITIONS.admin.nombre);
  return { otherMembers: others.length, heirId: heir?.id ?? null };
}

export async function deleteAccount(db: Database, user: CurrentUser): Promise<DeleteAccountResult> {
  return db.transaction(async (tx) => {
    const organizationId = user.organizacionId;

    if (!organizationId) {
      await tx.delete(usuarios).where(eq(usuarios.id, user.id));
      return { ok: true, organizationDeleted: false };
    }

    // Serializa con cualquier otro cambio de la organización (plan, altas de nodos y escenarios) hasta el final.
    await lockOrganization(tx, organizationId);
    const { otherMembers, heirId } = await accountDeletionContext(tx, user);

    if (otherMembers === 0) {
      // Las cadenas se llevan nodos, aristas, historial, escenarios y resultados (cascade); las invitaciones se van con la organización.
      await tx.delete(cadenas).where(eq(cadenas.organizacionId, organizationId));
      await tx.delete(usuarios).where(eq(usuarios.id, user.id));
      await tx.delete(organizaciones).where(eq(organizaciones.id, organizationId));
      return { ok: true, organizationDeleted: true };
    }

    if (!heirId) {
      return {
        ok: false,
        code: "last_admin_with_members",
        message:
          "Sos la única persona administradora y la organización tiene más integrantes. Antes de irte, hacé administradora a otra persona desde la pantalla de la organización (o quitá a las demás), porque nadie más podría administrarla.",
      };
    }

    // Lo que era solo de esta persona se borra; lo que es de la organización pasa a quien administra.
    await tx.delete(cadenas).where(and(eq(cadenas.creadaPor, user.id), eq(cadenas.visibilidad, "private")));
    await tx.update(cadenas).set({ creadaPor: heirId }).where(eq(cadenas.creadaPor, user.id));
    await tx.update(escenarios).set({ usuarioId: heirId }).where(eq(escenarios.usuarioId, user.id));
    await tx.update(invitaciones).set({ invitadaPor: heirId }).where(eq(invitaciones.invitadaPor, user.id));
    await tx.delete(usuarios).where(eq(usuarios.id, user.id));
    return { ok: true, organizationDeleted: false };
  });
}
