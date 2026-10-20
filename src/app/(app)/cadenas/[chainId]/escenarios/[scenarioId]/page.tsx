"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import { DeleteScenarioDialog } from "@/components/scenario/delete-scenario-dialog";
import { WeeklyPerformanceChart } from "@/components/charts/weekly-performance-chart";
import { CrisisTimelineChart } from "@/components/charts/crisis-timeline-chart";
import { WeekPlayer } from "@/components/scenario/week-player";
import { SimulationIntro } from "@/components/scenario/simulation-intro";
import { KTableChart } from "@/components/charts/k-table-chart";
import { ChainCanvas } from "@/components/canvas/chain-canvas";
import { Button } from "@/components/ui/button";
import {
  classifySeverity,
  observedForScenario,
  replayRun,
  runScenarioSimulation,
  shareWorthwhile,
  thresholdAtK,
  type ProjectedWeek,
  type Severity,
} from "@/lib/domain/simulate";
import { CENTRAL_PROPAGATION_FRACTION, fractionsOf, PROPAGATION_FRACTIONS, rowsForFraction } from "@/lib/domain/k-table";
import { formatWeekLabel } from "@/lib/domain/dates";
import { adaptForEngine, type EngineAdapter } from "@/lib/domain/units";
import { hashSeed } from "@/lib/domain/rng";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type View = "answer" | "detail";

/** Franjas de impacto sobre el horizonte proyectado — para traducir el déficit a algo legible. */
function classifyImpact(badWeeks: number, horizonWeeks: number) {
  const share = horizonWeeks > 0 ? badWeeks / horizonWeeks : 0;
  if (share >= 0.25) return { label: "Impacto alto", tone: "#c2571f", bg: "#fdece0", border: "#f5c9a8" };
  if (share >= 0.1) return { label: "Impacto moderado", tone: "#a8761f", bg: "#fdf5e7", border: "#eddbb4" };
  return { label: "Impacto bajo", tone: "#0a7d6a", bg: "#e8f6f3", border: "#b9e2d8" };
}

/** La proyección del motor está en escala relativa; para un nodo en días se vuelve a las unidades del nodo. */
function toDisplayUnits(adapter: EngineAdapter, nodeId: string, week: ProjectedWeek): ProjectedWeek {
  const d = (v: number) => adapter.toDisplay(nodeId, v);
  return {
    ...week,
    baseline: d(week.baseline),
    baselineLowerBand: d(week.baselineLowerBand),
    baselineUpperBand: d(week.baselineUpperBand),
    actualValue: d(week.actualValue),
    actualValueLow: d(week.actualValueLow),
    actualValueHigh: d(week.actualValueHigh),
    deficit: d(week.deficit),
    deficitLow: d(week.deficitLow),
    deficitHigh: d(week.deficitHigh),
  };
}

