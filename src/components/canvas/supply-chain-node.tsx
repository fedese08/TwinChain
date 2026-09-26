"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_TYPE_CODE, NODE_TYPE_COLOR, SEVERITY_COLOR } from "@/lib/mock/node-visuals";
import type { Severity } from "@/lib/mock/simulate";
import type { NodeType } from "@/lib/mock/types";

export interface SupplyChainNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  detail: string;
  latestDeficit: number;
  highlighted?: boolean;
  severity?: Severity;
}

function SupplyChainNodeComponent({ data }: NodeProps) {
  const { label, nodeType, detail, latestDeficit, highlighted, severity } = data as unknown as SupplyChainNodeData;
  const color = NODE_TYPE_COLOR[nodeType];
  const deficitRatio = Math.min(1, latestDeficit / 20);

  const severityColors = severity ? SEVERITY_COLOR[severity] : null;
  const borderColor = severityColors ? severityColors.border : deficitRatio > 0.5 ? "#f2703c" : "var(--border)";
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
        {!highlighted && !severityColors && latestDeficit > 2 && (
          // No es un valor negativo: es el déficit de la última semana (línea_base − valor_real,
          // nunca negativo por definición del modelo). El "−" es solo una marca visual de
          // pérdida — antes iba sin ninguna etiqueta y se leía como un número negativo suelto.
          <span
            className="ml-auto flex-none rounded-sm bg-destructive/10 px-1 py-[1px] font-mono text-[8.5px] font-medium whitespace-nowrap text-destructive"
            title={`Déficit de la última semana: ${latestDeficit.toFixed(1)}% por debajo de la línea base esperada`}
          >
            déf. −{latestDeficit.toFixed(0)}%
          </span>
        )}
      </div>
      <div className="mt-1.5 font-mono text-[14.5px] leading-tight font-medium">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground">{detail}</div>
      <div className="mt-1.5 h-[3px] rounded-sm bg-muted">
        {!severityColors && (
          <div
            className="h-[3px] rounded-sm"
            style={{ width: `${Math.round((1 - deficitRatio) * 100)}%`, background: deficitRatio > 0.5 ? "#f2703c" : color }}
          />
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

export const SupplyChainNodeView = memo(SupplyChainNodeComponent);
