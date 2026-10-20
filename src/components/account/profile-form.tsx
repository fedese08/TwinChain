"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordSchema, updateProfileSchema, type ChangePasswordValues, type UpdateProfileValues } from "@/lib/validators/account";

const LABEL = "font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground";

async function request(method: string, url: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return { ok: response.ok, error: data?.error };
}

function NameSection({ name, email, roleName, organization }: { name: string; email: string; roleName: string; organization: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<UpdateProfileValues>({ resolver: zodResolver(updateProfileSchema), defaultValues: { nombre: name } });

  async function onSubmit(values: UpdateProfileValues) {
    setError(null);
    const result = await request("PATCH", "/api/cuenta", values);
    if (!result.ok) {
      setError(result.error ?? "No pudimos guardar los cambios. Probá de nuevo.");
      return;
    }
    toast.success("Perfil actualizado");
    reset(values);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="text-[15px] font-semibold tracking-tight">Datos personales</div>
      <div className="flex flex-col gap-1.5">
        <Label className={LABEL}>Nombre</Label>
        <Input {...register("nombre")} autoComplete="name" />
        {errors.nombre && <span className="text-[11px] text-destructive">{errors.nombre.message}</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-1">
          <Label className={LABEL}>Email</Label>
          <Input value={email} readOnly disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className={LABEL}>Organización</Label>
          <Input value={organization} readOnly disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className={LABEL}>Rol</Label>
          <Input value={roleName} readOnly disabled />
        </div>
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        El email identifica tu cuenta y no se puede cambiar desde acá. El rol lo define un administrador de la organización.
      </p>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
      <div>
        <Button type="submit" disabled={isSubmitting || !isDirty} className="bg-foreground text-background hover:bg-foreground/85">
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

function PasswordSection() {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { actual: "", nueva: "", confirmacion: "" },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setError(null);
    const result = await request("PUT", "/api/cuenta/contrasena", values);
    if (!result.ok) {
      setError(result.error ?? "No pudimos cambiar la contraseña. Probá de nuevo.");
      return;
    }
    toast.success("Contraseña actualizada");
    reset();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="text-[15px] font-semibold tracking-tight">Contraseña</div>
      <div className="flex flex-col gap-1.5">
        <Label className={LABEL}>Contraseña actual</Label>
        <Input type="password" autoComplete="current-password" {...register("actual")} />
        {errors.actual && <span className="text-[11px] text-destructive">{errors.actual.message}</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className={LABEL}>Nueva contraseña</Label>
          <Input type="password" autoComplete="new-password" {...register("nueva")} />
          {errors.nueva && <span className="text-[11px] text-destructive">{errors.nueva.message}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className={LABEL}>Repetir nueva contraseña</Label>
          <Input type="password" autoComplete="new-password" {...register("confirmacion")} />
          {errors.confirmacion && <span className="text-[11px] text-destructive">{errors.confirmacion.message}</span>}
        </div>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
      <div>
        <Button type="submit" variant="outline" disabled={isSubmitting}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
}

/** Edición del perfil propio: nombre y contraseña. */
export function ProfileForm(props: { name: string; email: string; roleName: string; organization: string; hasPassword: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <NameSection {...props} />
      {props.hasPassword ? (
        <PasswordSection />
      ) : (
        <p className="rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">Tu cuenta no usa contraseña propia.</p>
      )}
    </div>
  );
}
