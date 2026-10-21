"use client";

import { Area, ComposedChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWeekLabel } from "@/lib/domain/dates";
import type { SimulatedAlertTimeline } from "@/lib/domain/simulation-alerts";

const LEVEL_LABEL = { normal: "normal", atencion: "en vigilancia", alerta: "alerta confirmada" } as const;

/**
 * Cómo evoluciona, semana a semana, el desvío acumulado de un nodo y cuándo saltaría la alerta (HU3). El eje es el acumulado
 * del CUSUM como porcentaje del umbral: al llegar a 100 % se confirma la degradación sostenida.
 */
export function AlertEvolutionChart({ timeline, height = 130 }: { timeline: SimulatedAlertTimeline; height?: number }) {
  const data = timeline.weeks.map((w, i) => ({ ...w, week: i + 1, label: formatWeekLabel(w.weekStart), pct: Math.min(w.accumulated * 100, 160) }));
  const confirmed = data.filter((d) => d.confirmed);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="alertFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c2571f" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#c2571f" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "#9aa4b3" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9.5, fill: "#9aa4b3" }} width={36} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 130]} ticks={[0, 50, 100]} />
        <ReferenceLine y={100} stroke="#c2571f" strokeDasharray="4 3" strokeWidth={1} label={{ value: "alerta", position: "insideTopRight", fontSize: 9.5, fill: "#c2571f" }} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
          formatter={(_value, _name, item) => [`${Math.round(item.payload.accumulated * 100)} % del umbral · ${LEVEL_LABEL[item.payload.level as keyof typeof LEVEL_LABEL]}`, "desvío acumulado"]}
          labelFormatter={(label, payload) => `Semana ${payload?.[0]?.payload?.week ?? ""} · ${label}`}
        />
        <Area type="monotone" dataKey="pct" stroke="#c2571f" strokeWidth={1.6} fill="url(#alertFill)" isAnimationActive={false} />
        {confirmed.slice(0, 1).map((d) => (
          <ReferenceDot key={d.week} x={d.label} y={Math.min(d.pct, 130)} r={4} fill="#c2571f" stroke="#fff" strokeWidth={1.5} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
