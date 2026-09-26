"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/stores/app-store";
import type { SupplyChainEdge } from "@/lib/mock/types";

export function EdgeInspector({ edge, onClose }: { edge: SupplyChainEdge; onClose: () => void }) {
  const nodes = useAppStore((s) => s.nodes);
  const removeEdge = useAppStore((s) => s.removeEdge);
  const updateEdge = useAppStore((s) => s.updateEdge);

  const source = nodes.find((n) => n.id === edge.sourceNodeId);
  const target = nodes.find((n) => n.id === edge.targetNodeId);

  function handleTransitTimeChange(value: string) {
    const parsed = Number(value);
    // Debe ser > 0: la base rechaza un tránsito de 0 días.
    if (value === "" || Number.isNaN(parsed) || parsed <= 0) return;
    updateEdge(edge.id, { transitTimeDays: parsed });
  }

  return (
    <div className="flex w-[300px] flex-none flex-col overflow-auto border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
        <span className="font-mono text-[13px] font-medium">{source?.label}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono text-[13px] font-medium">{target?.label}</span>
      </div>

      <div className="flex flex-col gap-3.5 p-3.5">
        <div className="flex flex-col gap-1.5">
          <Label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Tiempo de tránsito (días)
          </Label>
          <Input
            key={edge.id}
            type="number"
            min={0}
            defaultValue={edge.transitTimeDays}
            onChange={(e) => handleTransitTimeChange(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          El tránsito vive en la arista, no en un nodo — sin costo asociado: el modelo no registra magnitudes
          monetarias en ningún punto del sistema.
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            removeEdge(edge.id);
            onClose();
          }}
        >
          <Trash2 className="mr-1.5" size={13} />
          Eliminar arista
        </Button>
      </div>
    </div>
  );
}
