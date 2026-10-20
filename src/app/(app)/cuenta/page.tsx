import { eq } from "drizzle-orm";
import { ProfileForm } from "@/components/account/profile-form";
import { PlanManager } from "@/components/organization/plan-manager";
import { can, requirePageMember } from "@/lib/auth/session";
import { accountDeletionContext } from "@/lib/data/account-deletion";
import { organizationUsage } from "@/lib/data/plan-limits";
import { getDb, organizaciones, usuarios } from "@/lib/db";

export default async function AccountPage() {
  const member = await requirePageMember();
  const db = getDb();

  const [[org], [account], usage, leaving] = await Promise.all([
    db.select({ planDesde: organizaciones.planDesde }).from(organizaciones).where(eq(organizaciones.id, member.organizacionId)),
    db.select({ contrasena: usuarios.contrasena }).from(usuarios).where(eq(usuarios.id, member.id)),
    organizationUsage(db, member.organizacionId),
    accountDeletionContext(db, member),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">Mi cuenta</div>
          <div className="text-[12.5px] text-muted-foreground">Tu perfil y el plan de {member.organizacionNombre}.</div>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Perfil</h2>
          <ProfileForm
            name={member.nombre}
            email={member.email}
            roleName={member.rolNombre}
            organization={member.organizacionNombre}
            hasPassword={Boolean(account?.contrasena)}
            otherMembers={leaving.otherMembers}
            canLeave={leaving.otherMembers === 0 || leaving.heirId !== null}
          />
        </section>

        <section id="plan" className="flex scroll-mt-6 flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Plan y suscripción</h2>
          <PlanManager
            plan={member.plan}
            since={org.planDesde.toISOString()}
            usage={usage}
            canManage={can(member, "organization:manage")}
          />
        </section>
      </div>
    </div>
  );
}
