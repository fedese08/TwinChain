import { redirect } from "next/navigation";
import { PasteInviteLink } from "@/components/auth/paste-invite-link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { isMember, requirePageUser } from "@/lib/auth/session";

export default async function WithoutOrganizationPage() {
  const user = await requirePageUser();
  if (isMember(user)) redirect("/cadenas");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-tight">Hola, {user.nombre.split(" ")[0]}</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Tu cuenta ya está lista, pero todavía no pertenecés a ninguna organización. Pedile a un administrador de tu
          organización que te invite con <span className="font-medium text-foreground">{user.email}</span> y abrí el
          link que te pase.
        </p>
      </div>
      <PasteInviteLink />
      <div className="border-t border-border pt-4">
        <SignOutButton />
      </div>
    </div>
  );
}
