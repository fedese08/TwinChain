"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatWeekLabel } from "@/lib/domain/dates";

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

  const legend = [
    { name: "valor real", color: "#171922", kind: "line" as const },
    { name: "línea base", color: "#0a7d6a", kind: "dashed" as const },
    { name: "banda esperada", color: "#0d9c84", kind: "area" as const },
    { name: "déficit", color: "#f2703c", kind: "area" as const },
    ...(hasReplicaRange ? [{ name: "rango simulado", color: "#3b82f6", kind: "area" as const }] : []),
  ];

  return (
    <div className="flex flex-col gap-1">
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f6" vertical={false} />
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
        {/* Rellenos con borde propio y opacidad: sobre el fondo blanco de la tarjeta los tonos
            planos muy claros se perdían y la banda y el déficit no se leían. */}
        <Area
          type="monotone"
          dataKey="bandaLineaBase"
          name="banda de la línea base"
          fill="#0d9c84"
          fillOpacity={0.16}
          stroke="#0d9c84"
          strokeOpacity={0.35}
          strokeWidth={1}
        />
        {hasReplicaRange && (
          <Area
            type="monotone"
            dataKey="rangoReplicas"
            name="rango entre réplicas"
            fill="#3b82f6"
            fillOpacity={0.14}
            stroke="#3b82f6"
            strokeOpacity={0.3}
            strokeWidth={1}
          />
        )}
        <Area
          type="monotone"
          dataKey="deficit"
          name="déficit"
          fill="#f2703c"
          fillOpacity={0.22}
          stroke="#f2703c"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
        <Line type="monotone" dataKey="baseline" name="línea base" stroke="#0a7d6a" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
        <Line type="monotone" dataKey="actualValue" name="valor real" stroke="#171922" strokeWidth={2.2} dot={false} />
        {reconfigurationLabel && (
          <ReferenceLine
            x={reconfigurationLabel}
            stroke="#f2703c"
            strokeDasharray="3 3"
            label={{ value: "reconfiguración", fontSize: 9, fill: "#f2703c", position: "insideTopRight" }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>

      {/* Leyenda propia: la de Recharts ocupa demasiado alto para estos gráficos chicos. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[10px] text-muted-foreground">
        {legend.map((item) => (
          <span key={item.name} className="flex items-center gap-1.5">
            {item.kind === "area" ? (
              <span
                className="h-2.5 w-3.5 rounded-[2px] border"
                style={{ background: item.color, opacity: 0.3, borderColor: item.color }}
              />
            ) : (
              <span
                className="h-0 w-3.5"
                style={{
                  borderTop: `2px ${item.kind === "dashed" ? "dashed" : "solid"} ${item.color}`,
                }}
              />
            )}
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}
