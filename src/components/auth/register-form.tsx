"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { Building2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONSENT_CHECKBOX_LABEL, CONSENT_PARAGRAPHS, CONSENT_TITLE } from "@/lib/legal/consent";
import { cn } from "@/lib/utils";
import { registerSchema, type RegisterType, type RegisterValues } from "@/lib/validators/auth";

const TYPE_OPTIONS: { value: RegisterType; label: string; hint: string; icon: typeof Building2 }[] = [
  { value: "organizacion", label: "Organización", hint: "Creás tu organización y después invitás a tu equipo", icon: Building2 },
  { value: "empleado", label: "Empleado", hint: "Te sumás a una organización con una invitación", icon: UserRound },
];

export function RegisterForm({ next, invitedEmail }: { next: string; invitedEmail?: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    // Con una invitación de por medio lo normal es registrarse como empleado y con el mail invitado.
    defaultValues: {
      tipo: invitedEmail ? "empleado" : "organizacion",
      email: invitedEmail ?? "",
    },
  });
  const tipo = watch("tipo");

  async function onSubmit(values: RegisterValues) {
    setServerError(null);
    const response = await fetch("/api/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string[]>;
      } | null;
      for (const [field, messages] of Object.entries(body?.fields ?? {})) {
        setError(field as keyof RegisterValues, { message: messages[0] });
      }
      setServerError(body?.error ?? "No pudimos crear la cuenta. Probá de nuevo.");
      return;
    }

    const login = await signIn("credentials", { email: values.email, password: values.password, redirect: false });
    if (!login || login.error) {
      router.push("/login");
      return;
    }
    // Un empleado sin invitación en mano no tiene adónde ir todavía.
    router.push(values.tipo === "empleado" && next === "/cadenas" ? "/sin-organizacion" : next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label>Me registro como</Label>
        <div className="grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = tipo === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setValue("tipo", option.value, { shouldValidate: true })}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
                aria-pressed={active}
              >
                <Icon size={16} className={active ? "text-primary" : "text-muted-foreground"} />
                <span className="text-[13px] font-medium">{option.label}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tipo === "organizacion" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nombreOrganizacion">Nombre de la organización</Label>
          <Input id="nombreOrganizacion" aria-invalid={!!errors.nombreOrganizacion} {...register("nombreOrganizacion")} />
          {errors.nombreOrganizacion && (
            <p className="text-[12px] text-destructive">{errors.nombreOrganizacion.message}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nombre">Tu nombre</Label>
        <Input id="nombre" autoComplete="name" aria-invalid={!!errors.nombre} {...register("nombre")} />
        {errors.nombre && <p className="text-[12px] text-destructive">{errors.nombre.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        {errors.email && <p className="text-[12px] text-destructive">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-[12px] text-destructive">{errors.password.message}</p>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">Entre 8 y 72 caracteres</p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5">
        <div className="text-[13px] font-semibold">{CONSENT_TITLE}</div>
        <div id="consent-text" className="flex flex-col gap-2.5">
          {CONSENT_PARAGRAPHS.map((paragraph, index) => (
            <p
              key={paragraph}
              // Cerrado se ve solo el comienzo de la primera parte; el texto completo está a un click.
              className={cn(
                "text-[11.5px] leading-relaxed text-muted-foreground",
                !consentOpen && index === 0 && "line-clamp-3",
                !consentOpen && index > 0 && "hidden",
              )}
            >
              {paragraph}
            </p>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setConsentOpen((open) => !open)}
          aria-expanded={consentOpen}
          aria-controls="consent-text"
          className="w-fit text-[11.5px] font-medium text-primary hover:underline"
        >
          {consentOpen ? "Mostrar menos" : "Leer todo"}
        </button>
        <label htmlFor="aceptaTratamiento" className="flex cursor-pointer items-start gap-2 text-[12px] leading-snug">
          <input
            id="aceptaTratamiento"
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 flex-none accent-primary"
            aria-invalid={!!errors.aceptaTratamiento}
            {...register("aceptaTratamiento")}
          />
          <span>{CONSENT_CHECKBOX_LABEL}</span>
        </label>
        {errors.aceptaTratamiento && <p className="text-[12px] text-destructive">{errors.aceptaTratamiento.message}</p>}
      </div>

      {serverError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{serverError}</p>}
      <Button type="submit" size="lg" className="h-10" disabled={isSubmitting}>
        {isSubmitting ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
