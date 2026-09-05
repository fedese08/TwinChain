"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ComparisonSeries {
  id: string;
  name: string;
  color: string;
  /** Operación perdida por semana, en semanas equivalentes. */
  perWeek: number[];
}

/**
 * Superpone la curva de crisis de varios escenarios para verlos lado a lado:
 * qué tan alto pega cada uno y en qué momento.
 */
export function ScenarioComparisonChart({ series, height = 240 }: { series: ComparisonSeries[]; height?: number }) {
  const weekCount = Math.max(0, ...series.map((s) => s.perWeek.length));
  const data = Array.from({ length: weekCount }, (_, i) => {
    const point: Record<string, number | string> = { week: i + 1 };
    for (const s of series) point[s.id] = s.perWeek[i] ?? 0;
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: -24, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f6" vertical={false} />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 9.5, fill: "#9aa4b3" }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
          tickFormatter={(w) => `sem. ${w}`}
        />
        <YAxis tick={{ fontSize: 9.5, fill: "#9aa4b3" }} width={34} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 11.5, borderRadius: 8, border: "1px solid #e4e8ef" }}
          labelFormatter={(w) => `Semana ${w}`}
          formatter={(value, name) => [`${Number(value).toFixed(2)} semanas perdidas`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {series.map((s) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
