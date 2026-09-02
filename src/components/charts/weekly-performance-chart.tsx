"use client";

import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWeekLabel } from "@/lib/mock/dates";

export interface WeeklyChartPoint {
  weekStart: string;
  actualValue: number;
  baseline: number;
  /** banda_inferior de la línea base (RF012). */
  baselineLowerBand: number;
  /** banda_superior de la línea base (RF012). */
  baselineUpperBand: number;
  deficit: number;
  /** Extremos del valor real entre réplicas — solo en proyecciones (RF029). */
  actualValueLow?: number;
  actualValueHigh?: number;
}

export function WeeklyPerformanceChart({
  data,
  height = 150,
  /** Semana en la que se aplicó el escalón de reconfiguración, para marcarla (RF022). */
  reconfigurationWeekIndex = null,
}: {
  data: WeeklyChartPoint[];
  height?: number;
  reconfigurationWeekIndex?: number | null;
}) {
  const hasReplicaRange = data.some((d) => d.actualValueLow !== undefined && d.actualValueHigh !== undefined);

  const chartData = data.map((d) => ({
    ...d,
    label: formatWeekLabel(d.weekStart),
    bandaLineaBase: [d.baselineLowerBand, d.baselineUpperBand] as [number, number],
    rangoReplicas:
      d.actualValueLow !== undefined && d.actualValueHigh !== undefined
        ? ([d.actualValueLow, d.actualValueHigh] as [number, number])
        : undefined,
  }));

  const reconfigurationLabel =
    reconfigurationWeekIndex !== null && chartData[reconfigurationWeekIndex]
      ? chartData[reconfigurationWeekIndex].label
      : null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "#9aa4b3" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9.5, fill: "#9aa4b3" }} width={30} axisLine={false} tickLine={false} domain={[0, 100]} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(value, name) =>
            Array.isArray(value)
              ? [`${Number(value[0]).toFixed(1)} – ${Number(value[1]).toFixed(1)}`, name]
              : [Number(value).toFixed(1), name]
          }
        />
        <Area type="monotone" dataKey="bandaLineaBase" name="banda de la línea base" fill="#d9f2ec" stroke="none" />
        {hasReplicaRange && (
          <Area type="monotone" dataKey="rangoReplicas" name="rango entre réplicas" fill="#dfe5fa" stroke="none" />
        )}
        <Area type="monotone" dataKey="deficit" name="déficit" fill="#fdeeeb" stroke="none" />
        <Line type="monotone" dataKey="baseline" name="línea base" stroke="#0d9c84" strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
        <Line type="monotone" dataKey="actualValue" name="valor real" stroke="#3a5bd9" strokeWidth={2} dot={false} />
        {reconfigurationLabel && (
          <ReferenceLine
            x={reconfigurationLabel}
            stroke="#c23a24"
            strokeDasharray="3 3"
            label={{ value: "reconfiguración", fontSize: 9, fill: "#c23a24", position: "insideTopRight" }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
