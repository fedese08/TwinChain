"use client";

import { useMemo } from "react";
import { useChainStatuses } from "@/hooks/use-chain-status";
import { buildSystemAlerts, type SystemAlert } from "@/lib/domain/alerts";
import { useAppStore } from "@/stores/app-store";

/** Alertas de todas las cadenas visibles, derivadas de lo que hay en el store (no se guardan en ningún lado). */
export function useSystemAlerts(): SystemAlert[] {
  const chains = useAppStore((s) => s.chains);
  const nodes = useAppStore((s) => s.nodes);
  const rows = useAppStore((s) => s.weeklyPerformance);
  const statuses = useChainStatuses();

  return useMemo(
    () => buildSystemAlerts({ chains, nodes, rows, stabilityByChain: new Map([...statuses].map(([id, s]) => [id, s.stability])) }),
    [chains, nodes, rows, statuses],
  );
}
