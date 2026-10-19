"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MlStatus } from "@/app/api/ml/estado/route";
import { SellerBaselineChart } from "@/components/model/seller-baseline-chart";
import { Button } from "@/components/ui/button";
import type { ModelInfo } from "@/lib/ml-client";
import type { SellerExploration } from "@/lib/olist/explore";
import type { OlistSampleMeta, SellerListItem } from "@/lib/olist/sample";
import { cn } from "@/lib/utils";

const days = (value: number) => `${value.toFixed(2)} d`;
const percent = (value: number) => `${(value * 100).toFixed(1)} %`;

function StatusPill({ status, onRetry }: { status: MlStatus | null; onRetry: () => void }) {
  if (!status) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
        verificando el servicio…
      </span>
    );
  }
  const ok = status.status === "ok";
  const label =
    status.status === "ok"
      ? `conectado · ${status.health.version ?? "?"} · ${status.health.bundle_sha256.slice(0, 8)}`
      : status.status === "no_configurado"
        ? "servicio no configurado"
        : status.status === "sin_respuesta"
          ? "sin respuesta"
          : status.status === "clave_invalida"
            ? "clave de API inválida"
            : "con errores";
  return (
    <span className="flex items-center gap-2 font-mono text-[11px]">
      <span className="flex items-center gap-1.5 rounded border px-1.5 py-0.5" style={{ borderColor: ok ? "#b9e2d8" : "#f5c9a8", color: ok ? "#0a7d6a" : "#c2571f" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? "#0d9c84" : "#f2703c" }} />
        {label}
      </span>
      {!ok && (
        <button onClick={onRetry} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <RefreshCw size={11} /> reintentar
        </button>
      )}
    </span>
  );
}

function ServiceHelp({ status }: { status: MlStatus }) {
  if (status.status === "ok") return null;
  const text =
    status.status === "no_configurado"
      ? "Definí ML_SERVICE_URL (y ML_API_KEY, si el servicio la exige) en el entorno de la app. Para probarlo en tu máquina: cd twinchain-ml, instalá requirements.txt y levantá `uvicorn api:app --port 8001`."
      : status.status === "sin_respuesta"
        ? `${status.message}. Si el servicio está en el plan gratuito de Render se duerme tras unos 15 minutos sin uso: el primer pedido tarda hasta un minuto en despertarlo.`
        : status.message;
  return <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">{text}</div>;
}

function ModelCard({ info }: { info: ModelInfo }) {
  const random = info.metricas_validacion_aleatoria;
  const temporal = info.metricas_validacion_temporal;
  const rows: { label: string; a: string; b: string }[] = [
    { label: "Error medio de la línea base (días)", a: days(random["MAE línea base"]), b: days(temporal["MAE línea base"]) },
    { label: "Error del método ingenuo (media de Fase I)", a: days(random["MAE ingenuo (media Fase I)"]), b: days(temporal["MAE ingenuo (media Fase I)"]) },
    { label: "La banda del promedio cubre (promete 80 %)", a: percent(random["cobertura CQR (promedio)"]), b: percent(temporal["cobertura CQR (promedio)"]) },
    { label: "La banda semanal cubre (promete 80 %)", a: percent(random["cobertura semanal con banda semanal"]), b: percent(temporal["cobertura semanal con banda semanal"]) },
    { label: "Semanas por debajo de la banda semanal", a: percent(random["alarmas semanales (debajo de banda semanal)"]), b: percent(temporal["alarmas semanales (debajo de banda semanal)"]) },
  ];
  const weakTemporal = temporal["cobertura CQR (promedio)"] < 0.75;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 text-[13.5px] font-medium">Qué tan bien anda el modelo</div>
      <div className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Medido sobre vendedores que el modelo no vio al entrenar: {random["n_test"]} en la validación aleatoria y {temporal["n_test"]} en la temporal
        (entrenar con los vendedores más viejos y probar con los más nuevos, que es como se usaría en producción).
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1.5 text-left font-medium" />
            <th className="py-1.5 text-right font-medium">aleatoria</th>
            <th className="py-1.5 text-right font-medium">temporal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-b-0">
              <td className="py-1.5 pr-3">{row.label}</td>
              <td className="py-1.5 text-right font-mono">{row.a}</td>
              <td className="py-1.5 text-right font-mono">{row.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {weakTemporal && (
        <div className="mt-3 rounded-lg border border-[#f5c9a8] bg-[#fdf5ec] px-3 py-2 text-[11.5px] leading-relaxed text-[#8a4313]">
          En la validación temporal la banda del promedio cubre solo el {percent(temporal["cobertura CQR (promedio)"])}, no el 80 % que promete: los vendedores más nuevos
          tienen pocas semanas de Fase II y su promedio es muy ruidoso. La banda <b>semanal</b> no sufre eso, y por eso es la que se usa para vigilar semana a semana.
        </div>
      )}
    </div>
  );
}

