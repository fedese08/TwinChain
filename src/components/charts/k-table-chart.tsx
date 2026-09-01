"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { KTableRow } from "@/lib/mock/types";

export function KTableChart({ rows }: { rows: KTableRow[] }) {
  const data = rows.map((r) => ({ k: `k=${r.k}`, umbral: r.threshold ?? 0, existe: r.threshold !== null }));

  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
        <XAxis dataKey="k" tick={{ fontSize: 10, fill: "#9aa4b3" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#9aa4b3" }} width={28} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(value, _name, item) =>
            item?.payload?.existe ? [Number(value).toFixed(1), "umbral"] : ["no existe umbral", ""]
          }
        />
        <Bar dataKey="umbral" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.existe ? "#3a5bd9" : "#e4e8ef"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
