"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { SEVERITY_COLOR } from "@/lib/mock/node-visuals";
import type { Severity } from "@/lib/mock/simulate";

export function TransitEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const edgeData = data as { transitTimeDays?: number; severity?: Severity } | undefined;
  const severityColors = edgeData?.severity ? SEVERITY_COLOR[edgeData.severity] : null;

  const stroke = severityColors ? severityColors.stroke : selected ? "#3a5bd9" : "#c3cede";
  const strokeWidth = severityColors ? (edgeData?.severity === "severe" ? 2.6 : 2) : selected ? 2 : 1.5;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke, strokeWidth }} />
      <EdgeLabelRenderer>
        <div
          className="absolute rounded-full border bg-card px-1.5 py-0.5 font-mono text-[9.5px]"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: severityColors ? severityColors.border : selected ? "#3a5bd9" : "var(--border)",
            color: severityColors ? severityColors.stroke : selected ? "#2b47bb" : "#616b7c",
            pointerEvents: "all",
          }}
        >
          {edgeData?.transitTimeDays}d
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