export function ModelExplorer({ sellers, meta }: { sellers: SellerListItem[]; meta: OlistSampleMeta }) {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exploration, setExploration] = useState<SellerExploration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);

  const loadStatus = useCallback(async () => {
    setStatus(null);
    try {
      const response = await fetch("/api/ml/estado");
      setStatus(response.ok ? ((await response.json()) as MlStatus) : { status: "error", message: "No se pudo consultar el estado del servicio" });
    } catch {
      setStatus({ status: "error", message: "No se pudo consultar el estado del servicio" });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function selectSeller(id: string) {
    const mine = ++ticket.current;
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ml/vendedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: id }),
      });
      const body = await response.json();
      if (mine !== ticket.current) return;
      if (!response.ok) {
        setExploration(null);
        setError((body as { error?: string }).error ?? "No se pudo evaluar al vendedor");
      } else {
        setExploration(body as SellerExploration);
      }
    } catch {
      if (mine === ticket.current) {
        setExploration(null);
        setError("No se pudo conectar con la app");
      }
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }

  const ready = status?.status === "ok";
  const e = exploration;
  const modelWins = e ? e.baselineErrorDays < e.naiveErrorDays : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none flex-wrap items-start gap-3 px-5 pt-5 pb-3.5">
        <div className="flex flex-col gap-1">
          <div className="text-[21px] font-semibold tracking-tight">Modelo de línea base</div>
          <div className="max-w-[640px] text-[12.5px] leading-relaxed text-muted-foreground">
            Dado un vendedor real, el modelo estima cuánto margen de despacho debería tener a partir de <b>sus propias primeras 4 semanas</b> con actividad
            (nada de región ni categoría: RF017), y le pone una banda de incertidumbre. Después compara cada semana nueva contra esa banda.
          </div>
        </div>
        <div className="flex-1" />
        <StatusPill status={status} onRetry={loadStatus} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-5">
        <div className="flex w-[210px] flex-none flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Vendedores reales · {sellers.length}
          </div>
          <div className="flex-1 overflow-auto p-1.5">
            {sellers.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSeller(s.id)}
                disabled={!ready}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-mono text-[11.5px] disabled:opacity-50",
                  selectedId === s.id ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted/60",
                )}
              >
                <span>{s.shortId}</span>
                <span className="text-[10px] text-muted-foreground">{s.weeks} sem.</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
          {status && <ServiceHelp status={status} />}

          {ready && !e && !loading && !error && (
            <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-[12.5px] text-muted-foreground">
              Elegí un vendedor de la lista. Todos son del conjunto de prueba: el modelo no los vio al entrenar ni al calibrar.
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-6 text-[12.5px] text-muted-foreground">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
              Consultando al modelo… si el servicio estaba dormido, puede tardar hasta un minuto.
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-3 rounded-xl border border-[#f5c9a8] bg-[#fdf5ec] px-4 py-3 text-[12.5px] text-[#8a4313]">
              <span className="flex-1">{error}</span>
              {selectedId && (
                <Button variant="outline" size="sm" onClick={() => selectSeller(selectedId)}>
                  Reintentar
                </Button>
              )}
            </div>
          )}

          {e && !loading && (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-[14px] font-medium">{e.shortId}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {e.weeks.length} semanas con actividad · eje X: semanas con actividad, no calendario consecutivo · unidad: días de margen contra el plazo de despacho
                  </span>
                </div>
                <SellerBaselineChart exploration={e} />
              </div>

              <div className="grid grid-cols-4 gap-2.5">
                {[
                  { label: "Línea base", value: days(e.prediction.linea_base), note: "estimada con las 4 primeras semanas" },
                  { label: "Banda del promedio", value: `${e.prediction.banda_inferior.toFixed(2)} a ${e.prediction.banda_superior.toFixed(2)}`, note: "donde debería caer el promedio" },
                  { label: "Banda semanal", value: `${e.prediction.banda_semanal_inferior.toFixed(2)} a ${e.prediction.banda_semanal_superior.toFixed(2)}`, note: "donde debería caer cada semana" },
                  {
                    label: "Semanas fuera",
                    value: `${e.summary.por_debajo + e.summary.por_encima} de ${e.summary.semanas}`,
                    note: `${e.summary.por_debajo} por debajo · ${e.summary.por_encima} por encima`,
                  },
                ].map((card) => (
                  <div key={card.label} className="rounded-xl border border-border bg-card px-3.5 py-3">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{card.label}</div>
                    <div className="mt-0.5 font-mono text-[17px] leading-tight font-medium">{card.value}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">{card.note}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] leading-relaxed">
                El promedio real de la Fase II fue <b className="font-mono">{days(e.phase2Mean)}</b>. El modelo había estimado{" "}
                <b className="font-mono">{days(e.prediction.linea_base)}</b> (error <span className="font-mono">{days(e.baselineErrorDays)}</span>) y el método ingenuo,
                que es repetir la media de Fase I, <b className="font-mono">{days(e.phase1Mean)}</b> (error <span className="font-mono">{days(e.naiveErrorDays)}</span>).{" "}
                {modelWins
                  ? "En este vendedor el modelo acertó mejor."
                  : "En este vendedor el método ingenuo acertó igual o mejor: el modelo no gana en todos los casos, gana en promedio."}{" "}
                El promedio real {e.phase2MeanInBand ? "cayó dentro" : "cayó fuera"} de la banda del promedio.
              </div>
            </>
          )}

          {status?.status === "ok" && <ModelCard info={status.info} />}

          <div className="pb-1 text-[10.5px] leading-relaxed text-muted-foreground">
            Datos: {meta.fuente} ({meta.licencia}). {meta.particion}. {meta.criterio}; {meta.muestra}.
          </div>
        </div>
      </div>
    </div>
  );
}
