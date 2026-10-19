"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_CODE, NODE_TYPE_COLOR, SEVERITY_COLOR } from "@/lib/domain/node-visuals";
import type { Severity } from "@/lib/domain/simulate";
import type { NodeHealthLevel } from "@/lib/domain/monitoring";
import { formatPerformance, type PerformanceUnit } from "@/lib/domain/units";
import type { NodeType } from "@/lib/domain/types";

export interface SupplyChainNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  detail: string;
  /** Déficit medio de las últimas semanas, en la unidad del nodo (puntos porcentuales o días). */
  recentDeficit: number;
  unit: PerformanceUnit;
  /** Estado del nodo respecto de su propia variabilidad (ver `domain/monitoring.ts`). */
  health: NodeHealthLevel;
  highlighted?: boolean;
  severity?: Severity;
}

function SupplyChainNodeComponent({ data }: NodeProps) {
  const { label, nodeType, detail, recentDeficit, unit, health, highlighted, severity } = data as unknown as SupplyChainNodeData;
  const color = NODE_TYPE_COLOR[nodeType];
  // La barra del nodo se vacía con el déficit reciente: 20 puntos (escala 0-100) o 2 días de margen perdidos.
  const deficitRatio = Math.min(1, unit === "dias" ? recentDeficit / 2 : recentDeficit / 20);
  const healthColor = health === "critico" ? "#d33f28" : health === "atencion" ? "#f2703c" : null;

  const severityColors = severity ? SEVERITY_COLOR[severity] : null;
  const borderColor = severityColors ? severityColors.border : (healthColor ?? "var(--border)");
  const background = severityColors ? severityColors.fill : "var(--card)";

  return (
    <div
      className="h-[86px] w-[150px] rounded-[9px] border px-2.5 py-2 shadow-sm transition-colors"
      style={{
        borderColor,
        background,
        borderWidth: highlighted ? 2 : 1,
        boxShadow: highlighted ? "0 0 0 3px rgba(59,130,246,.2)" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: color }} />
        <span className="min-w-0 truncate font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          {NODE_TYPE_CODE[nodeType]}
        </span>
        {highlighted && (
          <span className="ml-auto flex h-[13px] w-[13px] items-center justify-center rounded-full bg-primary text-[8px] text-white">
            ✓
          </span>
        )}
        {!highlighted && !severityColors && healthColor && (
          // No es un valor negativo: es el déficit reciente (línea_base − valor_real, nunca negativo por
          // definición del modelo). Solo aparece cuando es raro PARA ESTE NODO (ver `assessNode`): con una
          // línea base estimada, una semana floja por ruido da 2–3 puntos en cualquier nodo volátil.
          <span
            className="ml-auto flex-none rounded-sm px-1 py-[1px] font-mono text-[8.5px] font-medium whitespace-nowrap"
            style={{ color: healthColor, background: `${healthColor}1a` }}
            title={`Déficit promedio de las últimas semanas: ${formatPerformance(recentDeficit, unit)} por debajo de la línea base esperada`}
          >
            déf. −{formatPerformance(recentDeficit, unit, unit === "dias" ? 1 : 0).replace(" %", "%")}
          </span>
        )}
      </div>
      <div className="mt-1.5 font-mono text-[14.5px] leading-tight font-medium">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground">{detail}</div>
      <div className="mt-1.5 h-[3px] rounded-sm bg-muted">
        {!severityColors && (
          <div
            className="h-[3px] rounded-sm"
            style={{ width: `${Math.round((1 - deficitRatio) * 100)}%`, background: healthColor ?? color }}
          />
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

export const SupplyChainNodeView = memo(SupplyChainNodeComponent);
