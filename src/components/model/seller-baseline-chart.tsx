"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeekState } from "@/lib/ml-client";
import type { SellerExploration } from "@/lib/olist/explore";

const STATE_COLOR: Record<WeekState, string> = { normal: "#0a7d6a", por_debajo: "#d33f28", por_encima: "#3b82f6" };
const STATE_LABEL: Record<WeekState, string> = {
  normal: "dentro de la banda",
  por_debajo: "por debajo de la banda",
  por_encima: "por encima de la banda",
};

interface ChartPoint {
  label: string;
  margen: number;
  fase: 1 | 2;
  estado: WeekState | null;
  linea?: number;
  bandaSemanal?: [number, number];
  bandaPromedio?: [number, number];
}

const LEGEND = [
  { name: "margen semanal real", color: "#171922", kind: "line" as const },
  { name: "línea base", color: "#0a7d6a", kind: "dashed" as const },
  { name: "banda del promedio", color: "#0d9c84", kind: "area" as const, strong: true },
  { name: "banda semanal", color: "#0d9c84", kind: "area" as const },
];

/**
 * Margen de despacho real de un vendedor, la línea base y las dos bandas del modelo. El eje X son semanas CON
 * ACTIVIDAD del vendedor (S1, S2…): no son semanas calendario consecutivas, que es como el modelo las define.
 */
export function SellerBaselineChart({ exploration, height = 300 }: { exploration: SellerExploration; height?: number }) {
  const { prediction: p } = exploration;
  const data: ChartPoint[] = exploration.weeks.map((w) => ({
    label: `S${w.n}`,
    margen: w.margen,
    fase: w.fase,
    estado: w.estado,
    ...(w.fase === 2
      ? {
          linea: p.linea_base,
          bandaSemanal: [p.banda_semanal_inferior, p.banda_semanal_superior] as [number, number],
          bandaPromedio: [p.banda_inferior, p.banda_superior] as [number, number],
        }
      : {}),
  }));
  const lastPhase1 = data.filter((d) => d.fase === 1).at(-1)?.label;

  const renderDot = (props: { cx?: number; cy?: number; index?: number; payload?: ChartPoint }) => {
    const { cx, cy, index, payload } = props;
    if (cx === undefined || cy === undefined || !payload) return <g key={`dot-${index}`} />;
    const color = payload.estado ? STATE_COLOR[payload.estado] : "#9aa4b3";
    return <circle key={`dot-${index}`} cx={cx} cy={cy} r={payload.estado ? 3.8 : 3} fill={color} stroke="#fff" strokeWidth={1} />;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9aa4b3" }} interval={0} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: "#9aa4b3" }}
            width={38}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `${v} d`}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e4e8ef" }}
            formatter={(value, name) =>
              Array.isArray(value)
                ? [`${Number(value[0]).toFixed(2)} a ${Number(value[1]).toFixed(2)} d`, name]
                : [`${Number(value).toFixed(2)} d`, name]
            }
          />
          {lastPhase1 && (
            <ReferenceArea
              x1={data[0].label}
              x2={lastPhase1}
              fill="#9aa4b3"
              fillOpacity={0.12}
              label={{ value: "Fase I: estima la línea base", fontSize: 10, fill: "#616b7c", position: "insideTop" }}
            />
          )}
          <Area type="monotone" dataKey="bandaSemanal" name="banda semanal" fill="#0d9c84" fillOpacity={0.08} stroke="#0d9c84" strokeOpacity={0.25} strokeWidth={1} />
          <Area type="monotone" dataKey="bandaPromedio" name="banda del promedio" fill="#0d9c84" fillOpacity={0.18} stroke="#0d9c84" strokeOpacity={0.5} strokeWidth={1} />
          <Line type="monotone" dataKey="linea" name="línea base" stroke="#0a7d6a" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
          <Line type="monotone" dataKey="margen" name="margen semanal real" stroke="#171922" strokeWidth={1.6} dot={renderDot} activeDot={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 pl-1 text-[10.5px] text-muted-foreground">
        {LEGEND.map((item) => (
          <span key={item.name} className="flex items-center gap-1.5">
            {item.kind === "area" ? (
              <span
                className="h-2.5 w-3.5 rounded-[2px] border"
                style={{ background: item.color, opacity: item.strong ? 0.4 : 0.2, borderColor: item.color }}
              />
            ) : (
              <span className="h-0 w-3.5" style={{ borderTop: `2px ${item.kind === "dashed" ? "dashed" : "solid"} ${item.color}` }} />
            )}
            {item.name}
          </span>
        ))}
        {(Object.keys(STATE_COLOR) as WeekState[]).map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR[state] }} />
            {STATE_LABEL[state]}
          </span>
        ))}
      </div>
    </div>
  );
}
