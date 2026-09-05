"use client";

import { useEffect, useMemo, useState } from "react";
import { ChainCanvas } from "@/components/canvas/chain-canvas";
import { classifySeverity, type ProjectedWeek, type Severity } from "@/lib/mock/simulate";
import type { SupplyChainEdge, SupplyChainNode } from "@/lib/mock/types";

/** Antes de arrancar la animación — un mini loading que estira la transición entre el form y la red. */
const INITIAL_LOADING_MS = 850;
/** Más lento que antes a propósito: tiene que alcanzar para ver el spread avanzando, no un parpadeo. */
const MS_PER_WEEK = 950;
/** Piso por semana cuando el pico cae tarde y hay que comprimir el avance. */
const MIN_MS_PER_WEEK = 420;
/**
 * Techo del tramo de avance. Sin esto, un escenario cuyo peor momento cae en la semana 13 dejaba
 * la intro corriendo ~16 s antes de mostrar el resultado.
 */
const SPREAD_BUDGET_MS = 6500;
/**
 * Cuánto se sostiene la vista en el peor momento antes de pasar al resultado. Equivale a un par
 * de "semanas" más de pantalla en crisis máxima, no solo una pausa corta. Es fijo a propósito:
 * aunque el avance se comprima, la crisis máxima siempre se ve el mismo tiempo.
 */
const HOLD_AT_PEAK_MS = MS_PER_WEEK * 2.6;

interface SimulationIntroProps {
  chainId: string;
  chainNodes: Pick<SupplyChainNode, "id">[];
  chainEdges: Pick<SupplyChainEdge, "id" | "sourceNodeId">[];
  projectionByNode: Map<string, ProjectedWeek[]>;
  /** Última semana que se anima: el peor momento, no todo el horizonte. */
  peakWeekIndex: number;
  onDone: () => void;
}

/**
 * Reproduce la propagación sobre la red mientras el motor termina de calcular: avanza semana
 * a semana desde el arranque hasta el peor momento y recién ahí da paso al resultado.
 * Sustituye al spinner — mostrar la disrupción moviéndose por la cadena dice mucho más que
 * una ruedita girando.
 */
export function SimulationIntro({
  chainId,
  chainNodes,
  chainEdges,
  projectionByNode,
  peakWeekIndex,
  onDone,
}: SimulationIntroProps) {
  const [phase, setPhase] = useState<"loading" | "playing">("loading");
  const [week, setWeek] = useState(0);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setPhase("playing"), INITIAL_LOADING_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Con un pico cercano cada semana dura MS_PER_WEEK; con uno lejano el paso se acorta para que
  // todo el avance entre en el presupuesto, sin bajar del piso legible.
  const stepMs =
    peakWeekIndex > 0
      ? Math.max(MIN_MS_PER_WEEK, Math.min(MS_PER_WEEK, SPREAD_BUDGET_MS / peakWeekIndex))
      : MS_PER_WEEK;

  useEffect(() => {
    if (phase !== "playing") return;
    if (week >= peakWeekIndex) {
      const hold = setTimeout(onDone, HOLD_AT_PEAK_MS);
      return () => clearTimeout(hold);
    }
    const timer = setTimeout(() => setWeek((w) => w + 1), stepMs);
    return () => clearTimeout(timer);
  }, [phase, week, peakWeekIndex, stepMs, onDone]);

  const severityByNode = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const node of chainNodes) {
      map[node.id] = classifySeverity(projectionByNode.get(node.id)?.[week]?.deficit ?? 0);
    }
    return map;
  }, [chainNodes, projectionByNode, week]);

  const severityByEdge = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const edge of chainEdges) map[edge.id] = severityByNode[edge.sourceNodeId] ?? "none";
    return map;
  }, [chainEdges, severityByNode]);

  if (phase === "loading") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        <div className="text-[13.5px] font-medium">Preparando la simulación…</div>
      </div>
    );
  }

  return (
    // Solo la red: sin cabecera ni barra de progreso. Lo único que tiene que mirarse acá es
    // cómo se va tiñendo la cadena.
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-background px-5 py-6">
      <div className="flex h-full max-h-[560px] w-full max-w-[980px] overflow-hidden rounded-2xl border border-border bg-card">
        <ChainCanvas
          chainId={chainId}
          mode="display"
          severityByNode={severityByNode}
          severityByEdge={severityByEdge}
        />
      </div>
    </div>
  );
}
