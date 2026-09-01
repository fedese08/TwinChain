"use client";

import { useState } from "react";
import { useMockDbStore } from "@/stores/mock-db-store";
import { cn } from "@/lib/utils";

const K_VALUES = Array.from({ length: 10 }, (_, i) => i + 1);

export default function CompareScenariosPage() {
  const scenarios = useMockDbStore((s) => s.scenarios);
  const chains = useMockDbStore((s) => s.chains);
  const results = useMockDbStore((s) => s.results);
  const events = useMockDbStore((s) => s.events);
  const nodes = useMockDbStore((s) => s.nodes);
  const [selected, setSelected] = useState<string[]>(scenarios.slice(0, 2).map((s) => s.id));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const selectedScenarios = scenarios.filter((s) => selected.includes(s.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-center gap-3 px-5 pt-5 pb-3.5">
        <div className="text-[21px] font-semibold tracking-tight">Comparar escenarios</div>
        <span className="font-mono text-[12px] text-muted-foreground">sin límite fijo de escenarios</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-6">
        <div className="flex w-[260px] flex-none flex-col gap-1.5 overflow-auto rounded-xl border border-border bg-card p-2">
          {scenarios.map((scenario) => {
            const chain = chains.find((c) => c.id === scenario.chainId);
            const active = selected.includes(scenario.id);
            return (
              <button
                key={scenario.id}
                onClick={() => toggle(scenario.id)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                  active ? "border-primary/50 bg-accent" : "border-transparent hover:bg-secondary/50",
                )}
              >
                <span className="truncate text-[12.5px] font-medium">{scenario.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{chain?.name}</span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1 overflow-auto">
          {selectedScenarios.length < 2 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-[12.5px] text-muted-foreground">
              Elegí al menos 2 escenarios para comparar.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="whitespace-nowrap px-3.5 py-2.5 text-left font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                        k
                      </th>
                      {selectedScenarios.map((s) => (
                        <th key={s.id} className="min-w-[140px] px-3.5 py-2.5 text-left font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {K_VALUES.map((k) => (
                      <tr key={k} className="border-b border-border last:border-b-0">
                        <td className="px-3.5 py-2 font-mono text-muted-foreground">k={k}</td>
                        {selectedScenarios.map((s) => {
                          const result = results.find((r) => r.scenarioId === s.id);
                          const row = result?.kTable.find((r) => r.k === k);
                          return (
                            <td key={s.id} className="px-3.5 py-2 font-mono font-medium">
                              {row?.threshold !== null && row?.threshold !== undefined ? row.threshold.toFixed(1) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${selectedScenarios.length}, minmax(0, 1fr))` }}>
                {selectedScenarios.map((s) => {
                  const scenarioEvents = events.filter((e) => e.scenarioId === s.id);
                  const chain = chains.find((c) => c.id === s.chainId);
                  return (
                    <div key={s.id} className="rounded-xl border border-border bg-card p-3.5">
                      <div className="truncate text-[13px] font-medium">{s.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {chain?.name} · {s.projectionHorizonWeeks} sem
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        {scenarioEvents.map((e) => {
                          const node = nodes.find((n) => n.id === e.nodeId);
                          return (
                            <div key={e.id} className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="text-muted-foreground">{e.eventType}</span>
                              <span className="font-medium">{node?.label}</span>
                              <span className="ml-auto text-destructive">−{e.magnitude}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Todos los escenarios se calculan con el mismo barrido de k (costo de reconfigurar, en semanas malas
                equivalentes). Un umbral más bajo en un k dado indica que se justifica reconfigurar con menos déficit
                acumulado.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
