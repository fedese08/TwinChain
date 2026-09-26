import Link from "next/link";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AcceptInviteButton } from "@/components/auth/accept-invite-button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getCurrentUser } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { buttonVariants } from "@/components/ui/button";
import { getDb, invitaciones, organizaciones, rolesUsuario } from "@/lib/db";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken);

  const [invitation] = await getDb()
    .select({
      email: invitaciones.email,
      organizacion: organizaciones.nombre,
      rol: rolesUsuario.nombre,
    })
    .from(invitaciones)
    .innerJoin(organizaciones, eq(invitaciones.organizacionId, organizaciones.id))
    .innerJoin(rolesUsuario, eq(invitaciones.rolId, rolesUsuario.id))
    .where(
      and(
        eq(invitaciones.tokenHash, hashToken(token)),
        isNull(invitaciones.aceptadaEn),
        gt(invitaciones.expiraEn, new Date()),
      ),
    )
    .limit(1);

  if (!invitation) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[22px] font-bold tracking-tight">Invitación no válida</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Este link no existe, ya se usó o venció. Pedile a un administrador de la organización que te envíe uno nuevo.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-1 h-9" })}>
          Volver al inicio
        </Link>
      </div>
    );
  }

  const user = await getCurrentUser();
  const nextParam = encodeURIComponent(`/invitacion/${rawToken}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-tight">Te invitaron a {invitation.organizacion}</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Vas a sumarte con el rol de <span className="font-medium text-foreground">{invitation.rol}</span>. La
          invitación es para <span className="font-medium text-foreground">{invitation.email}</span>.
        </p>
      </div>

      {!user && (
        <div className="flex flex-col gap-2">
          <Link
            href={`/registro?next=${nextParam}&email=${encodeURIComponent(invitation.email)}`}
            className={buttonVariants({ size: "lg", className: "h-10" })}
          >
            Crear cuenta y unirme
          </Link>
          <Link href={`/login?next=${nextParam}`} className={buttonVariants({ variant: "outline", size: "lg", className: "h-10" })}>
            Ya tengo cuenta
          </Link>
        </div>
      )}

      {user?.organizacionId && (
        <p className="rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
          Ya pertenecés a una organización, así que no podés aceptar esta invitación con tu cuenta actual.
        </p>
      )}

      {user && !user.organizacionId && user.email.toLowerCase() !== invitation.email.toLowerCase() && (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Iniciaste sesión como <span className="font-medium text-foreground">{user.email}</span>, pero la invitación
            es para <span className="font-medium text-foreground">{invitation.email}</span>. Cerrá sesión e ingresá con
            ese email.
          </p>
          <SignOutButton />
        </div>
      )}

      {user && !user.organizacionId && user.email.toLowerCase() === invitation.email.toLowerCase() && (
        <AcceptInviteButton token={token} organizationName={invitation.organizacion} />
      )}
    </div>
  );
}
