"use client";

import Link from "next/link";
import { useAppStore } from "@/stores/app-store";
import { NODE_TYPE_COLOR } from "@/lib/mock/node-visuals";
import type { StabilityCheck } from "@/lib/mock/types";

/**
 * Veredicto del pipeline de ingesta sobre el historial de la cadena (C24). Corre por cada cadena
 * nueva, no una sola vez en desarrollo: por eso una recién creada aparece primero como "revisando".
 * El mecanismo (CUSUM) no se nombra acá — es jerga que no le dice nada a quien opera; queda para
 * las vistas de detalle técnico.
 */
function StabilityBadge({ check }: { check?: StabilityCheck }) {
  if (!check) return null;

  if (check.status === "corriendo") {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
        revisando historial…
      </div>
    );
  }

  const alerta = check.status === "alerta";
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
      <span className="rounded border px-1 py-0.5" style={{ borderColor: alerta ? "#f5c9a8" : "#b9e2d8", color: alerta ? "#c2571f" : "#0a7d6a" }}>
        {alerta ? "cambió el comportamiento" : "desempeño estable"}
      </span>
      {alerta && check.changePointWeek ? `desde ${check.changePointWeek}` : `revisado ${check.ranAt}`}
    </div>
  );
}

export default function ChainsPage() {
  const organizationName = useAppStore((s) => s.organizationName);
  const chains = useAppStore((s) => s.chains);
  const nodes = useAppStore((s) => s.nodes);
  const edges = useAppStore((s) => s.edges);
  const scenarios = useAppStore((s) => s.scenarios);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);
  const stabilityChecks = useAppStore((s) => s.stabilityChecks);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-start gap-3 px-5 pt-5">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">Cadenas</div>
          <div className="text-[12.5px] text-muted-foreground">
            {organizationName} · {chains.length} {chains.length === 1 ? "cadena" : "cadenas"}
          </div>
        </div>
        <div className="flex-1" />
        <Link
          href="/cadenas/nueva"
          className="flex-none whitespace-nowrap rounded-lg bg-foreground px-3.5 py-2 text-[12.5px] font-medium text-background hover:bg-foreground/85"
        >
          + Nueva cadena
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(292px,1fr))] content-start gap-3.5 overflow-auto p-5">
        {chains.map((chain) => {
          const chainNodes = nodes.filter((n) => n.chainId === chain.id);
          const chainNodeIds = new Set(chainNodes.map((n) => n.id));
          const chainEdges = edges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId));
          const chainScenarios = scenarios.filter((s) => s.chainId === chain.id);
          const chainDeficits = weeklyPerformance.filter((w) => chainNodeIds.has(w.nodeId));
          const avgDeficit =
            chainDeficits.length > 0 ? chainDeficits.reduce((sum, w) => sum + w.deficit, 0) / chainDeficits.length : 0;
          const stable = avgDeficit < 2;

          return (
            <Link
              key={chain.id}
              href={`/cadenas/${chain.id}`}
              className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 shadow-xs transition-colors hover:border-primary/40"
            >
              <div className="flex h-[104px] items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30">
                {chainNodes.slice(0, 5).map((n) => (
                  <span
                    key={n.id}
                    className="h-3.5 w-3.5 rounded-sm border"
                    style={{ background: `${NODE_TYPE_COLOR[n.nodeType]}22`, borderColor: NODE_TYPE_COLOR[n.nodeType] }}
                  />
                ))}
                {chainNodes.length > 5 && (
                  <span className="font-mono text-[10px] text-muted-foreground">+{chainNodes.length - 5}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 truncate text-[15px] font-medium">{chain.name}</div>
                <span className="ml-auto flex-none rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                  {chain.visibility === "shared" ? "compartida" : "privada"}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {chainNodes.length} nodos · {chainEdges.length} aristas · {chainScenarios.length} simulaciones
              </div>
              <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: stable ? "#0a7d6a" : "#c2571f" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: stable ? "#0d9c84" : "#f2703c" }} />
                {stable ? "desempeño estable" : `déficit promedio ${avgDeficit.toFixed(1)} pp`}
              </div>
              {/* Validación de estabilidad estructural del pipeline de ingesta (C24). */}
              <StabilityBadge check={stabilityChecks[chain.id]} />
            </Link>
          );
        })}

        <Link
          href="/cadenas/nueva"
          className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border font-mono text-[18px]">+</div>
          <div className="text-[13.5px]">Nueva cadena</div>
          <div className="text-[11.5px]">en blanco o desde plantilla</div>
        </Link>
      </div>
    </div>
  );
}
