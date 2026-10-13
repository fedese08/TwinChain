"use client";

import { use, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChainCanvas } from "@/components/canvas/chain-canvas";
import { DeleteChainButton } from "@/components/canvas/delete-chain-dialog";
import { ScenarioForm, type ScenarioFormHandle } from "@/components/scenario/scenario-form";
import { useChainStatus } from "@/hooks/use-chain-status";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

type Mode = "design" | "simulate";

export default function ChainDetailPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = use(params);
  const [mode, setMode] = useState<Mode>("design");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const scenarioFormRef = useRef<ScenarioFormHandle>(null);

  const chain = useAppStore((s) => s.chains.find((c) => c.id === chainId));
  const stability = useChainStatus(chainId)?.stability ?? null;
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
        {/* C24: verificación de estabilidad estructural del historial, derivada de los datos de la cadena.
            El nombre del mecanismo (CUSUM) no se muestra: es jerga para quien opera la cadena. */}
        {stability && (
          <div
            className="flex flex-none items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"
            title={
              stability.status === "alerta"
                ? `${stability.unstableNodeCount} de ${stability.nodeCount} nodos cambiaron de nivel en su historial: la línea base de esos nodos puede no ser confiable`
                : "El historial de todos los nodos es estable: la línea base se pudo congelar sin problemas"
            }
          >
            <span
              className="rounded border px-1 py-0.5"
              style={
                stability.status === "alerta"
                  ? { borderColor: "#f5c9a8", color: "#c2571f" }
                  : { borderColor: "#b9e2d8", color: "#0a7d6a" }
              }
            >
              {stability.status === "alerta" ? "cambió el comportamiento" : "historial estable"}
            </span>
            {stability.status === "alerta" && stability.changePointWeek ? `desde ${stability.changePointWeek}` : null}
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
