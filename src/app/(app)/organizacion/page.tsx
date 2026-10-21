import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { InviteMembers } from "@/components/organization/invite-members";
import { MembersList } from "@/components/organization/members-list";
import Link from "next/link";
import { PLAN_DEFINITIONS } from "@/lib/plans";
import { organizationUsage } from "@/lib/data/plan-limits";
import { can, requirePageMember } from "@/lib/auth/session";
import { getDb, invitaciones, rolesUsuario, usuarios } from "@/lib/db";

export default async function OrganizationPage() {
  const member = await requirePageMember();
  const db = getDb();
  const canManage = can(member, "organization:manage");

  const usage = await organizationUsage(db, member.organizacionId);

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

        <Link
          href="/cuenta#plan"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-[13px] hover:border-primary/40"
        >
          <span className="rounded-full border border-primary/40 bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
            {PLAN_DEFINITIONS[member.plan].name}
          </span>
          <span className="flex-1 text-muted-foreground">
            {usage.nodes} / {PLAN_DEFINITIONS[member.plan].maxNodes} nodos · {usage.scenarios} / {PLAN_DEFINITIONS[member.plan].maxScenarios} escenarios
            guardados
          </span>
          <span className="text-primary">Ver o cambiar de plan →</span>
        </Link>

        <MembersList members={members} selfId={member.id} canManage={canManage} />

        {canManage ? (
          <InviteMembers
            pending={pending.map((p) => ({ ...p, expiraEn: p.expiraEn.toISOString() }))}
          />
        ) : (
          <p className="rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">
            Solo los administradores pueden invitar a otras personas y gestionar sus roles.
          </p>
        )}
      </div>
    </div>
  );
}
