"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ComparisonSeries {
  id: string;
  name: string;
  color: string;
  /** Pérdida de operación ACUMULADA hasta cada semana, en semanas equivalentes (mediana y rango p10–p90). */
  cumulative: { median: number; low: number; high: number }[];
}

/**
 * Superpone la pérdida acumulada de varios escenarios: cuánta operación se lleva perdida hasta cada semana.
 * La separación entre las líneas es lo que se gana o se evita eligiendo una decisión u otra, y el último punto de
 * cada línea es el mismo número que muestran las barras de arriba.
 */
export function ScenarioComparisonChart({ series, height = 280 }: { series: ComparisonSeries[]; height?: number }) {
  const weekCount = Math.max(0, ...series.map((s) => s.cumulative.length));
  // Semana 0 = punto de partida: todavía no se perdió nada.
  const data = Array.from({ length: weekCount + 1 }, (_, i) => {
    const point: Record<string, number | number[]> = { week: i };
    for (const s of series) {
      const p = i === 0 ? { median: 0, low: 0, high: 0 } : (s.cumulative[i - 1] ?? s.cumulative[s.cumulative.length - 1]);
      point[s.id] = p?.median ?? 0;
      point[`${s.id}__range`] = [p?.low ?? 0, p?.high ?? 0];
    }
    return point;
  });
  const lastWeek = weekCount;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 14, right: 44, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f6" vertical={false} />
        <XAxis
          dataKey="week"
          type="number"
          domain={[0, lastWeek]}
          tick={{ fontSize: 10, fill: "#9aa4b3" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(w) => (w === 0 ? "hoy" : `sem. ${w}`)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#9aa4b3" }}
          width={30}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 11.5, borderRadius: 8, border: "1px solid #e4e8ef" }}
          labelFormatter={(w) => (w === 0 ? "Punto de partida" : `Hasta la semana ${w}`)}
          formatter={(value, name) => [`${Number(value).toFixed(1)} semanas perdidas`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {series.map((s) => (
          <Area
            key={`${s.id}-range`}
            dataKey={`${s.id}__range`}
            stroke="none"
            fill={s.color}
            fillOpacity={0.1}
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            name={s.name}
            stroke={s.color}
            strokeWidth={2.5}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; value?: number }) =>
              props.index === lastWeek && props.cx !== undefined && props.cy !== undefined ? (
                <g key={`${s.id}-end`}>
                  <circle cx={props.cx} cy={props.cy} r={4} fill={s.color} />
                  <text x={props.cx + 8} y={props.cy + 4} fontSize={12} fontWeight={600} fill={s.color}>
                    {Number(props.value ?? 0).toFixed(1)}
                  </text>
                </g>
              ) : (
                <g key={`${s.id}-${props.index}`} />
              )
            }
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
