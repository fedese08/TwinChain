"use client";

import { useMemo } from "react";
import { assessChain, assessOptionsFor, type AssessOptions, type ChainHealth } from "@/lib/domain/monitoring";
import { deriveChainStability, TRAINING_WEEKS, type ChainStability } from "@/lib/domain/synthetic";
import type { WeeklyPerformance } from "@/lib/domain/types";
import { useAppStore } from "@/stores/app-store";

export interface ChainStatus {
  /** Verificación de estabilidad estructural (C24); `null` si todavía no hay historial que evaluar. */
  stability: ChainStability | null;
  /** Estado operativo actual: cuántos nodos están en atención o críticos. */
  health: ChainHealth;
}

/**
 * Estado de cada cadena, DERIVADO de las filas de desempeño que ya están en el store: no se guarda en
 * ningún lado (no es una entidad del modelo). Se recalcula solo cuando entran nodos o semanas nuevas.
 */
export function useChainStatuses(): Map<string, ChainStatus> {
  const chains = useAppStore((s) => s.chains);
  const nodes = useAppStore((s) => s.nodes);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);

  return useMemo(() => {
    const nodeToChain = new Map(nodes.map((n) => [n.id, n.chainId]));
    const rowsByChain = new Map<string, Map<string, WeeklyPerformance[]>>();
    for (const chain of chains) rowsByChain.set(chain.id, new Map());
    for (const node of nodes) rowsByChain.get(node.chainId)?.set(node.id, []);
    for (const row of weeklyPerformance) {
      const chainId = nodeToChain.get(row.nodeId);
      if (chainId) rowsByChain.get(chainId)?.get(row.nodeId)?.push(row);
    }

    // C24 valida la ventana larga sobre la que se congela la línea base de un nodo sintético. Los Vendedores
    // reales tienen una línea base de 4 semanas (la del modelo): esa verificación no les corresponde.
    const realNodeIds = new Set(nodes.filter((n) => n.olistSellerId).map((n) => n.id));

    const result = new Map<string, ChainStatus>();
    for (const [chainId, byNode] of rowsByChain) {
      const syntheticRows = [...byNode].filter(([nodeId]) => !realNodeIds.has(nodeId)).flatMap(([, rows]) => rows);
      const chain = chains.find((c) => c.id === chainId);
      const options = new Map<string, AssessOptions>(
        nodes.filter((n) => n.chainId === chainId).map((n) => [n.id, assessOptionsFor(n, chain)]),
      );
      result.set(chainId, { stability: deriveChainStability(syntheticRows, TRAINING_WEEKS), health: assessChain(byNode, options) });
    }
    return result;
  }, [chains, nodes, weeklyPerformance]);
}

export function useChainStatus(chainId: string): ChainStatus | undefined {
  return useChainStatuses().get(chainId);
}
