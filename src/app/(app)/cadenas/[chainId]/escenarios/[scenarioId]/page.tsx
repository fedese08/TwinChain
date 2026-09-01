"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { WeeklyPerformanceChart } from "@/components/charts/weekly-performance-chart";
import { KTableChart } from "@/components/charts/k-table-chart";
import { ChainCanvas } from "@/components/canvas/chain-canvas";
import { classifySeverity, computeChainPropagation, type ProjectedWeek, type Severity } from "@/lib/mock/simulate";
import { formatWeekLabel } from "@/lib/mock/dates";
import { useMockDbStore } from "@/stores/mock-db-store";

export default function ScenarioResultPage({
  params,
}: {
  params: Promise<{ chainId: string; scenarioId: string }>;
}) {
  const { chainId, scenarioId } = use(params);
  const chain = useMockDbStore((s) => s.chains.find((c) => c.id === chainId));
  const scenario = useMockDbStore((s) => s.scenarios.find((sc) => sc.id === scenarioId));
  const allEvents = useMockDbStore((s) => s.events);
  const events = useMemo(() => allEvents.filter((e) => e.scenarioId === scenarioId), [allEvents, scenarioId]);
  const result = useMockDbStore((s) => s.results.find((r) => r.scenarioId === scenarioId));
  const allNodes = useMockDbStore((s) => s.nodes);
  const allEdges = useMockDbStore((s) => s.edges);
  const weeklyPerformance = useMockDbStore((s) => s.weeklyPerformance);

  const chainNodes = useMemo(() => allNodes.filter((n) => n.chainId === chainId), [allNodes, chainId]);
  const chainNodeIds = useMemo(() => new Set(chainNodes.map((n) => n.id)), [chainNodes]);
  const chainEdges = useMemo(
    () => allEdges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId)),
    [allEdges, chainNodeIds],
  );

  const propagation = useMemo((): Map<string, ProjectedWeek[]> => {
    if (!scenario) return new Map();
    return computeChainPropagation(chainNodes, chainEdges, events, weeklyPerformance, scenario.projectionHorizonWeeks);
  }, [chainNodes, chainEdges, events, weeklyPerformance, scenario]);

  const directlyAffectedNodeIds = useMemo(() => [...new Set(events.map((e) => e.nodeId))], [events]);
  const propagatedNodeIds = useMemo(
    () => [...propagation.keys()].filter((id) => !directlyAffectedNodeIds.includes(id)),
    [propagation, directlyAffectedNodeIds],
  );

  const peakWeekIndex = useMemo(() => {
    if (!scenario) return 0;
    let bestIndex = 0;
    let bestDeficit = -1;
    for (let i = 0; i < scenario.projectionHorizonWeeks; i++) {
      let weekTotal = 0;
      for (const weeks of propagation.values()) weekTotal += weeks[i]?.deficit ?? 0;
      if (weekTotal > bestDeficit) {
        bestDeficit = weekTotal;
        bestIndex = i;
      }
    }
    return bestIndex;
  }, [propagation, scenario]);

  const [weekIndex, setWeekIndex] = useState(peakWeekIndex);
  const effectiveWeekIndex = Math.min(weekIndex, (scenario?.projectionHorizonWeeks ?? 1) - 1);

  const severityByNode = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const node of chainNodes) {
      const deficit = propagation.get(node.id)?.[effectiveWeekIndex]?.deficit ?? 0;
      map[node.id] = classifySeverity(deficit);
    }
    return map;
  }, [chainNodes, propagation, effectiveWeekIndex]);

  const severityByEdge = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const edge of chainEdges) {
      map[edge.id] = severityByNode[edge.sourceNodeId] ?? "none";
    }
    return map;
  }, [chainEdges, severityByNode]);

  const weekLabel = useMemo(() => {
    const anyProjection = [...propagation.values()][0];
    return anyProjection?.[effectiveWeekIndex]?.weekStart ? formatWeekLabel(anyProjection[effectiveWeekIndex].weekStart) : "";
  }, [propagation, effectiveWeekIndex]);

  if (!chain || !scenario || !result) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Escenario no encontrado.
      </div>
    );
  }

  let totalDeficit = 0;
  for (const weeks of propagation.values()) totalDeficit += weeks.reduce((sum, w) => sum + w.deficit, 0);
  const equivalentBadWeeks = totalDeficit / 100;
  const k1Threshold = result.kTable.find((r) => r.k === 1)?.threshold ?? null;
  const firstNullK = result.kTable.find((r) => r.threshold === null)?.k ?? null;
  const severeCount = Object.values(severityByNode).filter((s) => s === "severe").length;
  const moderateCount = Object.values(severityByNode).filter((s) => s === "moderate").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-center gap-3 px-5 pt-5 pb-3.5">
        <Link href={`/cadenas/${chainId}/escenarios`} className="flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground">
          <span className="font-mono text-[13px]">‹</span>Simulaciones
        </Link>
        <div className="h-5 w-px bg-border" />
        <div className="text-[14.5px] font-medium">{scenario.name}</div>
        <div className="flex-1" />
        <div className="font-mono text-[11px] text-muted-foreground">
          {chain.name} · corrida {result.runDate}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-none flex-col gap-2 border-b border-border px-5 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-[13.5px] font-medium">Red fork — propagación de la disrupción</span>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {severeCount} nodo{severeCount === 1 ? "" : "s"} severo{severeCount === 1 ? "" : "s"} · {moderateCount}{" "}
              moderado{moderateCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex h-[380px] overflow-hidden rounded-xl border border-border">
            <ChainCanvas chainId={chainId} mode="display" severityByNode={severityByNode} severityByEdge={severityByEdge} />
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10.5px] text-muted-foreground">semana</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, scenario.projectionHorizonWeeks - 1)}
              value={effectiveWeekIndex}
              onChange={(e) => setWeekIndex(Number(e.target.value))}
              className="h-1.5 flex-1 accent-primary"
            />
            <span className="w-24 flex-none text-right font-mono text-[11px] text-muted-foreground">
              {effectiveWeekIndex + 1}/{scenario.projectionHorizonWeeks} · {weekLabel}
            </span>
          </div>
        </div>

        <div className="flex justify-center overflow-visible px-5 pt-4 pb-10">
          <div className="flex w-full max-w-[760px] flex-col gap-4">
            <div className="rounded-xl border border-primary/25 bg-accent p-5">
              <div className="mb-2.5 font-mono text-[9.5px] font-medium uppercase tracking-wider text-primary">Resultado</div>
              <div className="text-[19px] font-medium leading-snug text-pretty">
                Con la disrupción configurada, el déficit acumulado proyectado a {scenario.projectionHorizonWeeks}{" "}
                semanas equivale a <span className="font-mono">{equivalentBadWeeks.toFixed(1)}</span> semanas malas,
                propagándose a {propagatedNodeIds.length} nodo{propagatedNodeIds.length === 1 ? "" : "s"} aguas abajo.
                A un costo de reconfigurar k=1, el umbral resultante es{" "}
                <span className="font-mono">{k1Threshold !== null ? k1Threshold.toFixed(1) : "inexistente"}</span>
                {firstNullK !== null && (
                  <> — a partir de k={firstNullK} deja de existir un umbral de reconfiguración.</>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Eventos del escenario
              </div>
              <div className="flex flex-col gap-1.5">
                {events.map((e) => {
                  const node = chainNodes.find((n) => n.id === e.nodeId);
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5">
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px]">{e.eventType}</span>
                      <span className="font-mono text-[12.5px] font-medium">{node?.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">desde {e.startDate}</span>
                      <span className="ml-auto font-mono text-[12.5px] font-medium text-destructive">−{e.magnitude}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13.5px] font-medium">Tabla k — costo de reconfigurar vs. umbral</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">k en semanas malas equivalentes</span>
              </div>
              <KTableChart rows={result.kTable} />
              <div className="mt-3 grid grid-cols-5 gap-1.5 border-t border-border pt-3 font-mono text-[11px]">
                {result.kTable.map((row) => (
                  <div key={row.k} className="flex flex-col items-center gap-0.5 rounded-md bg-secondary/40 py-1.5">
                    <span className="text-muted-foreground">k={row.k}</span>
                    <span className="font-medium">{row.threshold !== null ? row.threshold.toFixed(1) : "—"}</span>
                  </div>
                ))}
              </div>
            </div>

            {[...directlyAffectedNodeIds, ...propagatedNodeIds].map((nodeId) => {
              const node = chainNodes.find((n) => n.id === nodeId);
              const projection = propagation.get(nodeId) ?? [];
              const nodeDeficit = projection.reduce((sum, w) => sum + w.deficit, 0);
              const isDirect = directlyAffectedNodeIds.includes(nodeId);
              return (
                <div key={nodeId} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[13.5px] font-medium">
                      Déficit proyectado — {node?.label}
                      {!isDirect && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">(propagado)</span>}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      acumulado {(nodeDeficit / 100).toFixed(1)} sem. malas
                    </span>
                  </div>
                  <WeeklyPerformanceChart data={projection} height={160} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
