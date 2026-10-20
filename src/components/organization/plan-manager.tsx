"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PLAN_DEFINITIONS, PLAN_IDS, type PlanId, type Usage } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const full = used >= max;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {used} / {max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className={cn("h-1.5 rounded-full", full ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.min(100, (used / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Plan vigente de la organización, cuánto de sus topes usa y (para administradores) el cambio de plan. */
export function PlanManager({ plan, since, usage, canManage }: { plan: PlanId; since: string; usage: Usage; canManage: boolean }) {
  const router = useRouter();
  const setPlan = useAppStore((s) => s.setPlan);
  const [pending, setPending] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = PLAN_DEFINITIONS[plan];
  const isUpgrade = (id: PlanId) => PLAN_IDS.indexOf(id) > PLAN_IDS.indexOf(plan);
  const atTop = plan === PLAN_IDS[PLAN_IDS.length - 1];

  async function change(next: PlanId) {
    setError(null);
    if (!isUpgrade(next) && !window.confirm(`¿Bajar al plan ${PLAN_DEFINITIONS[next].name}? Se reducen tus topes de nodos y escenarios.`)) return;
    setPending(next);
    try {
      const response = await fetch("/api/organizacion/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: next }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "No pudimos cambiar el plan. Probá de nuevo.");
        return;
      }
      setPlan(next);
      toast.success(`${isUpgrade(next) ? "Subiste" : "Bajaste"} al plan ${PLAN_DEFINITIONS[next].name}`);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">Plan</div>
          <div className="text-[17px] font-semibold tracking-tight">
            {current.name}
            <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
              {current.priceUsd === 0 ? "sin costo" : `US$${current.priceUsd} por mes + IVA`}
            </span>
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            Vigente desde el {new Date(since).toLocaleDateString("es-AR")}
          </div>
        </div>
        <span className="rounded-full border border-primary/40 bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
          Activo
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <UsageBar label="Nodos" used={usage.nodes} max={current.maxNodes} />
        <UsageBar label="Escenarios guardados" used={usage.scenarios} max={current.maxScenarios} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Las ejecuciones sobre los escenarios no tienen límite ni vencimiento. Al completar el tope de escenarios, crear uno
        nuevo se bloquea hasta que borres otro o cambies de plan.
      </p>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const def = PLAN_DEFINITIONS[id];
          const isCurrent = id === plan;
          return (
            <div
              key={id}
              className={cn("flex flex-col gap-2 rounded-xl border p-3.5", isCurrent ? "border-primary bg-accent/40" : "border-border")}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[13.5px] font-semibold">{def.name}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {def.priceUsd === 0 ? "US$0" : `US$${def.priceUsd}/mes`}
                </span>
              </div>
              <ul className="flex flex-col gap-1 text-[12px]">
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-primary" />
                  Hasta {def.maxNodes} nodos
                </li>
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-primary" />
                  Hasta {def.maxScenarios} escenarios guardados
                </li>
              </ul>
              {isCurrent ? (
                <span className="mt-auto pt-1 text-[11.5px] text-muted-foreground">Tu plan actual</span>
              ) : canManage ? (
                <Button
                  size="sm"
                  variant={isUpgrade(id) ? "default" : "outline"}
                  className="mt-auto"
                  disabled={pending !== null}
                  onClick={() => change(id)}
                >
                  {pending === id ? "Cambiando…" : `${isUpgrade(id) ? "Subir" : "Bajar"} a ${def.name}`}
                </Button>
              ) : isUpgrade(id) ? (
                <span className="mt-auto pt-1 text-[11.5px] text-muted-foreground">Lo gestiona un administrador</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {atTop && <p className="text-[12px] text-muted-foreground">Estás en el plan más alto.</p>}
      <p className="text-[11px] text-muted-foreground">
        El cambio es inmediato. En esta versión del prototipo no se realiza ningún cobro.
      </p>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
      {!canManage && (
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          Solo los administradores pueden cambiar el plan de la organización.
        </p>
      )}
    </div>
  );
}
