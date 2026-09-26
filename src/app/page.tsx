import Image from "next/image";
import Link from "next/link";
import { Activity, Check, GitCompare, Waypoints } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { NetworkIllustration } from "@/components/landing/network-illustration";

const FEATURES = [
  {
    icon: Activity,
    title: "Monitoreo en tiempo real",
    description:
      "Cada nodo de tu cadena compara su desempeño real contra su línea base semana a semana, así detectás desvíos antes de que se conviertan en un problema.",
  },
  {
    icon: Waypoints,
    title: "Simulá disrupciones antes de que pasen",
    description:
      "Aplicá un evento sobre cualquier nodo — un corte, una demora, una huelga — y mirá cómo se propaga por toda la red, sin tocar tu cadena real.",
  },
  {
    icon: GitCompare,
    title: "Comparar escenarios",
    description:
      "Poné dos o más simulaciones lado a lado para decidir qué riesgo atender primero y si conviene reconfigurar la cadena.",
  },
] as const;

const PLANS = [
  {
    name: "Gratis",
    price: "$0",
    period: "para siempre",
    description: "Para probar el modelo con una cadena chica.",
    features: ["1 cadena", "Hasta 10 nodos", "Monitoreo de desempeño semanal", "1 simulación activa"],
    cta: "Empezar gratis",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "por mes",
    description: "Para equipos que monitorean varias cadenas en serio.",
    features: [
      "Cadenas ilimitadas",
      "Hasta 50 nodos por cadena",
      "Simulaciones ilimitadas",
      "Comparar escenarios",
      "Historial de corridas guardado",
    ],
    cta: "Empezar con Pro",
    highlighted: true,
  },
  {
    name: "Empresas",
    price: "A medida",
    period: "según tu operación",
    description: "Para organizaciones con múltiples equipos y cadenas críticas.",
    features: [
      "Todo lo de Pro",
      "Múltiples organizaciones",
      "Roles y permisos por equipo",
      "Soporte dedicado",
    ],
    cta: "Hablar con nosotros",
    highlighted: false,
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={36} height={36} priority className="h-9 w-9" />
          <span className="font-display text-[22px] leading-none tracking-tight">
            <span className="font-semibold text-foreground/60">Twin</span>
            <span className="font-bold">Chain</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/cadenas" className={buttonVariants({ variant: "ghost" })}>
            Iniciar sesión
          </Link>
          <Link href="/cadenas" className={buttonVariants({})}>
            Crear cuenta
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 px-6 pt-10 pb-20 text-center">
          <div className="flex flex-col items-center gap-5">
            <span className="rounded-full border border-border bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-foreground">
              Digital twin de cadenas de suministro
            </span>
            <h1 className="max-w-2xl text-balance text-[40px] font-bold leading-[1.1] tracking-tight sm:text-[48px]">
              Modelá tu cadena y anticipate a sus crisis
            </h1>
            <p className="max-w-xl text-balance text-[15.5px] leading-relaxed text-muted-foreground">
              TwinChain arma un gemelo digital de tu red de proveedores, fábricas, almacenes,
              vendedores y clientes: monitorea su desempeño real y te deja simular disrupciones
              para ver, antes de que pasen, cuánto te cuestan y si conviene reconfigurar.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/cadenas"
              className={buttonVariants({ size: "lg", className: "h-11 px-6 text-[14.5px]" })}
            >
              Crear cuenta gratis
            </Link>
            <Link
              href="/cadenas"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "h-11 px-6 text-[14.5px]",
              })}
            >
              Iniciar sesión
            </Link>
          </div>

          <div className="mt-4 w-full max-w-4xl rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-10">
            <NetworkIllustration />
          </div>
        </section>

        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-16 sm:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <h3 className="text-[15.5px] font-semibold">{feature.title}</h3>
                  <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section id="planes" className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-10 px-6 py-16">
            <div className="flex flex-col items-center gap-2.5 text-center">
              <h2 className="text-[28px] font-bold tracking-tight">Planes</h2>
              <p className="max-w-md text-[14px] text-muted-foreground">
                Empezá gratis y subí de plan cuando tu operación lo necesite.
              </p>
            </div>

            <div className="grid w-full gap-5 sm:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={`flex flex-col gap-5 rounded-2xl border p-6 ${
                    plan.highlighted
                      ? "border-primary bg-card shadow-md ring-1 ring-primary"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[15.5px] font-semibold">{plan.name}</h3>
                      {plan.highlighted && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-medium text-primary-foreground">
                          Más elegido
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[28px] font-bold tracking-tight">{plan.price}</span>
                      <span className="text-[12.5px] text-muted-foreground">{plan.period}</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground">{plan.description}</p>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-[13px]">
                        <Check size={15} strokeWidth={2.5} className="mt-0.5 flex-none text-primary" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/cadenas"
                    className={buttonVariants({
                      variant: plan.highlighted ? "default" : "outline",
                      className: "mt-auto h-9 w-full",
                    })}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-[12.5px] text-muted-foreground">
        TwinChain — Trabajo Final de Ingeniería
      </footer>
    </div>
  );
}
