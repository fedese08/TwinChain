"use client";

import {
  Area,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatWeekLabel } from "@/lib/mock/dates";

export interface CrisisWeekPoint {
  /** ISO del lunes de la semana proyectada. */
  weekStart: string;
  /** Operación perdida esa semana, en semanas equivalentes (déficit de toda la red / 100). */
  lost: number;
}

interface CrisisTimelineChartProps {
  data: CrisisWeekPoint[];
  /** Semana que se está mirando en la red — se marca con una línea vertical. */
  currentWeekIndex: number;
  /** Semana en la que se aplicó la reconfiguración, si hubo (RF022). */
  reconfigurationWeekIndex?: number | null;
  height?: number;
  /** Click sobre el gráfico para saltar a esa semana. */
  onSeek?: (weekIndex: number) => void;
}

/**
 * La curva de la crisis: cuánta operación se pierde cada semana del horizonte.
 * Pensado para leerse sin jerga — marca el arranque, el peor momento y la reconfiguración.
 */
export function CrisisTimelineChart({
  data,
  currentWeekIndex,
  reconfigurationWeekIndex = null,
  height = 190,
  onSeek,
}: CrisisTimelineChartProps) {
  const chartData = data.map((d, i) => ({
    ...d,
    index: i,
    label: formatWeekLabel(d.weekStart),
    week: i + 1,
  }));

  const peakIndex = chartData.reduce((best, d, i) => (d.lost > chartData[best].lost ? i : best), 0);
  const peak = chartData[peakIndex];
  const startIndex = chartData.findIndex((d) => d.lost > 0);
  const current = chartData[currentWeekIndex];
  const maxLost = Math.max(...chartData.map((d) => d.lost), 0.01);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        margin={{ top: 22, right: 12, left: -26, bottom: 0 }}
        onClick={(state) => {
          if (!onSeek) return;
          const i = state?.activeTooltipIndex;
          if (typeof i === "number") onSeek(i);
        }}
        style={onSeek ? { cursor: "pointer" } : undefined}
      >
        <defs>
          <linearGradient id="crisisFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d33f28" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#d33f28" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="week"
          tick={{ fontSize: 9.5, fill: "#9aa4b3" }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
          tickFormatter={(w) => `sem. ${w}`}
        />
        <YAxis
          tick={{ fontSize: 9.5, fill: "#9aa4b3" }}
          width={34}
          axisLine={false}
          tickLine={false}
          domain={[0, Math.ceil(maxLost * 10) / 10]}
        />
        <Tooltip
          contentStyle={{ fontSize: 11.5, borderRadius: 8, border: "1px solid #e4e8ef" }}
          labelFormatter={(w) => `Semana ${w} · ${chartData[Number(w) - 1]?.label ?? ""}`}
          formatter={(value) => [`${Number(value).toFixed(2)} semanas de operación`, "se pierde"]}
        />

        <Area
          type="monotone"
          dataKey="lost"
          name="operación perdida"
          stroke="#d33f28"
          strokeWidth={2}
          fill="url(#crisisFill)"
        />

        {/* Peor momento de la crisis. */}
        {peak && peak.lost > 0 && (
          <ReferenceDot
            x={peak.week}
            y={peak.lost}
            r={4}
            fill="#d33f28"
            stroke="#fff"
            strokeWidth={1.5}
            label={{
              value: "peor momento",
              position: "top",
              fontSize: 9.5,
              fill: "#c23a24",
            }}
          />
        )}

        {/* Arranque de la disrupción. */}
        {startIndex > 0 && (
          <ReferenceLine
            x={chartData[startIndex].week}
            stroke="#c3cede"
            strokeDasharray="3 3"
            label={{ value: "empieza", position: "insideTopLeft", fontSize: 9, fill: "#8c96a6" }}
          />
        )}

        {/* Momento en que se reconfiguró — de ahí en más el déficit cae de golpe. */}
        {reconfigurationWeekIndex !== null && chartData[reconfigurationWeekIndex] && (
          <ReferenceLine
            x={chartData[reconfigurationWeekIndex].week}
            stroke="#0d9c84"
            strokeWidth={1.6}
            label={{ value: "se reconfigura", position: "top", fontSize: 9.5, fill: "#0a7d6a" }}
          />
        )}

        {/* Semana que se está viendo en la red, para que el gráfico y el mapa cuenten lo mismo. */}
        {current && (
          <ReferenceLine x={current.week} stroke="#0060ff" strokeWidth={1.6} ifOverflow="extendDomain" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
