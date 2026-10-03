"use client";

import { use, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChainCanvas } from "@/components/canvas/chain-canvas";
import { DeleteChainButton } from "@/components/canvas/delete-chain-dialog";
import { ScenarioForm, type ScenarioFormHandle } from "@/components/scenario/scenario-form";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

type Mode = "design" | "simulate";

export default function ChainDetailPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = use(params);
  const [mode, setMode] = useState<Mode>("design");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const scenarioFormRef = useRef<ScenarioFormHandle>(null);

  const chain = useAppStore((s) => s.chains.find((c) => c.id === chainId));
  const stabilityCheck = useAppStore((s) => s.stabilityChecks[chainId]);
  const canWrite = useAppStore((s) => s.canWrite);
  const nodes = useAppStore((s) => s.nodes);
  const chainNodes = useMemo(() => nodes.filter((n) => n.chainId === chainId), [nodes, chainId]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    scenarioFormRef.current?.selectNode(nodeId);
  }, []);

  const highlightedNodeIds = useMemo(() => (selectedNodeId ? [selectedNodeId] : []), [selectedNodeId]);

  if (!chain) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Cadena no encontrada. <Link href="/cadenas" className="ml-1 text-primary">Volver a cadenas</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[54px] flex-none items-center gap-3 border-b border-border bg-card px-3.5">
        <Link href="/cadenas" className="flex flex-none items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground">
          <span className="font-mono text-[13px]">‹</span>Cadenas
        </Link>
        <div className="h-5 w-px flex-none bg-border" />
        <div className="min-w-0 truncate text-[14.5px] font-medium">{chain.name}</div>
        {/* C24: el pipeline de ingesta valida la estabilidad estructural de cada cadena nueva.
            El nombre del mecanismo (CUSUM) no se muestra: es jerga para quien opera la cadena. */}
        {stabilityCheck && (
          <div className="flex flex-none items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
            {stabilityCheck.status === "corriendo" ? (
              <>
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
                revisando historial…
              </>
            ) : (
              <span
                className="rounded border px-1 py-0.5"
                style={
                  stabilityCheck.status === "alerta"
                    ? { borderColor: "#f5c9a8", color: "#c2571f" }
                    : { borderColor: "#b9e2d8", color: "#0a7d6a" }
                }
              >
                {stabilityCheck.status === "alerta" ? "cambió el comportamiento" : "desempeño estable"}
              </span>
            )}
          </div>
        )}
        <div className="flex-1" />

        <div className="flex flex-none items-center gap-px overflow-hidden rounded-lg border border-border bg-card">
          <button
            onClick={() => setMode("design")}
            className={cn(
              "px-3.5 py-1.5 text-[12.5px] whitespace-nowrap",
              mode === "design" ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            Diseño y monitoreo
          </button>
          <button
            onClick={() => setMode("simulate")}
            className={cn(
              "border-l border-border px-3.5 py-1.5 text-[12.5px] whitespace-nowrap",
              mode === "simulate" ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            Simulación
          </button>
        </div>

        {mode === "simulate" && (
          <Link
            href={`/cadenas/${chainId}/escenarios`}
            className="flex-none whitespace-nowrap rounded-lg border border-border px-3.5 py-1.5 text-[12.5px] hover:bg-muted"
          >
            Ver simulaciones
          </Link>
        )}

        {canWrite && <DeleteChainButton chainId={chainId} chainName={chain.name} />}
      </div>

      {mode === "design" ? (
        // Sin permiso de escritura el canvas se muestra tal cual, sin paleta ni edición.
        <ChainCanvas chainId={chainId} mode={canWrite ? "edit" : "display"} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ScenarioForm
            ref={scenarioFormRef}
            chainId={chainId}
            chainNodes={chainNodes}
            onSelectedNodeChange={setSelectedNodeId}
          />
          <div className="flex min-w-0 flex-1">
            <ChainCanvas chainId={chainId} mode="select" selectedNodeIds={highlightedNodeIds} onNodeSelect={handleNodeSelect} />
          </div>
        </div>
      )}
    </div>
  );
}
