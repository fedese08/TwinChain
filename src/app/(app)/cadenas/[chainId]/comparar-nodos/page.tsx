"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { NodeComparisonChart, type ComparisonSeries } from "@/components/charts/node-comparison-chart";
import { degradationPeriods } from "@/lib/domain/degradation";
import { formatWeekLabel } from "@/lib/domain/dates";
import { assessNode, assessOptionsFor } from "@/lib/domain/monitoring";
import { NODE_TYPE_COLOR } from "@/lib/domain/node-visuals";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const COLORS = ["#2563eb", "#c2571f", "#0a7d6a", "#7c3aed", "#b45309", "#db2777", "#0e7490", "#4d7c0f"];
const PERIODS = [
  { label: "12 semanas", weeks: 12 },
  { label: "24 semanas", weeks: 24 },
  { label: "Todo el historial", weeks: Infinity },
] as const;

const LEVEL_LABEL = { normal: "Normal", atencion: "En vigilancia", critico: "Alerta" } as const;

/**
 * HU5: el desempeño de dos o más nodos sobre el mismo período, con los períodos en que el monitoreo confirmó degradación
 * sostenida, para apoyar una decisión de diversificar o de reforzar a un proveedor.
 */
export default function CompareNodesPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = use(params);
  const chain = useAppStore((s) => s.chains.find((c) => c.id === chainId));
  const allNodes = useAppStore((s) => s.nodes);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);
  const nodes = useMemo(() => allNodes.filter((n) => n.chainId === chainId), [allNodes, chainId]);

  const [selected, setSelected] = useState<string[]>(() => nodes.slice(0, 2).map((n) => n.id));
  const [periodWeeks, setPeriodWeeks] = useState<number>(24);

  const rowsByNode = useMemo(() => {
    const map = new Map<string, typeof weeklyPerformance>();
    for (const row of weeklyPerformance) map.set(row.nodeId, [...(map.get(row.nodeId) ?? []), row]);
    for (const rows of map.values()) rows.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return map;
  }, [weeklyPerformance]);

  // El mismo período para todos: las últimas N semanas del dato más reciente entre los nodos elegidos.
  const fromWeek = useMemo(() => {
    const latest = selected.flatMap((id) => rowsByNode.get(id)?.slice(-1).map((r) => r.weekStart) ?? []).sort().pop();
    if (!latest || !Number.isFinite(periodWeeks)) return "";
    const weeks = [...new Set(selected.flatMap((id) => rowsByNode.get(id)?.map((r) => r.weekStart) ?? []))].sort();
    return weeks[Math.max(0, weeks.length - periodWeeks)] ?? "";
  }, [selected, rowsByNode, periodWeeks]);

  const summaries = useMemo(
    () =>
      selected.flatMap((nodeId, i) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return [];
        const options = assessOptionsFor(node, chain);
        const all = rowsByNode.get(nodeId) ?? [];
        const rows = all.filter((r) => r.weekStart >= fromWeek);
        const periods = (options.cusumH !== undefined ? degradationPeriods(all, options.cusumH) : []).filter((p) => p.to >= fromWeek);
        const deviations = rows.map((r) => ({ weekStart: r.weekStart, deviationPct: r.baseline > 0 ? ((r.actualValue - r.baseline) / r.baseline) * 100 : 0 }));
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        return [
          {
            node,
            color: COLORS[i % COLORS.length],
            points: deviations,
            meanDeviation: mean(deviations.map((d) => d.deviationPct)),
            weeksBelow: rows.filter((r) => r.deficit > 0).length,
            weeks: rows.length,
            periods,
            level: assessNode(all, options).level,
          },
        ];
      }),
    [selected, nodes, rowsByNode, chain, fromWeek],
  );

  const series: ComparisonSeries[] = summaries.map((s) => ({ nodeId: s.node.id, label: s.node.label, color: s.color, points: s.points }));

  function toggle(nodeId: string) {
    setSelected((current) => (current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]));
  }

  if (!chain) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">Cadena no encontrada.</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-6">
        <div className="flex flex-col gap-1">
          <Link href={`/cadenas/${chainId}`} className="flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground">
            <span className="font-mono text-[13px]">‹</span>
            {chain.name}
          </Link>
          <div className="text-[21px] font-semibold tracking-tight">Comparar nodos</div>
          <div className="text-[12.5px] text-muted-foreground">
            El desempeño de dos o más nodos sobre el mismo período, con los tramos en que el monitoreo confirmó degradación sostenida.
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Nodos</span>
            {nodes.map((n) => {
              const active = selected.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => toggle(n.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px]",
                    active ? "border-foreground/50 bg-muted font-medium" : "border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: NODE_TYPE_COLOR[n.nodeType] }} />
                  {n.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Período</span>
            {PERIODS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPeriodWeeks(p.weeks)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11.5px]",
                  periodWeeks === p.weeks ? "border-foreground/50 bg-muted font-medium" : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {selected.length < 2 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
            Elegí al menos dos nodos para compararlos.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-1 text-[14px] font-medium">Desvío respecto de la línea base</div>
              <div className="mb-2 text-[11.5px] text-muted-foreground">
                Cada nodo contra su propia línea base: 0 % es lo esperado y los valores negativos son semanas por debajo.
              </div>
              <NodeComparisonChart series={series} />
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="grid grid-cols-[1.1fr_0.8fr_0.9fr_0.9fr_2fr] bg-muted/40 px-4 py-2 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                <div>Nodo</div>
                <div>Estado</div>
                <div>Desvío medio</div>
                <div>Semanas por debajo</div>
                <div>Degradación sostenida en el período</div>
              </div>
              {summaries.map((s) => (
                <div key={s.node.id} className="grid grid-cols-[1.1fr_0.8fr_0.9fr_0.9fr_2fr] items-start gap-2 border-t border-border px-4 py-3 text-[12.5px]">
                  <div className="flex items-center gap-2 font-mono font-medium">
                    <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} />
                    {s.node.label}
                  </div>
                  <div>{LEVEL_LABEL[s.level]}</div>
                  <div className="font-mono">{s.meanDeviation.toFixed(1)} %</div>
                  <div className="font-mono">
                    {s.weeksBelow} de {s.weeks}
                  </div>
                  <div className="text-muted-foreground">
                    {s.periods.length === 0
                      ? "Ninguna"
                      : s.periods.map((p) => `${formatWeekLabel(p.from)} a ${formatWeekLabel(p.to)}`).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
