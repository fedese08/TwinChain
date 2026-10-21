"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWeekLabel } from "@/lib/domain/dates";

export interface ComparisonSeries {
  nodeId: string;
  label: string;
  color: string;
  /** Desvío de cada semana respecto de la línea base del nodo, en % de esa línea base (negativo = por debajo). */
  points: { weekStart: string; deviationPct: number }[];
}

/**
 * Compara el desempeño de varios nodos sobre el mismo período (HU5). Como cada nodo tiene su propia línea base (y puede
 * medir en una unidad distinta), se compara el desvío relativo a esa línea base: 0 % es lo esperado de cada nodo.
 */
export function NodeComparisonChart({ series, height = 280 }: { series: ComparisonSeries[]; height?: number }) {
  const weeks = [...new Set(series.flatMap((s) => s.points.map((p) => p.weekStart)))].sort();
  const data = weeks.map((weekStart) => ({
    weekStart,
    label: formatWeekLabel(weekStart),
    ...Object.fromEntries(series.map((s) => [s.nodeId, s.points.find((p) => p.weekStart === weekStart)?.deviationPct ?? null])),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f6" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa4b3" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#9aa4b3" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v}%`} />
        <ReferenceLine y={0} stroke="#0a7d6a" strokeDasharray="4 3" label={{ value: "línea base", fontSize: 9.5, fill: "#0a7d6a", position: "insideTopRight" }} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(value, name) => [`${Number(value).toFixed(1)} %`, series.find((s) => s.nodeId === name)?.label ?? name]}
        />
        <Legend formatter={(value) => series.find((s) => s.nodeId === value)?.label ?? value} wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Line key={s.nodeId} type="monotone" dataKey={s.nodeId} stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
