"use client";

import { useMemo, useState } from "react";
import { ScenarioComparisonChart } from "@/components/charts/scenario-comparison-chart";
import { adaptForEngine } from "@/lib/domain/units";
import { replayRun } from "@/lib/domain/simulate";
import { EVENT_TYPE_LABELS } from "@/lib/validators/scenario";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

/** Colores de serie — mismos que usa el resto de la app para gráficos. */
const SERIES_COLORS = ["#3b82f6", "#0d9c84", "#dfa63c", "#f2703c", "#8c96a6"];

/** Traduce el déficit acumulado a una franja legible, igual que en la pantalla de resultado. */
function classifyImpact(badWeeks: number, horizonWeeks: number) {
  const share = horizonWeeks > 0 ? badWeeks / horizonWeeks : 0;
  if (share >= 0.25) return { label: "Impacto alto", tone: "#c2571f", bg: "#fdece0" };
  if (share >= 0.1) return { label: "Impacto moderado", tone: "#a8761f", bg: "#fdf5e7" };
  return { label: "Impacto bajo", tone: "#0a7d6a", bg: "#e8f6f3" };
}

export default function CompareScenariosPage() {
  const scenarios = useAppStore((s) => s.scenarios);
  const chains = useAppStore((s) => s.chains);
  const results = useAppStore((s) => s.results);
  const events = useAppStore((s) => s.events);
  const nodes = useAppStore((s) => s.nodes);
  const edges = useAppStore((s) => s.edges);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);

  const [selected, setSelected] = useState<string[]>(scenarios.slice(0, 2).map((s) => s.id));

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const selectedScenarios = useMemo(() => scenarios.filter((s) => selected.includes(s.id)), [scenarios, selected]);

  /**
   * Reproduce la última corrida de cada escenario con su propia semilla y arma solo los
   * números que le importan a quien decide: cuánto se pierde, cuándo empieza, cuánto dura
   * y a cuántas partes de la cadena llega.
   */
  const comparisons = useMemo(() => {
    return selectedScenarios.map((scenario, i) => {
      const chain = chains.find((c) => c.id === scenario.chainId);
      const scenarioEvents = events.filter((e) => e.scenarioId === scenario.id);
      const runs = results.filter((r) => r.scenarioId === scenario.id);
      const lastRun = runs[runs.length - 1];

      const chainNodes = nodes.filter((n) => n.chainId === scenario.chainId);
      const chainNodeIds = new Set(chainNodes.map((n) => n.id));
      const chainEdges = edges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId));

      // Los Vendedor con datos reales están en días: el motor los recibe en escala relativa (domain/units.ts).
      const adapter = adaptForEngine(chainNodes, weeklyPerformance);
      const outcome = lastRun
        ? replayRun({
            nodes: chainNodes,
            edges: chainEdges,
            events: scenarioEvents,
            rows: adapter.rows,
            horizonWeeks: scenario.projectionHorizonWeeks,
            decisionWeek: scenario.decisionWeek,
            run: lastRun,
          })
        : null;

      // Pérdida de operación por semana, en semanas equivalentes (la suma de los déficits relativos de la red).
      const perWeek = outcome?.weeklyLoss ?? [];
      const badWeeks = outcome?.totalDeficit.median ?? 0;
      const firstAffectedWeek = perWeek.findIndex((v) => v > 0);
      const peakWeek = perWeek.reduce((best, v, idx) => (v > perWeek[best] ? idx : best), 0);

      const affectedNode = nodes.find((n) => n.id === scenarioEvents[0]?.nodeId);

      return {
        scenario,
        chain,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        events: scenarioEvents,
        affectedNode,
        badWeeks,
        badWeeksLow: outcome?.totalDeficit.low ?? 0,
        badWeeksHigh: outcome?.totalDeficit.high ?? 0,
        perWeek,
        firstAffectedWeek,
        peakWeek,
        weeksInDeficit: perWeek.filter((v) => v > 0).length,
        nodesReached: outcome?.projectionByNode.size ?? 0,
        reconfigured: lastRun?.reconfigurationWeekIndex ?? null,
        hasRun: Boolean(outcome),
      };
    });
  }, [selectedScenarios, chains, events, results, nodes, edges, weeklyPerformance]);

  const maxBadWeeks = Math.max(0.01, ...comparisons.map((c) => c.badWeeksHigh));
  const worst = comparisons.reduce(
    (acc, c) => (acc === null || c.badWeeks > acc.badWeeks ? c : acc),
    null as (typeof comparisons)[number] | null,
  );
  const mildest = comparisons.reduce(
    (acc, c) => (acc === null || c.badWeeks < acc.badWeeks ? c : acc),
    null as (typeof comparisons)[number] | null,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none flex-col gap-0.5 px-5 pt-5 pb-3.5">
        <div className="text-[21px] font-semibold tracking-tight">Comparar simulaciones</div>
        <div className="text-[12.5px] text-muted-foreground">
          Cuánta operación pierde la cadena en cada caso, y en qué momento
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-6">
        <div className="flex w-[240px] flex-none flex-col gap-1.5 overflow-auto rounded-xl border border-border bg-card p-2">
          {scenarios.map((scenario) => {
            const chain = chains.find((c) => c.id === scenario.chainId);
            const active = selected.includes(scenario.id);
            const color = active
              ? SERIES_COLORS[selectedScenarios.findIndex((s) => s.id === scenario.id) % SERIES_COLORS.length]
              : undefined;
            return (
              <button
                key={scenario.id}
                onClick={() => toggle(scenario.id)}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left",
                  active ? "border-primary/40 bg-accent" : "border-transparent hover:bg-muted/50",
                )}
              >
                <span
                  className="mt-[5px] h-2.5 w-2.5 flex-none rounded-full border"
                  style={
                    active
                      ? { background: color, borderColor: color }
                      : { background: "transparent", borderColor: "#c3cede" }
                  }
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[12.5px] font-medium">{scenario.name}</span>
                  <span className="truncate text-[10.5px] text-muted-foreground">{chain?.name}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1 overflow-auto">
          {comparisons.length < 2 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-[12.5px] text-muted-foreground">
              Elegí al menos 2 simulaciones de la lista para compararlas.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Veredicto arriba de todo: cuál es peor y por cuánto. */}
              {worst && mildest && worst.scenario.id !== mildest.scenario.id && (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="text-[15px] leading-snug font-medium text-pretty">
                    <span style={{ color: worst.color }}>{worst.scenario.name}</span> es el escenario más grave: se
                    pierden{" "}
                    <span className="font-mono">{(worst.badWeeks - mildest.badWeeks).toFixed(1)}</span> semanas de
                    operación más que en <span style={{ color: mildest.color }}>{mildest.scenario.name}</span>.
                  </div>
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    Comparado sobre el mismo horizonte de proyección, con el último cálculo de cada uno.
                  </div>
                </div>
              )}

              {/* Barras: la magnitud de cada escenario, de un vistazo. */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[14px] font-medium">Cuánta operación se pierde</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    en semanas de operación, sobre el horizonte de cada escenario
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {comparisons.map((c) => {
                    const impact = classifyImpact(c.badWeeks, c.scenario.projectionHorizonWeeks);
                    return (
                      <div key={c.scenario.id} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: c.color }} />
                            <span className="truncate text-[12.5px] font-medium">{c.scenario.name}</span>
                          </span>
                          <span className="flex flex-none items-baseline gap-1.5">
                            <span className="font-mono text-[16px] font-medium">{c.badWeeks.toFixed(1)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              de {c.scenario.projectionHorizonWeeks} semanas
                            </span>
                          </span>
                        </div>
                        <div className="relative h-6 overflow-hidden rounded-md bg-muted/60">
                          {/* Rango: entre el mejor y el peor caso de las réplicas. */}
                          <div
                            className="absolute inset-y-0 rounded-md opacity-25"
                            style={{
                              left: `${(c.badWeeksLow / maxBadWeeks) * 100}%`,
                              width: `${((c.badWeeksHigh - c.badWeeksLow) / maxBadWeeks) * 100}%`,
                              background: c.color,
                            }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 rounded-md"
                            style={{ width: `${(c.badWeeks / maxBadWeeks) * 100}%`, background: c.color }}
                          />
                        </div>
                        <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                          <span style={{ color: impact.tone }}>{impact.label}</span>
                          <span>
                            puede ir de {c.badWeeksLow.toFixed(1)} a {c.badWeeksHigh.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Curvas superpuestas: en qué momento pega cada uno. */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[14px] font-medium">Cuándo pega cada uno</span>
                  <span className="text-[11.5px] text-muted-foreground">operación perdida semana a semana</span>
                </div>
                <ScenarioComparisonChart
                  series={comparisons.map((c) => ({
                    id: c.scenario.id,
                    name: c.scenario.name,
                    color: c.color,
                    perWeek: c.perWeek,
                  }))}
                />
              </div>

              {/* Ficha por escenario, en lenguaje llano. */}
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.min(comparisons.length, 3)}, minmax(0, 1fr))` }}
              >
                {comparisons.map((c) => (
                  <div key={c.scenario.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start gap-2">
                      <span className="mt-[5px] h-2.5 w-2.5 flex-none rounded-full" style={{ background: c.color }} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{c.scenario.name}</div>
                        <div className="truncate text-[10.5px] text-muted-foreground">{c.chain?.name}</div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed">
                      {c.affectedNode ? (
                        <>
                          <span className="font-medium">{c.affectedNode.label}</span> sufre{" "}
                          {c.events.length === 1
                            ? (EVENT_TYPE_LABELS[c.events[0].eventType] ?? c.events[0].eventType).toLowerCase()
                            : `${c.events.length} eventos`}
                        </>
                      ) : (
                        "sin eventos cargados"
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {[
                        {
                          k: "Empieza a sentirse",
                          v: c.firstAffectedWeek >= 0 ? `semana ${c.firstAffectedWeek + 1}` : "sin impacto",
                        },
                        { k: "Peor momento", v: `semana ${c.peakWeek + 1}` },
                        {
                          k: "Cuánto dura",
                          v: `${c.weeksInDeficit} ${c.weeksInDeficit === 1 ? "semana" : "semanas"}`,
                        },
                        {
                          k: "Partes alcanzadas",
                          v: `${c.nodesReached} ${c.nodesReached === 1 ? "nodo" : "nodos"}`,
                        },
                      ].map((row) => (
                        <div key={row.k} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                          <span className="text-muted-foreground">{row.k}</span>
                          <span className="font-medium">{row.v}</span>
                        </div>
                      ))}
                    </div>

                    {c.reconfigured !== null && (
                      <div className="rounded-lg border border-border px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
                        Incluye reconfigurar en la semana {c.reconfigured + 1}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Una &quot;semana de operación perdida&quot; equivale a tener toda la cadena parada durante una semana.
                El rango de cada barra muestra hasta dónde puede variar el resultado según cómo se comporte la
                propagación.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
