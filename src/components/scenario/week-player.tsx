"use client";

import { useEffect } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

interface WeekPlayerProps {
  weekIndex: number;
  weekCount: number;
  /** Etiqueta legible de la semana actual (ej. "30-ago"). */
  weekLabel?: string;
  playing: boolean;
  onWeekIndexChange: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
  /** Milisegundos por semana mientras corre. */
  stepMs?: number;
}

/**
 * Controles de reproducción para recorrer el horizonte semana a semana: play/pausa,
 * avanzar y retroceder de a una, y volver al principio. Al llegar al final se detiene solo.
 */
export function WeekPlayer({
  weekIndex,
  weekCount,
  weekLabel,
  playing,
  onWeekIndexChange,
  onPlayingChange,
  stepMs = 700,
}: WeekPlayerProps) {
  const lastIndex = Math.max(0, weekCount - 1);
  const atStart = weekIndex <= 0;
  const atEnd = weekIndex >= lastIndex;

  useEffect(() => {
    if (!playing) return;
    if (weekIndex >= lastIndex) {
      onPlayingChange(false);
      return;
    }
    const timer = setTimeout(() => onWeekIndexChange(weekIndex + 1), stepMs);
    return () => clearTimeout(timer);
  }, [playing, weekIndex, lastIndex, stepMs, onWeekIndexChange, onPlayingChange]);

  function togglePlay() {
    // Si ya está al final, volver a arrancar desde el principio.
    if (!playing && atEnd) onWeekIndexChange(0);
    onPlayingChange(!playing);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar" : "Reproducir"}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85"
      >
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
      </button>

      <button
        type="button"
        onClick={() => {
          onPlayingChange(false);
          onWeekIndexChange(Math.max(0, weekIndex - 1));
        }}
        disabled={atStart}
        aria-label="Semana anterior"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <SkipBack size={13} />
      </button>

      <button
        type="button"
        onClick={() => {
          onPlayingChange(false);
          onWeekIndexChange(Math.min(lastIndex, weekIndex + 1));
        }}
        disabled={atEnd}
        aria-label="Semana siguiente"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <SkipForward size={13} />
      </button>

      <button
        type="button"
        onClick={() => {
          onPlayingChange(false);
          onWeekIndexChange(0);
        }}
        disabled={atStart}
        aria-label="Volver al principio"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <RotateCcw size={12} />
      </button>

      {/* Puntitos de progreso: dan el avance de un vistazo y permiten saltar a una semana. */}
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-[3px]">
        {Array.from({ length: weekCount }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              onPlayingChange(false);
              onWeekIndexChange(i);
            }}
            aria-label={`Semana ${i + 1}`}
            className={cn(
              "h-1.5 min-w-0 flex-1 rounded-full transition-colors",
              i === weekIndex ? "bg-primary" : i < weekIndex ? "bg-primary/30" : "bg-border",
            )}
          />
        ))}
      </div>

      <span className="w-[92px] flex-none text-right font-mono text-[11px] text-muted-foreground">
        sem. {weekIndex + 1}/{weekCount}
        {weekLabel ? ` · ${weekLabel}` : ""}
      </span>
    </div>
  );
}
