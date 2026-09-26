import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requirePageMember } from "@/lib/auth/session";

// Todo lo que vive bajo (app) exige sesión y pertenecer a una organización. Los datos del usuario
// se leen de la base en cada request, así un cambio de rol o de organización se ve al instante.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requirePageMember();

  return (
    <AppShell
      account={{
        userName: member.nombre,
        organizationName: member.organizacionNombre,
        roleName: member.rolNombre,
      }}
    >
      {children}
    </AppShell>
  );
}
