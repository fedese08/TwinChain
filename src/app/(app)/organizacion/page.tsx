import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { InviteMembers } from "@/components/organization/invite-members";
import { PlanManager } from "@/components/organization/plan-manager";
import { organizationUsage } from "@/lib/data/plan-limits";
import { can, requirePageMember } from "@/lib/auth/session";
import { getDb, invitaciones, organizaciones, rolesUsuario, usuarios } from "@/lib/db";

export default async function OrganizationPage() {
  const member = await requirePageMember();
  const db = getDb();
  const canManage = can(member, "organization:manage");

  const [[org], usage] = await Promise.all([
    db.select({ planDesde: organizaciones.planDesde }).from(organizaciones).where(eq(organizaciones.id, member.organizacionId)),
    organizationUsage(db, member.organizacionId),
  ]);

  const members = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email, rol: rolesUsuario.nombre })
    .from(usuarios)
    .innerJoin(rolesUsuario, eq(usuarios.rolId, rolesUsuario.id))
    .where(eq(usuarios.organizacionId, member.organizacionId))
    .orderBy(asc(usuarios.creadoEn));

  const pending = canManage
    ? await db
        .select({
          id: invitaciones.id,
          email: invitaciones.email,
          rol: rolesUsuario.nombre,
          expiraEn: invitaciones.expiraEn,
        })
        .from(invitaciones)
        .innerJoin(rolesUsuario, eq(invitaciones.rolId, rolesUsuario.id))
        .where(
          and(
            eq(invitaciones.organizacionId, member.organizacionId),
            isNull(invitaciones.aceptadaEn),
            gt(invitaciones.expiraEn, new Date()),
          ),
        )
        .orderBy(desc(invitaciones.creadoEn))
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">{member.organizacionNombre}</div>
          <div className="text-[12.5px] text-muted-foreground">
            {members.length} {members.length === 1 ? "miembro" : "miembros"}
          </div>
        </div>

        <PlanManager plan={member.plan} since={org.planDesde.toISOString()} usage={usage} canManage={canManage} />

        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                {m.nombre
                  .split(" ")
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {m.nombre}
                  {m.id === member.id && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(vos)</span>}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">{m.email}</div>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {m.rol}
              </span>
            </div>
          ))}
        </div>

        {canManage ? (
          <InviteMembers
            pending={pending.map((p) => ({ ...p, expiraEn: p.expiraEn.toISOString() }))}
          />
        ) : (
          <p className="rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">
            Solo los administradores pueden invitar a otras personas.
          </p>
        )}
      </div>
    </div>
  );
}
