import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next, email } = await searchParams;
  const destination = safeNext(next);

  if (await getCurrentUser()) redirect(destination);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-tight">Crear cuenta</h1>
        <p className="text-[13px] text-muted-foreground">Elegí cómo vas a usar TwinChain.</p>
      </div>
      <RegisterForm next={destination} invitedEmail={email} />
      <p className="text-center text-[12.5px] text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link
          href={destination === "/cadenas" ? "/login" : `/login?next=${encodeURIComponent(destination)}`}
          className="font-medium text-primary hover:underline"
        >
          Iniciá sesión
        </Link>
      </p>
    </div>
  );
}
