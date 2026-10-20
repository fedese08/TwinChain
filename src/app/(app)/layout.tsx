import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageMember } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";

// Todo lo que vive bajo (app) exige sesión y pertenecer a una organización. Los datos se leen de
// la base en cada request, así un cambio de rol, de organización o de datos se ve al instante.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requirePageMember();
  const snapshot = await loadSnapshot(member);

  return (
    <AppShell
      snapshot={snapshot}
      account={{
        userName: member.nombre,
        userEmail: member.email,
        organizationName: member.organizacionNombre,
        roleName: member.rolNombre,
      }}
    >
      {children}
    </AppShell>
  );
}
