"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token, organizationName }: { token: string; organizationName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/invitaciones/aceptar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "No pudimos aceptar la invitación");
      setLoading(false);
      return;
    }
    router.push("/cadenas");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
      <Button size="lg" className="h-10" onClick={accept} disabled={loading}>
        {loading ? "Uniéndote…" : `Unirme a ${organizationName}`}
      </Button>
    </div>
  );
}
