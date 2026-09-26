import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/redirect";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (await getCurrentUser()) redirect(destination);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-tight">Iniciar sesión</h1>
        <p className="text-[13px] text-muted-foreground">Entrá para ver tus cadenas y simulaciones.</p>
      </div>
      <LoginForm next={destination} />
      <p className="text-center text-[12.5px] text-muted-foreground">
        ¿No tenés cuenta?{" "}
        <Link
          href={destination === "/cadenas" ? "/registro" : `/registro?next=${encodeURIComponent(destination)}`}
          className="font-medium text-primary hover:underline"
        >
          Registrate
        </Link>
      </p>
    </div>
  );
}
