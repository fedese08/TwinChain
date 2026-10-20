"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { formatWeekLabel } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

/** Cada cuánto llega un dato nuevo de los sensores simulados: un tick = una semana simulada. */
const INTERVALS_MIN = [1, 5, 10] as const;
type IntervalMin = (typeof INTERVALS_MIN)[number];
const DEFAULT_INTERVAL: IntervalMin = 1;
const STORAGE_KEY = "twinchain:monitor-interval-min";

function readStoredInterval(): IntervalMin {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return (INTERVALS_MIN as readonly number[]).includes(stored) ? (stored as IntervalMin) : DEFAULT_INTERVAL;
  } catch {
    return DEFAULT_INTERVAL;
  }
}

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Monitoreo vivo del Digital Twin. Arranca solo, apenas se abre la cadena, y pide una semana nueva de datos
 * (sensores simulados) cada 1, 5 o 10 minutos, a elección. El reloj lo maneja el navegador (Vercel no sostiene un
 * proceso continuo): mientras la pantalla está abierta, cada tick pide al servidor la semana siguiente y el canvas se
 * actualiza solo, porque colorea los nodos a partir de las filas que hay en el store. Si se cierra la pestaña, el
 * monitoreo se detiene: no hay un proceso en el servidor que siga generando datos.
 */
export function LiveMonitorControl({ chainId }: { chainId: string }) {
  const advanceChain = useAppStore((s) => s.advanceChain);
  const resetMonitoring = useAppStore((s) => s.resetMonitoring);
  const nodes = useAppStore((s) => s.nodes);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);

  const [playing, setPlaying] = useState(true);
  const [intervalMin, setIntervalMin] = useState<IntervalMin>(DEFAULT_INTERVAL);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Cuándo se pide la próxima semana; null si está pausado. */
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // La preferencia se lee después de montar (localStorage no existe en el servidor).
  useEffect(() => {
    setIntervalMin(readStoredInterval());
  }, []);

  const chainNodeIds = useMemo(() => new Set(nodes.filter((n) => n.chainId === chainId).map((n) => n.id)), [nodes, chainId]);
  const noNodes = chainNodeIds.size === 0;
  const latestWeek = useMemo(() => {
    let latest = "";
    for (const row of weeklyPerformance) {
      if (chainNodeIds.has(row.nodeId) && row.weekStart > latest) latest = row.weekStart;
    }
    return latest;
  }, [weeklyPerformance, chainNodeIds]);

  useEffect(() => {
    if (!playing || noNodes) {
      setNextAt(null);
      return;
    }
    const intervalMs = intervalMin * 60_000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      setNextAt(Date.now() + intervalMs);
      timer = setTimeout(tick, intervalMs);
    };
    const tick = async () => {
      setNextAt(null);
      const result = await advanceChain(chainId, 1);
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
      schedule();
    };

    // La primera semana nueva llega al cumplirse el intervalo, no al abrir la pantalla: así no se suma una semana
    // cada vez que se entra a la cadena.
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, noNodes, intervalMin, chainId, advanceChain]);

  // Refresca la cuenta regresiva una vez por segundo, solo mientras hay una espera en curso.
  useEffect(() => {
    if (nextAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextAt]);

  function chooseInterval(value: IntervalMin) {
    setIntervalMin(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Sin almacenamiento disponible la elección rige igual para esta sesión.
    }
  }

  async function handleReset() {
    setBusy(true);
    setNotice(null);
    const result = await resetMonitoring(chainId);
    setBusy(false);
    if (!result.ok) setNotice(result.error);
  }

  return (
    <div className="flex flex-none items-center gap-2">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card">
        <button
          onClick={() => {
            setNotice(null);
            setPlaying((p) => !p);
          }}
          disabled={noNodes || busy}
          title={playing ? "Pausar el monitoreo" : "Retomar el monitoreo: una semana de datos nueva en cada intervalo"}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] whitespace-nowrap disabled:opacity-50",
            playing ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
          )}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? "Pausar" : "Tiempo real"}
        </button>
        <div className="flex items-center border-l border-border">
          {INTERVALS_MIN.map((value) => (
            <button
              key={value}
              onClick={() => chooseInterval(value)}
              title={`Un dato nuevo cada ${value} ${value === 1 ? "minuto" : "minutos"}`}
              className={cn(
                "px-2 py-1.5 font-mono text-[11px]",
                intervalMin === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {value} min
            </button>
          ))}
        </div>
        <button
          onClick={handleReset}
          disabled={playing || busy || noNodes}
          title="Reiniciar: vuelve al historial original (pausá primero)"
          className="border-l border-border px-2.5 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {playing && nextAt !== null && (
        <span className="font-mono text-[10.5px] whitespace-nowrap text-muted-foreground" title="Cuándo llega la próxima semana de datos">
          próxima en {formatCountdown(nextAt - now)}
        </span>
      )}
      {latestWeek && (
        <span className="font-mono text-[10.5px] whitespace-nowrap text-muted-foreground" title="Semana simulada más reciente: puede pasar de la fecha de hoy">
          sem. simulada {formatWeekLabel(latestWeek)}
        </span>
      )}
      {notice && <span className="max-w-[260px] text-[11px] leading-tight text-destructive">{notice}</span>}
    </div>
  );
}
