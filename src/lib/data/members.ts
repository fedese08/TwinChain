// Gestión de integrantes de la organización (E90, caso de uso del Administrador: gestionar usuarios y sus roles).
//
// Las reglas viven en una función pura (`checkMemberChange`) para poder probarlas sin base. Todo se resuelve dentro de la
// organización de quien actúa: nunca con una organización que venga en el pedido.
import { and, eq } from "drizzle-orm";
import { lockOrganization } from "@/lib/data/plan-limits";
import { cadenas, escenarios, invitaciones, usuarios, type Database } from "@/lib/db";

export type MemberChange = { type: "role"; roleId: string } | { type: "remove" };

export type MemberChangeCheck = { ok: true } | { ok: false; status: 404 | 409; code: "not_found" | "self"; message: string };

/**
 * Qué puede hacer una administradora sobre otra persona de su organización. A sí misma no: para irse está "Eliminar
 * cuenta", que además resuelve qué pasa con sus datos. Como quien actúa es administradora y no se toca a sí misma, la
 * organización nunca se queda sin quien la administre.
 */
export function checkMemberChange(
  memberIds: readonly string[],
  actorId: string,
  targetId: string,
  change: MemberChange["type"],
): MemberChangeCheck {
  if (!memberIds.includes(targetId)) return { ok: false, status: 404, code: "not_found", message: "Integrante no encontrado" };
  if (targetId === actorId) {
    return {
      ok: false,
      status: 409,
      code: "self",
      message:
        change === "remove"
          ? "No podés quitarte a vos mismo. Para irte, eliminá tu cuenta desde Mi cuenta."
          : "No podés cambiar tu propio rol. Pedile a otra persona administradora que lo haga.",
    };
  }
  return { ok: true };
}

export async function changeMemberRole(db: Database, organizationId: string, actorId: string, targetId: string, roleId: string) {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const members = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.organizacionId, organizationId));
    const check = checkMemberChange(members.map((m) => m.id), actorId, targetId, "role");
    if (!check.ok) return check;
    await tx.update(usuarios).set({ rolId: roleId }).where(and(eq(usuarios.id, targetId), eq(usuarios.organizacionId, organizationId)));
    return check;
  });
}

/**
 * Saca a una persona de la organización (su cuenta sigue existiendo, sin organización). Lo que era solo de ella, sus
 * cadenas privadas, se elimina; lo que es de la organización (cadenas compartidas, simulaciones, invitaciones enviadas)
 * pasa a quien la quita, igual que cuando alguien elimina su cuenta.
 */
export async function removeMember(db: Database, organizationId: string, actorId: string, targetId: string) {
  return db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const members = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.organizacionId, organizationId));
    const check = checkMemberChange(members.map((m) => m.id), actorId, targetId, "remove");
    if (!check.ok) return check;

    await tx.delete(cadenas).where(and(eq(cadenas.organizacionId, organizationId), eq(cadenas.creadaPor, targetId), eq(cadenas.visibilidad, "private")));
    await tx.update(cadenas).set({ creadaPor: actorId }).where(and(eq(cadenas.organizacionId, organizationId), eq(cadenas.creadaPor, targetId)));
    await tx.update(escenarios).set({ usuarioId: actorId }).where(eq(escenarios.usuarioId, targetId));
    await tx.update(invitaciones).set({ invitadaPor: actorId }).where(eq(invitaciones.invitadaPor, targetId));
    await tx.update(usuarios).set({ rolId: null, organizacionId: null }).where(eq(usuarios.id, targetId));
    return check;
  });
}
