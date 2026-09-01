"use client";

import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWeekLabel } from "@/lib/mock/dates";

export interface WeeklyChartPoint {
  weekStart: string;
  actualValue: number;
  baseline: number;
  deficit: number;
}

export function WeeklyPerformanceChart({ data, height = 150 }: { data: WeeklyChartPoint[]; height?: number }) {
  const chartData = data.map((d) => ({ ...d, label: formatWeekLabel(d.weekStart) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "#9aa4b3" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9.5, fill: "#9aa4b3" }} width={30} axisLine={false} tickLine={false} domain={[0, 100]} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(value, name) => [Number(value).toFixed(1), name]}
        />
        <Area type="monotone" dataKey="deficit" name="déficit" fill="#fdeeeb" stroke="none" />
        <Line type="monotone" dataKey="baseline" name="línea base" stroke="#0d9c84" strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
        <Line type="monotone" dataKey="actualValue" name="valor real" stroke="#3a5bd9" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
