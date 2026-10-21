"use client";

import { FALSE_ALARM_COST_CHOICES, thresholdForCost } from "@/lib/domain/cusum-config";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const LABELS: Record<number, string> = { 0: "Máxima", 1: "Alta", 2: "Media", 3: "Baja" };

/**
 * Sensibilidad de la alerta de la cadena (HU1: umbral configurable). Lo que se elige es cuánto cuesta una falsa alarma,
 * en semanas de operar degradado (RF019): con 0 no importa avisar de más y el detector es el más sensible; con 3, que
 * es lo que cuesta reconfigurar, avisa solo cuando la degradación está bien establecida. El umbral del CUSUM sale de la
 * calibración sobre vendedores reales de Olist.
 */
export function DetectionSettings({ chainId }: { chainId: string }) {
  const cost = useAppStore((s) => s.chains.find((c) => c.id === chainId)?.falseAlarmCost);
  const setFalseAlarmCost = useAppStore((s) => s.setFalseAlarmCost);
  if (cost === undefined) return null;

  return (
    <div
      className="flex flex-none items-center gap-2"
      title={`Sensibilidad de la alerta de degradación sostenida. Es cuánto cuesta una falsa alarma, en semanas de operar degradado: ${cost}. Umbral del CUSUM: ${thresholdForCost(cost).toFixed(1)} veces el margen de la línea base.`}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Sensibilidad</span>
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card">
        {FALSE_ALARM_COST_CHOICES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => void setFalseAlarmCost(chainId, value)}
            title={`Una falsa alarma cuesta ${value} ${value === 1 ? "semana" : "semanas"} de operar degradado · umbral ${thresholdForCost(value).toFixed(1)}×`}
            className={cn(
              "border-l border-border px-2 py-1.5 text-[11px] first:border-l-0",
              cost === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {LABELS[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
