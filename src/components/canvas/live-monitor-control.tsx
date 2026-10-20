"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { formatWeekLabel } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

/** Un tick por segundo, como pide el spec: 1 segundo real = 1 semana simulada (a velocidad ×1). */
const TICK_MS = 1000;
const SPEEDS = [1, 2, 4] as const;

/**
 * Monitoreo vivo del Digital Twin. El reloj lo maneja el navegador (Vercel no sostiene un proceso
 * continuo): cada tick pide al servidor las semanas siguientes y el canvas se actualiza solo, porque
 * colorea los nodos a partir de las filas que hay en el store.
 */
export function LiveMonitorControl({ chainId }: { chainId: string }) {
  const advanceChain = useAppStore((s) => s.advanceChain);
  const resetMonitoring = useAppStore((s) => s.resetMonitoring);
  const nodes = useAppStore((s) => s.nodes);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // El bucle lee la velocidad desde una ref: cambiarla no reinicia el bucle ni pierde el ritmo.
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const chainNodeIds = useMemo(() => new Set(nodes.filter((n) => n.chainId === chainId).map((n) => n.id)), [nodes, chainId]);
  const latestWeek = useMemo(() => {
    let latest = "";
    for (const row of weeklyPerformance) {
      if (chainNodeIds.has(row.nodeId) && row.weekStart > latest) latest = row.weekStart;
    }
    return latest;
  }, [weeklyPerformance, chainNodeIds]);

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const startedAt = Date.now();
      const result = await advanceChain(chainId, speedRef.current);
      if (cancelled) return;
      if (!result.ok) {
        setPlaying(false);
        setNotice(
          result.code === "max_weeks"
            ? "Se alcanzó el máximo de semanas simuladas. Reiniciá para volver al historial original."
            : result.code === "no_history"
              ? "Esta cadena todavía no tiene historial de desempeño."
              : result.error,
        );
        return;
      }
      // Descuenta lo que tardó el servidor: el ritmo es de un tick por segundo, no un segundo MÁS la espera.
      timer = setTimeout(tick, Math.max(0, TICK_MS - (Date.now() - startedAt)));
    };

    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, chainId, advanceChain]);

  async function handleReset() {
    setBusy(true);
    setNotice(null);
    const result = await resetMonitoring(chainId);
    setBusy(false);
    if (!result.ok) setNotice(result.error);
  }

  const noNodes = chainNodeIds.size === 0;

  return (
    <div className="flex flex-none items-center gap-2">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card">
        <button
          onClick={() => {
            setNotice(null);
            setPlaying((p) => !p);
          }}
          disabled={noNodes || busy}
          title={playing ? "Pausar el monitoreo" : "Avanzar el tiempo simulado: una semana por segundo"}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] whitespace-nowrap disabled:opacity-50",
            playing ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
          )}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? "Pausar" : "Tiempo real"}
        </button>
        <div className="flex items-center border-l border-border">
          {SPEEDS.map((value) => (
            <button
              key={value}
              onClick={() => setSpeed(value)}
              title={`${value} ${value === 1 ? "semana" : "semanas"} por segundo`}
              className={cn(
                "px-2 py-1.5 font-mono text-[11px]",
                speed === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              ×{value}
            </button>
          ))}
        </div>
        <button
          onClick={handleReset}
          disabled={playing || busy || noNodes}
          title="Reiniciar: vuelve al historial original"
          className="border-l border-border px-2.5 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {latestWeek && (
        <span className="font-mono text-[10.5px] whitespace-nowrap text-muted-foreground" title="Semana simulada más reciente: puede pasar de la fecha de hoy">
          sem. simulada {formatWeekLabel(latestWeek)}
        </span>
      )}
      {notice && <span className="max-w-[260px] text-[11px] leading-tight text-destructive">{notice}</span>}
    </div>
  );
}