export default function ScenarioResultPage({
  params,
}: {
  params: Promise<{ chainId: string; scenarioId: string }>;
}) {
  const { chainId, scenarioId } = use(params);
  const chain = useAppStore((s) => s.chains.find((c) => c.id === chainId));
  const scenario = useAppStore((s) => s.scenarios.find((sc) => sc.id === scenarioId));
  const allEvents = useAppStore((s) => s.events);
  const events = useMemo(() => allEvents.filter((e) => e.scenarioId === scenarioId), [allEvents, scenarioId]);
  const allResults = useAppStore((s) => s.results);
  const allNodes = useAppStore((s) => s.nodes);
  const allEdges = useAppStore((s) => s.edges);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);
  const pendingRuns = useAppStore((s) => s.pendingRuns);
  const rerunScenario = useAppStore((s) => s.rerunScenario);
  const canRun = useAppStore((s) => s.canRun);

  const router = useRouter();
  const [view, setView] = useState<View>("answer");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Cada corrida se conserva por separado y no se pisa (RF030). Se muestran de la más nueva a
  // la más vieja — el orden del array es el orden en que las escribió el job.
  const runs = useMemo(
    () => allResults.filter((r) => r.scenarioId === scenarioId).reverse(),
    [allResults, scenarioId],
  );
  const isRunning = pendingRuns.some((r) => r.scenarioId === scenarioId);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const knownRunIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const ids = runs.map((r) => r.id);
    const known = knownRunIdsRef.current;
    const justFinished = ids.find((id) => !known.includes(id));
    knownRunIdsRef.current = ids;

    if (justFinished && known.length > 0) setSelectedRunId(justFinished);
    else if (ids.length > 0 && !ids.includes(selectedRunId ?? "")) setSelectedRunId(ids[0]);
  }, [runs, selectedRunId]);
  const result = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;

  const chainNodes = useMemo(() => allNodes.filter((n) => n.chainId === chainId), [allNodes, chainId]);
  const chainNodeIds = useMemo(() => new Set(chainNodes.map((n) => n.id)), [chainNodes]);
  const chainEdges = useMemo(
    () => allEdges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId)),
    [allEdges, chainNodeIds],
  );

  // Los nodos Vendedor con datos reales están en días: el motor los recibe en escala relativa a su línea base
  // (domain/units.ts). Los nodos en 0-100 pasan sin tocar, así que sus resultados no cambian.
  const adapter = useMemo(() => adaptForEngine(chainNodes, weeklyPerformance), [chainNodes, weeklyPerformance]);

  // Se reproduce la corrida guardada con su propia semilla: mismo seed, mismas réplicas,
  // mismo resultado que el que quedó registrado.
  const outcome = useMemo(() => {
    if (!scenario || !result) return null;
    return replayRun({
      nodes: chainNodes,
      edges: chainEdges,
      events,
      rows: adapter.rows,
      horizonWeeks: scenario.projectionHorizonWeeks,
      decisionWeek: scenario.decisionWeek,
      run: result,
    });
  }, [chainNodes, chainEdges, events, adapter, scenario, result]);

  // La animación de entrada solo corre en la primera corrida del escenario: al volver a abrir
  // uno ya calculado se entra derecho al resultado.
  const introEligibleRef = useRef<boolean | null>(null);
  if (introEligibleRef.current === null) introEligibleRef.current = runs.length === 0;
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);
  const playingIntro = Boolean(introEligibleRef.current) && !introDone;

  /**
   * Pasada liviana con el mismo motor, solo para animar la propagación sobre la red. No se
   * guarda ni se muestra como resultado: es la vista previa que reemplaza al spinner.
   *
   * Depende de que la intro siga corriendo, **no** de que falte `result`. Antes se anulaba
   * apenas el job escribía la fila de Resultado (~1,6 s), así que la animación se cortaba de
   * golpe a mitad de camino y alargar sus tiempos no tenía ningún efecto visible.
   */
  const previewOutcome = useMemo(() => {
    if (!scenario || !playingIntro || events.length === 0) return null;
    return runScenarioSimulation(chainNodes, chainEdges, events, adapter.rows, scenario.projectionHorizonWeeks, {
      seed: hashSeed(scenario.id),
      replications: 12,
      decisionWeek: scenario.decisionWeek,
      observed: observedForScenario(adapter.rows, events, scenario.decisionWeek),
    });
  }, [chainNodes, chainEdges, events, adapter, scenario, playingIntro]);

  const propagation = useMemo((): Map<string, ProjectedWeek[]> => outcome?.projectionByNode ?? new Map(), [outcome]);

  const directlyAffectedNodeIds = useMemo(() => [...new Set(events.map((e) => e.nodeId))], [events]);
  const propagatedNodeIds = useMemo(
    () => [...propagation.keys()].filter((id) => !directlyAffectedNodeIds.includes(id)),
    [propagation, directlyAffectedNodeIds],
  );

  /**
   * Pérdida de la red semana a semana (suma de los déficits relativos, en semanas equivalentes) y, para cada
   * semana, cuánta pérdida se puede todavía evitar reconfigurando en ese momento. Es la magnitud que se compara
   * contra el costo de reconfigurar: ambas están en las mismas unidades (K = k·d0).
   */
  const weekly = useMemo(
    () => ({ perWeek: outcome?.weeklyLoss ?? [], avoidableFromWeek: outcome?.avoidableFromWeek ?? [] }),
    [outcome],
  );

  const peakWeekIndex = useMemo(() => {
    let bestIndex = 0;
    let best = -1;
    weekly.perWeek.forEach((total, i) => {
      if (total > best) {
        best = total;
        bestIndex = i;
      }
    });
    return bestIndex;
  }, [weekly]);

  const [weekIndex, setWeekIndex] = useState(peakWeekIndex);
  const [playing, setPlaying] = useState(false);
  const effectiveWeekIndex = Math.min(weekIndex, (scenario?.projectionHorizonWeeks ?? 1) - 1);
  /** Costo de reconfigurar que asume el usuario, en semanas malas equivalentes (k). */
  const [assumedK, setAssumedK] = useState(3);
  /** Fracción de propagación `c` cuya tabla k se muestra en el detalle. */
  const [kFraction, setKFraction] = useState<number>(CENTRAL_PROPAGATION_FRACTION);

  const severityByNode = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const node of chainNodes) {
      const deficit = propagation.get(node.id)?.[effectiveWeekIndex]?.deficit ?? 0;
      map[node.id] = classifySeverity(deficit);
    }
    return map;
  }, [chainNodes, propagation, effectiveWeekIndex]);

  const severityByEdge = useMemo(() => {
    const map: Record<string, Severity> = {};
    for (const edge of chainEdges) map[edge.id] = severityByNode[edge.sourceNodeId] ?? "none";
    return map;
  }, [chainEdges, severityByNode]);

  const weekLabel = useMemo(() => {
    const any = [...propagation.values()][0];
    return any?.[effectiveWeekIndex]?.weekStart ? formatWeekLabel(any[effectiveWeekIndex].weekStart) : "";
  }, [propagation, effectiveWeekIndex]);

  /** Peor momento de la vista previa — hasta ahí llega la animación de entrada. */
  const previewPeakWeek = useMemo(() => {
    if (!previewOutcome || !scenario) return 0;
    let bestIndex = 0;
    let best = -1;
    for (let i = 0; i < scenario.projectionHorizonWeeks; i++) {
      let total = 0;
      for (const weeks of previewOutcome.projectionByNode.values()) total += weeks[i]?.deficit ?? 0;
      if (total > best) {
        best = total;
        bestIndex = i;
      }
    }
    return bestIndex;
  }, [previewOutcome, scenario]);

  /** Curva de la crisis: operación perdida por semana, en semanas equivalentes. */
  const crisisData = useMemo(() => {
    const anyProjection = [...propagation.values()][0] ?? [];
    return weekly.perWeek.map((total, i) => ({
      weekStart: anyProjection[i]?.weekStart ?? "",
      lost: total,
    }));
  }, [weekly, propagation]);

  if (!chain || !scenario) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Escenario no encontrado.
      </div>
    );
  }

  // Mientras corre el job se muestra la propagación avanzando sobre la red hasta el peor
  // momento, en vez de un spinner. Al terminar la animación se pasa al resultado.
  if (playingIntro && previewOutcome) {
    return (
      <SimulationIntro
        chainId={chainId}
        chainNodes={chainNodes}
        chainEdges={chainEdges}
        projectionByNode={previewOutcome.projectionByNode}
        peakWeekIndex={previewPeakWeek}
        onDone={finishIntro}
      />
    );
  }

  // El job todavía no escribió ninguna fila de Resultado (C36: corre en background).
  if (!result || !outcome) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        <div className="text-[13.5px] font-medium">Corriendo simulación…</div>
        <div className="max-w-[380px] text-center text-[11.5px] leading-relaxed text-muted-foreground">
          El motor corre como job en background: la corrida se guarda recién cuando termina de barrer todas las
          réplicas.
        </div>
      </div>
    );
  }

  const badWeeks = outcome.totalDeficit.median;
  const badWeeksLow = outcome.totalDeficit.low;
  const badWeeksHigh = outcome.totalDeficit.high;
  const impact = classifyImpact(badWeeks, scenario.projectionHorizonWeeks);
  const reconfigured = result.reconfigurationWeekIndex !== null;

  const firstAffectedWeek = weekly.perWeek.findIndex((total) => total > 0);
  const weeksInDeficit = weekly.perWeek.filter((total) => total > 0).length;

  // ¿Conviene reconfigurar con el costo que asume el usuario? k es el costo en SEMANAS DE OPERAR COMO AHORA; en las
  // unidades de la pérdida vale K = k·d0, con d0 el déficit semanal del nodo afectado. Reconfigurar se paga si la
  // pérdida evitable acumulada E(H) alcanza K. La misma regla define el umbral N(k) de la tabla (docs/definiciones-motor.md).
  const d0 = outcome.d0;
  const avoidableNow = weekly.avoidableFromWeek[0] ?? 0;
  const breakEvenK = outcome.breakEvenKs[Math.floor(outcome.breakEvenKs.length / 2)] ?? 0;
  // El tope del control escala con el k_max del propio escenario: con uno fijo, un escenario que pierde mucho
  // quedaba clavado en "sí conviene" para cualquier posición.
  const kMax = Math.max(10, Math.ceil(breakEvenK * 1.5));
  const effectiveK = Math.min(assumedK, kMax);
  const worthShare = shareWorthwhile(outcome.breakEvenKs, effectiveK);
  const worthReconfiguring = worthShare > 0.5;
  const costNow = effectiveK * d0;
  const threshold = thresholdAtK(outcome.replicaCurves, effectiveK, CENTRAL_PROPAGATION_FRACTION);
  // Último momento en que reconfigurar todavía se paga solo: después, lo que queda por evitar ya no alcanza el costo.
  const lastWorthwhileWeek = weekly.avoidableFromWeek.reduce(
    (last, avoidable, i) => (avoidable >= costNow ? i : last),
    -1,
  );
  // Qué porción de la pérdida evitable se lleva el costo de reconfigurar, para ver cuánto margen queda.
  const costShareOfAvoidable = avoidableNow > 0 ? Math.min(1, costNow / avoidableNow) : 1;
  // Posición de k_max sobre el riel del slider; solo se dibuja si cae dentro del rango.
  const showBreakEven = breakEvenK >= 1 && breakEvenK <= kMax;
  const breakEvenPct = ((breakEvenK - 1) / Math.max(1, kMax - 1)) * 100;
  const breakEvenLeft = `calc(${breakEvenPct}% + ${(8 - (breakEvenPct / 100) * 16).toFixed(2)}px)`;
  const observedWeeks = outcome.observedWeeks;

  // La tabla guardada con la corrida; las corridas anteriores a la tabla por fracción no la traen y se recalcula.
  const storedFractions = fractionsOf(result.kTable);
  const sourceTable = storedFractions.length > 0 ? result.kTable : outcome.kTable;
  const tableFractions = fractionsOf(sourceTable);
  const tableRows = rowsForFraction(sourceTable, tableFractions.includes(kFraction) ? kFraction : CENTRAL_PROPAGATION_FRACTION);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-none items-center gap-3 px-5 pt-5 pb-3.5">
        <Link
          href={`/cadenas/${chainId}/escenarios`}
          className="flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <span className="font-mono text-[13px]">‹</span>Simulaciones
        </Link>
        <div className="h-5 w-px bg-border" />
        <div className="text-[14.5px] font-medium">{scenario.name}</div>
        {isRunning && (
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-primary">
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
            recalculando
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-px overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setView("answer")}
            className={cn("px-3 py-1.5 text-[12.5px]", view === "answer" ? "bg-muted font-medium" : "text-muted-foreground")}
          >
            Respuesta
          </button>
          <button
            onClick={() => setView("detail")}
            className={cn(
              "border-l border-border px-3 py-1.5 text-[12.5px]",
              view === "detail" ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            Detalle técnico
          </button>
        </div>
        {canRun && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            title="Eliminar simulación"
          >
            <Trash2 size={13} />
            Eliminar
          </button>
        )}
      </div>

      <DeleteScenarioDialog
        scenario={confirmingDelete ? { id: scenario.id, name: scenario.name } : null}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => router.push(`/cadenas/${chainId}/escenarios`)}
      />

      {view === "answer" ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-auto px-5 pb-10">
          <div className="flex w-full max-w-[780px] flex-col gap-4">
            {/* Veredicto: lo primero que tiene que leerse, sin jerga. */}
            <div
              className="rounded-2xl border p-6"
              style={{ background: impact.bg, borderColor: impact.border }}
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: impact.tone }} />
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider" style={{ color: impact.tone }}>
                  {impact.label}
                </span>
                {reconfigured && (
                  <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                    con reconfiguración en la semana {(result.reconfigurationWeekIndex ?? 0) + 1}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[46px] leading-none font-medium tracking-tight" style={{ color: impact.tone }}>
                  {badWeeks.toFixed(1)}
                </span>
                <span className="text-[17px] leading-snug font-medium">
                  semanas de operación perdidas, sumando todos los nodos, en {scenario.projectionHorizonWeeks} semanas
                </span>
              </div>

              <div className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                Estimación central; según cómo se comporte la propagación puede ir de{" "}
                <span className="font-mono">{badWeeksLow.toFixed(1)}</span> a{" "}
                <span className="font-mono">{badWeeksHigh.toFixed(1)}</span> semanas.
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: "Nodos alcanzados", value: `${propagation.size}`, note: `${propagatedNodeIds.length} por propagación` },
                  {
                    label: "Empieza a sentirse",
                    value: firstAffectedWeek >= 0 ? `sem. ${firstAffectedWeek + 1}` : "—",
                    note: "primera semana con déficit",
                  },
                  {
                    label: "Semanas afectadas",
                    value: `${weeksInDeficit}`,
                    note: reconfigured ? "hasta la reconfiguración" : "no se corrige solo",
                  },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-border bg-card px-3 py-2.5">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
                    <div className="mt-0.5 font-mono text-[19px] leading-tight font-medium">{stat.value}</div>
                    <div className="text-[10.5px] text-muted-foreground">{stat.note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* La decisión: el usuario pone su costo y el sistema responde sí o no. */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-[15px] font-medium">¿Conviene reconfigurar?</div>
              <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Depende de cuánto te cueste hacerlo. Ese costo se mide en semanas de operar como ahora: reconfigurar
                cuesta lo que perderías en esas semanas con el problema actual.
              </div>
              {observedWeeks > 0 && (
                <div className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  Esta simulación parte de una alerta: el desvío ya lleva{" "}
                  <span className="font-medium text-foreground">
                    {observedWeeks} {observedWeeks === 1 ? "semana" : "semanas"}
                  </span>{" "}
                  observadas. Son pasado: no cuentan para el umbral, que se mide desde la decisión.
                </div>
              )}

              <div className="mt-4 flex items-start gap-3">
                <span className="mt-0.5 flex-none font-mono text-[10.5px] text-muted-foreground">
                  reconfigurar me cuesta
                </span>
                <div className="relative min-w-0 flex-1 pb-5">
                  <input
                    type="range"
                    min={1}
                    max={kMax}
                    value={effectiveK}
                    onChange={(e) => setAssumedK(Number(e.target.value))}
                    className="h-1.5 w-full accent-primary"
                  />
                  {/* Punto de equilibrio sobre la escala del slider. La marca es una línea real
                      apoyada en el riel — antes era un "▲" dentro de un texto centrado, así que
                      el triángulo caía a la izquierda del valor que decía señalar. El desfase de
                      8px compensa el radio del thumb, que no llega a los extremos del riel. */}
                  {showBreakEven && (
                    <>
                      <span
                        className="pointer-events-none absolute top-[9px] h-2 w-px -translate-x-1/2 bg-muted-foreground/60"
                        style={{ left: breakEvenLeft }}
                      />
                      <span
                        className="pointer-events-none absolute top-[19px] -translate-x-1/2 whitespace-nowrap font-mono text-[9.5px] text-muted-foreground"
                        style={{ left: breakEvenLeft }}
                      >
                        deja de convenir en {breakEvenK.toFixed(1)}
                      </span>
                    </>
                  )}
                </div>
                <span className="mt-0.5 w-24 flex-none text-right font-mono text-[12.5px] font-medium">
                  {effectiveK} {effectiveK === 1 ? "semana" : "semanas"}
                </span>
              </div>

              {/* El color acompaña a la acción recomendada (hacelo / no lo hagas), no a la gravedad:
                  un ✓ sobre rojo mandaba señales contradictorias. La gravedad ya la comunica el
                  bloque de impacto de arriba. */}
              <div className="mt-4 flex items-start gap-3 rounded-xl border p-4"
                style={
                  worthReconfiguring
                    ? { borderColor: "rgba(59, 130, 246, 0.35)", background: "rgba(59, 130, 246, 0.1)" }
                    : { borderColor: "var(--border)", background: "var(--muted)" }
                }
              >
                <span
                  className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-white"
                  style={{ background: worthReconfiguring ? "#3b82f6" : "#8c96a6" }}
                >
                  {worthReconfiguring ? <Check size={14} /> : <X size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">
                    {worthReconfiguring ? "Sí, conviene reconfigurar" : "No conviene reconfigurar"}
                  </div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {worthReconfiguring ? (
                      <>
                        Reconfigurando ahora evitás{" "}
                        <span className="font-medium text-foreground">{avoidableNow.toFixed(1)} semanas</span> de
                        pérdida, contra un costo de {costNow.toFixed(1)} ({effectiveK}{" "}
                        {effectiveK === 1 ? "semana" : "semanas"} de operar como ahora).
                        {threshold.median !== null && (
                          <>
                            {" "}
                            Se paga si el problema dura{" "}
                            <span className="font-medium text-foreground">
                              {threshold.median.toFixed(1)} {threshold.median === 1 ? "semana" : "semanas"}
                            </span>{" "}
                            o más desde la decisión
                            {threshold.low !== null && threshold.high !== null && threshold.low !== threshold.high && (
                              <> (entre {threshold.low.toFixed(1)} y {threshold.high.toFixed(1)} según las réplicas)</>
                            )}
                            {observedWeeks > 0 && threshold.median !== null && (
                              <>
                                ; desde que empezó el desvío, {(observedWeeks + threshold.median).toFixed(1)} semanas en total
                              </>
                            )}
                            .
                          </>
                        )}
                        {lastWorthwhileWeek >= 0 && lastWorthwhileWeek + 1 < scenario.projectionHorizonWeeks && (
                          <>
                            {" "}
                            Cada semana que esperes queda menos por evitar: a partir de la{" "}
                            <span className="font-medium text-foreground">semana {lastWorthwhileWeek + 2}</span> ya no
                            se paga solo.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Reconfigurar cuesta {costNow.toFixed(1)} ({effectiveK}{" "}
                        {effectiveK === 1 ? "semana" : "semanas"} de operar como ahora) y en todo el horizonte solo
                        evitarías <span className="font-mono">{avoidableNow.toFixed(1)}</span>. Sale más caro el
                        remedio que la enfermedad.
                        {worthShare > 0 && (
                          <> Aun así, se paga en el {Math.round(worthShare * 100)} % de las réplicas.</>
                        )}
                      </>
                    )}
                  </div>

                  {/* La barra entera es la pérdida que evitás; el relleno, lo que te cuesta
                      evitarla. Si el relleno tapa toda la barra, el remedio cuesta más que la
                      enfermedad. */}
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-card">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${costShareOfAvoidable * 100}%`,
                          background: worthReconfiguring ? "#3b82f6" : "#8c96a6",
                        }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground">
                      <span>cuesta {costNow.toFixed(1)}</span>
                      <span>evitás {avoidableNow.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                {reconfigured ? (
                  <Button variant="outline" size="sm" disabled={isRunning || !canRun} onClick={() => rerunScenario(scenarioId, null)}>
                    Ver qué pasa si no reconfiguro
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={isRunning || !canRun || !worthReconfiguring}
                    className="bg-foreground text-background hover:bg-foreground/85"
                    onClick={() => rerunScenario(scenarioId, 0)}
                  >
                    Reconfigurar ahora y ver el resultado
                  </Button>
                )}
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                  Reconfigurar es un cambio de golpe: firmado el convenio, el proveedor alternativo opera de inmediato.
                </span>
              </div>
            </div>

            {/* La curva de la crisis: cuándo pega, cuánto dura, cuál es el peor momento. */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[14px] font-medium">Cómo evoluciona la crisis</span>
                <span className="text-[11.5px] text-muted-foreground">
                  cuánta operación se pierde cada semana
                </span>
              </div>
              <CrisisTimelineChart
                data={crisisData}
                currentWeekIndex={effectiveWeekIndex}
                reconfigurationWeekIndex={result.reconfigurationWeekIndex}
                onSeek={(i) => {
                  setPlaying(false);
                  setWeekIndex(i);
                }}
              />
              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-3">
                {[
                  {
                    label: "Arranca",
                    value: firstAffectedWeek >= 0 ? `semana ${firstAffectedWeek + 1}` : "sin impacto",
                    note: "primera semana con pérdida",
                  },
                  {
                    label: "Peor momento",
                    value: `semana ${peakWeekIndex + 1}`,
                    note: `se pierde ${(weekly.perWeek[peakWeekIndex] ?? 0).toFixed(2)} de semana`,
                  },
                  {
                    label: "Cuánto dura",
                    value: `${weeksInDeficit} ${weeksInDeficit === 1 ? "semana" : "semanas"}`,
                    note: reconfigured ? "hasta la reconfiguración" : "no se corrige solo",
                  },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-muted/40 px-3 py-2">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </div>
                    <div className="mt-0.5 text-[13.5px] font-medium">{stat.value}</div>
                    <div className="text-[10.5px] text-muted-foreground">{stat.note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cómo se mueve por la red — la parte visual. */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[14px] font-medium">Cómo se propaga por la cadena</span>
                <span className="text-[11.5px] text-muted-foreground">
                  el impacto no llega a todos a la vez: viaja con el tiempo de tránsito de cada tramo
                </span>
              </div>
              <div className="flex h-[360px] overflow-hidden rounded-xl border border-border">
                <ChainCanvas chainId={chainId} mode="display" severityByNode={severityByNode} severityByEdge={severityByEdge} />
              </div>
              <div className="mt-3">
                <WeekPlayer
                  weekIndex={effectiveWeekIndex}
                  weekCount={scenario.projectionHorizonWeeks}
                  weekLabel={weekLabel}
                  playing={playing}
                  onWeekIndexChange={setWeekIndex}
                  onPlayingChange={setPlaying}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 justify-center overflow-auto px-5 pb-10">
          <div className="flex w-full max-w-[780px] flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2.5 text-[13.5px] font-medium">Ficha de la corrida</div>
              <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
                {[
                  { k: "réplicas", v: `${result.replications} × ${PROPAGATION_FRACTIONS.length} fracciones` },
                  { k: "semilla", v: `${result.seed}` },
                  { k: "fecha", v: result.runDate },
                  {
                    k: "reconfiguración",
                    v: result.reconfigurationWeekIndex !== null ? `sem. ${result.reconfigurationWeekIndex + 1}` : "no",
                  },
                ].map((item) => (
                  <div key={item.k} className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{item.k}</div>
                    <div className="mt-0.5 truncate font-medium">{item.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Cada corrida barre {result.replications} réplicas por cada una de las {PROPAGATION_FRACTIONS.length}{" "}
                fracciones de déficit que se traslada por arista (supuesto del modelo, sin calibrar), sorteando en cada
                réplica una posición dentro de la banda de incertidumbre de la línea base (la misma para todos los nodos y
                para mantener o reconfigurar). Lo que se reporta es la mediana y el rango
                entre los percentiles 10 y 90, nunca un valor puntual. La semilla permite reproducir esta corrida
                exactamente.
              </div>
              {runs.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                  <span className="font-mono text-[10px] text-muted-foreground">corridas guardadas</span>
                  {runs.map((run, i) => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px]",
                        run.id === result.id
                          ? "border-primary/50 bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      #{runs.length - i} · {run.runDate}
                      {run.reconfigurationWeekIndex !== null && ` · rec. sem. ${run.reconfigurationWeekIndex + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Eventos del escenario
              </div>
              <div className="flex flex-col gap-1.5">
                {events.map((e) => {
                  const node = chainNodes.find((n) => n.id === e.nodeId);
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5">
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px]">{e.eventType}</span>
                      <span className="font-mono text-[12.5px] font-medium">{node?.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">desde {e.startDate}</span>
                      <span className="ml-auto font-mono text-[12.5px] font-medium text-destructive">−{e.magnitude}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] font-medium">Tabla k — costo de reconfigurar vs. umbral</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">mediana y p10–p90 sobre réplicas</span>
              </div>
              <div className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                Cada celda es N(k): las semanas de persistencia, contadas desde la decisión, a partir de las cuales la
                pérdida evitable alcanza el costo k (en semanas de operar como ahora). &quot;No cruza&quot; = el costo no
                se recupera dentro del horizonte.
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">fracción de propagación c</span>
                {tableFractions.map((c) => (
                  <button
                    key={c}
                    onClick={() => setKFraction(c)}
                    className={cn(
                      "rounded border px-2 py-0.5 font-mono text-[10px]",
                      Math.abs(c - kFraction) < 1e-9
                        ? "border-primary/50 bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c.toFixed(2)}
                  </button>
                ))}
              </div>
              <KTableChart rows={tableRows} />
              <div className="mt-3 grid grid-cols-5 gap-1.5 border-t border-border pt-3 font-mono text-[11px]">
                {tableRows.map((row) => (
                  <div
                    key={row.k}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-md py-1.5",
                      row.k === effectiveK ? "bg-accent" : "bg-muted/40",
                    )}
                  >
                    <span className="text-muted-foreground">k={row.k}</span>
                    <span className="font-medium">{row.thresholdMedian !== null ? row.thresholdMedian.toFixed(1) : "no cruza"}</span>
                    <span className="text-[9.5px] text-muted-foreground">
                      {row.thresholdMedian === null
                        ? row.crossingShare !== undefined
                          ? `cruza en ${Math.round(row.crossingShare * 100)} %`
                          : "sin umbral"
                        : `${row.thresholdLow !== null ? row.thresholdLow.toFixed(1) : "—"}–${row.thresholdHigh !== null ? row.thresholdHigh.toFixed(1) : "no cruza"}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {[...directlyAffectedNodeIds, ...propagatedNodeIds].map((nodeId) => {
              const node = chainNodes.find((n) => n.id === nodeId);
              const projection = propagation.get(nodeId) ?? [];
              // Déficit relativo acumulado del nodo, en semanas equivalentes (Σ déficit / nivel normal).
              const nodeDeficit = projection.reduce((sum, w) => sum + w.deficit, 0) / (projection[0]?.baseline || 100);
              const isDirect = directlyAffectedNodeIds.includes(nodeId);
              return (
                <div key={nodeId} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[13.5px] font-medium">
                      Déficit proyectado — {node?.label}
                      {!isDirect && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">(propagado)</span>}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      acumulado {nodeDeficit.toFixed(1)} sem. equivalentes
                    </span>
                  </div>
                  <WeeklyPerformanceChart
                    data={adapter.unitOf(nodeId) === "dias" ? projection.map((w) => toDisplayUnits(adapter, nodeId, w)) : projection}
                    height={160}
                    reconfigurationWeekIndex={result.reconfigurationWeekIndex}
                    unit={adapter.unitOf(nodeId)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
