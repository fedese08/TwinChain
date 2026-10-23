"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, BellRing, Eye, History } from "lucide-react";
import { useSystemAlerts } from "@/hooks/use-system-alerts";
import type { AlertKind, SystemAlert } from "@/lib/domain/alerts";
import { formatWeekLabel } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";

type Tab = "vigentes" | "historial";

const KIND_META: Record<AlertKind, { title: string; icon: typeof Activity }> = {
  sostenida: { title: "Degradación sostenida", icon: AlertTriangle },
  vigilancia: { title: "Desvío en vigilancia", icon: Eye },
  bajo_esperado: { title: "Por debajo de lo esperado", icon: Activity },
  historial: { title: "Cambió el comportamiento del historial", icon: History },
};

const SEVERITY_STYLE = {
  critico: { label: "Crítica", chip: "border-[#f3b9ad] bg-[#fdf1ee] text-[#b3361f]", bar: "bg-[#c8452d]" },
  atencion: { label: "Atención", chip: "border-[#f5d9a8] bg-[#fdf6e8] text-[#8a5a0a]", bar: "bg-[#d99a1b]" },
  pasada: { label: "Resuelta", chip: "border-border bg-muted text-muted-foreground", bar: "bg-border" },
} as const;

const deficitText = (alert: SystemAlert) => {
  if (alert.accumulatedDeficit === undefined) return null;
  const value = alert.accumulatedDeficit.toFixed(1).replace(".", ",");
  return alert.unit === "dias" ? `${value} días` : `${value} puntos`;
};

function describe(alert: SystemAlert): string {
  const since = alert.since ? formatWeekLabel(alert.since) : null;
  switch (alert.kind) {
    case "sostenida": {
      const weeks = alert.weeks ? `${alert.weeks} ${alert.weeks === 1 ? "semana" : "semanas"}` : "";
      const deficit = deficitText(alert);
      const period = alert.active ? `Se sostiene desde el ${since}${weeks ? ` (${weeks})` : ""}` : `Del ${since} al ${formatWeekLabel(alert.until ?? alert.since ?? "")}${weeks ? ` (${weeks})` : ""}`;
      return `${period}${deficit ? ` · ${deficit} de déficit acumulado` : ""}.`;
    }
    case "vigilancia":
      return `El desempeño viene por debajo de lo esperado desde el ${since}, pero todavía no alcanza para confirmar una degradación sostenida (lleva el ${Math.round((alert.fractionOfThreshold ?? 0) * 100)} % del umbral).`;
    case "bajo_esperado":
      return `El desempeño de las últimas semanas está ${deficitText(alert) ? `${deficitText(alert)} ` : ""}por debajo de lo esperado para este nodo.`;
    case "historial":
      return `${alert.unstableNodes} de ${alert.totalNodes} nodos cambiaron de nivel en su historial${since ? `, desde el ${since}` : ""}: su línea base puede no ser confiable.`;
  }
}

function AlertCard({ alert }: { alert: SystemAlert }) {
  const meta = KIND_META[alert.kind];
  const Icon = meta.icon;
  const style = SEVERITY_STYLE[alert.severity];
  return (
    <div className="flex overflow-hidden rounded-2xl border border-border bg-card">
      <div className={cn("w-1 flex-none", style.bar)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Icon size={14} className="flex-none text-muted-foreground" />
          <span className="text-[13.5px] font-medium">{meta.title}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-medium", style.chip)}>{style.label}</span>
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {alert.chainName}
          {alert.nodeLabel && (
            <>
              {" › "}
              <span className="font-mono font-medium text-foreground">{alert.nodeLabel}</span>
              {alert.nodeType ? ` · ${alert.nodeType}` : ""}
            </>
          )}
        </div>
        <p className="text-[12.5px] leading-relaxed">{describe(alert)}</p>
        <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[12px]">
          <Link href={`/cadenas/${alert.chainId}`} className="text-primary hover:underline">
            Ver la cadena
          </Link>
          {alert.kind === "sostenida" && alert.active && alert.nodeId && (
            <Link href={`/cadenas/${alert.chainId}?alerta=${alert.nodeId}`} className="text-primary hover:underline">
              Simular cómo sigue
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const alerts = useSystemAlerts();
  const [tab, setTab] = useState<Tab>("vigentes");

  const current = useMemo(() => alerts.filter((a) => a.active), [alerts]);
  const past = useMemo(() => alerts.filter((a) => !a.active), [alerts]);
  const shown = tab === "vigentes" ? current : past;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">Alertas</div>
          <div className="text-[12.5px] text-muted-foreground">
            Los eventos importantes que detecta el monitoreo en tus cadenas, de lo más grave y reciente a lo más antiguo.
          </div>
        </div>

        <div className="flex w-fit items-center overflow-hidden rounded-lg border border-border bg-card">
          {(
            [
              ["vigentes", `Vigentes (${current.length})`],
              ["historial", `Historial (${past.length})`],
            ] as const
          ).map(([value, label], index) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "px-3.5 py-1.5 text-[12.5px]",
                index > 0 && "border-l border-border",
                tab === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
            <BellRing size={20} className="text-muted-foreground" />
            <div className="text-[13.5px] font-medium">{tab === "vigentes" ? "No hay alertas vigentes" : "Todavía no hay alertas pasadas"}</div>
            <div className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
              {tab === "vigentes"
                ? "Todos los nodos están dentro de lo esperado. Cuando el sistema detecte una degradación sostenida, la vas a ver acá."
                : "Cuando una degradación se resuelva, queda registrada acá."}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
