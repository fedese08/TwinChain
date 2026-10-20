"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { DeleteScenarioDialog } from "@/components/scenario/delete-scenario-dialog";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import { useAppStore } from "@/stores/app-store";

export default function ScenarioListPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = use(params);
  const chain = useAppStore((s) => s.chains.find((c) => c.id === chainId));
  const allScenarios = useAppStore((s) => s.scenarios);
  const scenarios = useMemo(() => allScenarios.filter((sc) => sc.chainId === chainId), [allScenarios, chainId]);
  const events = useAppStore((s) => s.events);
  const results = useAppStore((s) => s.results);
  const pendingRuns = useAppStore((s) => s.pendingRuns);
  const nodes = useAppStore((s) => s.nodes);
  const canRun = useAppStore((s) => s.canRun);
  const { definition, usage, scenariosAtLimit } = usePlanUsage();
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  if (!chain) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Cadena no encontrada.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-start gap-3 px-5 pt-5 pb-3.5">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">Simulaciones</div>
          <div className="text-[12.5px] text-muted-foreground">
            {chain.name} · cada simulación es un fork con uno o más eventos. La cadena viva nunca se altera.
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            Escenarios guardados: {usage.scenarios} de {definition.maxScenarios} del plan {definition.name}. Las ejecuciones
            sobre ellos no tienen límite.
          </div>
        </div>
        <div className="flex-1" />
        {scenariosAtLimit ? (
          <span
            title="Borrá un escenario o cambiá de plan para crear otro"
            className="flex-none cursor-not-allowed whitespace-nowrap rounded-lg bg-foreground/40 px-3.5 py-2 text-[12.5px] font-medium text-background"
          >
            ⑂ Nueva simulación
          </span>
        ) : (
          <Link
            href={`/cadenas/${chainId}`}
            className="flex-none whitespace-nowrap rounded-lg bg-foreground px-3.5 py-2 text-[12.5px] font-medium text-background hover:bg-foreground/85"
          >
            ⑂ Nueva simulación
          </Link>
        )}
      </div>

      <div className="flex-1 overflow-auto px-5 pb-6">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[1.6fr_1.4fr_0.7fr_1.1fr_0.9fr_0.8fr] border-b border-border bg-muted/30 px-4 py-2.5 font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>Escenario</div>
            <div>Eventos</div>
            <div>Horizonte</div>
            <div>Umbral k=1 (mediana)</div>
            <div>Sin umbral desde</div>
            <div>Corridas</div>
          </div>
          {scenarios.map((scenario) => {
            const scenarioEvents = events.filter((e) => e.scenarioId === scenario.id);
            const scenarioRuns = results.filter((r) => r.scenarioId === scenario.id);
            // La última corrida es la que se muestra en el listado; las anteriores se conservan (RF030).
            const result = scenarioRuns[scenarioRuns.length - 1];
            const k1 = result?.kTable.find((r) => r.k === 1);
            const firstNull = result?.kTable.find((r) => r.thresholdMedian === null)?.k ?? null;
            const running = pendingRuns.some((r) => r.scenarioId === scenario.id);

            return (
              <div key={scenario.id} className="relative border-b border-border last:border-b-0">
              <Link
                href={`/cadenas/${chainId}/escenarios/${scenario.id}`}
                className="grid grid-cols-[1.6fr_1.4fr_0.7fr_1.1fr_0.9fr_0.8fr] items-center px-4 py-3 pr-12 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{scenario.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{chain.name}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {scenarioEvents.map((e) => {
                    const node = nodes.find((n) => n.id === e.nodeId);
                    return (
                      <span
                        key={e.id}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {e.eventType} · {node?.label}
                      </span>
                    );
                  })}
                </div>
                <div className="font-mono text-[12.5px]">{scenario.projectionHorizonWeeks} sem</div>
                <div className="font-mono">
                  <span className="text-[13px] font-medium">
                    {k1?.thresholdMedian !== null && k1?.thresholdMedian !== undefined ? k1.thresholdMedian.toFixed(1) : "—"}
                  </span>
                  {k1?.thresholdLow !== null && k1?.thresholdLow !== undefined && k1.thresholdHigh !== null && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {k1.thresholdLow.toFixed(1)}–{k1.thresholdHigh.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[12.5px] text-muted-foreground">{firstNull !== null ? `k=${firstNull}` : "no aplica"}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {running ? (
                    <span className="flex items-center gap-1.5 text-primary">
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
                      corriendo
                    </span>
                  ) : (
                    `${scenarioRuns.length} · ${result?.runDate ?? scenario.createdAt}`
                  )}
                </div>
              </Link>
              {canRun && (
                <button
                  type="button"
                  onClick={() => setToDelete({ id: scenario.id, name: scenario.name })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={`Eliminar simulación ${scenario.name}`}
                  title="Eliminar simulación"
                >
                  <Trash2 size={14} />
                </button>
              )}
              </div>
            );
          })}
          {scenarios.length === 0 && (
            <div className="p-8 text-center text-[12.5px] text-muted-foreground">
              Todavía no hay simulaciones para esta cadena.
            </div>
          )}
        </div>
      </div>

      <DeleteScenarioDialog scenario={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
