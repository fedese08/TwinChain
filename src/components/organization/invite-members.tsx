"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { INVITE_ROLES } from "@/lib/validators/auth";

export interface PendingInvitation {
  id: string;
  email: string;
  rol: string;
  expiraEn: string;
}

const ROLE_LABELS: Record<(typeof INVITE_ROLES)[number], string> = {
  operator: "Operador",
  admin: "Administrador",
};

export function InviteMembers({ pending }: { pending: PendingInvitation[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<(typeof INVITE_ROLES)[number]>("operator");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setLink(null);
    const response = await fetch("/api/organizacion/invitaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, rol }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      fields?: Record<string, string[]>;
      link?: string;
    } | null;
    setLoading(false);

    if (!response.ok || !body?.link) {
      setError(body?.fields?.email?.[0] ?? body?.error ?? "No pudimos crear la invitación");
      return;
    }
    setLink({ email, url: body.link });
    setEmail("");
    router.refresh();
  }

  async function revoke(id: string) {
    await fetch(`/api/organizacion/invitaciones/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={invite} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="text-[13.5px] font-medium">Invitar a alguien</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@empresa.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Rol</Label>
            <div className="flex gap-1.5">
              {INVITE_ROLES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRol(value)}
                  aria-pressed={rol === value}
                  className={cn(
                    "h-8 rounded-lg border px-3 text-[12.5px] transition-colors",
                    rol === value ? "border-primary bg-primary/5 font-medium" : "border-border text-muted-foreground",
                  )}
                >
                  {ROLE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={loading || !email}>
            {loading ? "Creando…" : "Crear invitación"}
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </form>

      {link && (
        <div className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-[13px] font-medium">Invitación lista para {link.email}</div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Todavía no enviamos emails: copiá este link y pasáselo. Se muestra una sola vez y vence en 7 días.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[11.5px]" />
            <Button variant="outline" onClick={() => copy(link.url)}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-medium">Invitaciones pendientes</div>
          <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
            {pending.map((invitation) => (
              <div key={invitation.id} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{invitation.email}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {invitation.rol} · vence {new Date(invitation.expiraEn).toLocaleDateString("es-AR")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(invitation.id)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Revocar invitación de ${invitation.email}`}
                >
                  <Trash2 size={13} />
                  Revocar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
