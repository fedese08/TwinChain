"use client";

import { NODE_TYPES } from "@/lib/mock/types";
import { NODE_TYPE_CODE, NODE_TYPE_COLOR } from "@/lib/mock/node-visuals";
import { MAX_NODES_PER_CHAIN } from "@/lib/mock/types";
import type { NodeType } from "@/lib/mock/types";

export function NodePalette({
  nodeCount,
  edgeCount,
  onAddNode,
}: {
  nodeCount: number;
  edgeCount: number;
  onAddNode: (type: NodeType) => void;
}) {
  const atLimit = nodeCount >= MAX_NODES_PER_CHAIN;

  return (
    <div className="flex w-[204px] flex-none flex-col overflow-auto border-r border-border bg-card">
      <div className="px-3 pb-2 pt-3 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
        Tipos de nodo · 5
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-3">
        {NODE_TYPES.map((type) => (
          <button
            key={type}
            disabled={atLimit}
            onClick={() => onAddNode(type)}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="h-2 w-2 flex-none rounded-sm" style={{ background: NODE_TYPE_COLOR[type] }} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[12.5px]">{type}</span>
              <span className="font-mono text-[9.5px] text-muted-foreground">{NODE_TYPE_CODE[type]}</span>
            </span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">+</span>
          </button>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-border px-3 py-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">Modelo</div>
        <div className="flex justify-between text-[11.5px] text-muted-foreground">
          <span>Nodos</span>
          <span className="font-mono text-foreground">
            {nodeCount} / {MAX_NODES_PER_CHAIN}
          </span>
        </div>
        <div className="h-1 rounded-full bg-muted">
          <div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, (nodeCount / MAX_NODES_PER_CHAIN) * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[11.5px] text-muted-foreground">
          <span>Aristas</span>
          <span className="font-mono text-foreground">{edgeCount}</span>
        </div>
      </div>
    </div>
  );
}
