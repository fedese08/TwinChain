"use client";

import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { KTableRow } from "@/lib/mock/types";

export function KTableChart({ rows }: { rows: KTableRow[] }) {
  const data = rows.map((r) => ({
    k: `k=${r.k}`,
    umbral: r.thresholdMedian ?? 0,
    existe: r.thresholdMedian !== null,
    // Offsets hacia cada extremo del rango observado entre réplicas (RF029).
    rango:
      r.thresholdMedian !== null && r.thresholdLow !== null && r.thresholdHigh !== null
        ? ([r.thresholdMedian - r.thresholdLow, r.thresholdHigh - r.thresholdMedian] as [number, number])
        : ([0, 0] as [number, number]),
    low: r.thresholdLow,
    high: r.thresholdHigh,
  }));

  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
        <XAxis dataKey="k" tick={{ fontSize: 10, fill: "#9aa4b3" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#9aa4b3" }} width={28} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(value, _name, item) =>
            item?.payload?.existe
              ? [
                  `${Number(value).toFixed(1)} (rango ${Number(item.payload.low).toFixed(1)}–${Number(item.payload.high).toFixed(1)})`,
                  "umbral mediano",
                ]
              : ["no existe umbral", ""]
          }
        />
        <Bar dataKey="umbral" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.existe ? "#3b82f6" : "#e4e8ef"} />
          ))}
          <ErrorBar dataKey="rango" width={4} strokeWidth={1.2} stroke="#616b7c" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
