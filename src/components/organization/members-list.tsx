"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { INVITE_ROLES } from "@/lib/validators/auth";

export interface MemberRow {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

const ROLE_BY_NAME: Record<string, (typeof INVITE_ROLES)[number]> = { Administrador: "admin", Operador: "operator" };
const ROLE_OPTIONS: { value: (typeof INVITE_ROLES)[number]; label: string }[] = [
  { value: "admin", label: "Administrador" },
  { value: "operator", label: "Operador" },
];

/**
 * Integrantes de la organización. Quien administra puede cambiar el rol de las demás personas o sacarlas; a sí misma no
 * (para irse está "Eliminar cuenta").
 */
export function MembersList({ members, selfId, canManage }: { members: MemberRow[]; selfId: string; canManage: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function call(id: string, init: RequestInit, success: string) {
    setBusyId(id);
    const response = await fetch(`/api/organizacion/miembros/${id}`, init);
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyId(null);
    setConfirmingId(null);
    if (!response.ok) {
      toast.error(body?.error ?? "No pudimos hacer el cambio");
      return;
    }
    toast.success(success);
    router.refresh();
  }

  const changeRole = (member: MemberRow, rol: (typeof INVITE_ROLES)[number]) =>
    call(member.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rol }) }, `Rol de ${member.nombre} actualizado`);

  return (
    <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
      {members.map((m) => {
        const isSelf = m.id === selfId;
        const editable = canManage && !isSelf;
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {m.nombre
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {m.nombre}
                {isSelf && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(vos)</span>}
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">{m.email}</div>
            </div>

            {editable ? (
              <select
                aria-label={`Rol de ${m.nombre}`}
                value={ROLE_BY_NAME[m.rol] ?? "operator"}
                disabled={busyId === m.id}
                onChange={(e) => changeRole(m, e.target.value as (typeof INVITE_ROLES)[number])}
                className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{m.rol}</span>
            )}

            {editable &&
              (confirmingId === m.id ? (
                <span className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    disabled={busyId === m.id}
                    onClick={() => call(m.id, { method: "DELETE" }, `${m.nombre} salió de la organización`)}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    Confirmar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(m.id)}
                  className="text-[12px] text-muted-foreground hover:text-destructive"
                  aria-label={`Quitar a ${m.nombre} de la organización`}
                >
                  Quitar
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
