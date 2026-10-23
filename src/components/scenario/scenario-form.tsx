"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_SUGGESTIONS,
  scenarioFormSchema,
  type ScenarioFormValues,
} from "@/lib/validators/scenario";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import { useAppStore } from "@/stores/app-store";
import type { AlertScenarioInputs } from "@/lib/domain/detection";
import type { SupplyChainNode } from "@/lib/domain/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ScenarioFormHandle {
  /**
   * Fija el nodo del evento del escenario — para elegirlo desde el canvas. Un escenario tiene UN solo evento: clickear
   * otro nodo mueve el evento a ese nodo, y volver a clickear el nodo elegido lo saca.
   */
  selectNode: (nodeId: string) => void;
}

interface ScenarioFormProps {
  chainId: string;
  chainNodes: SupplyChainNode[];
  onSelectedNodesChange?: (nodeIds: string[]) => void;
  /** Simulación desde una alerta: entradas derivadas de lo que observó el monitoreo. */
  alertSeed?: AlertScenarioInputs | null;
  onClearAlert?: () => void;
}

export const ScenarioForm = forwardRef<ScenarioFormHandle, ScenarioFormProps>(function ScenarioForm(
  { chainId, chainNodes, onSelectedNodesChange, alertSeed, onClearAlert },
  ref,
) {
  const router = useRouter();
  const createScenario = useAppStore((s) => s.createScenario);
  const canRun = useAppStore((s) => s.canRun);
  const { definition, usage, scenariosAtLimit } = usePlanUsage();

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ScenarioFormValues>({
    resolver: zodResolver(scenarioFormSchema),
    defaultValues: { name: "", projectionHorizonWeeks: 16, events: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "events" });
  const watchedEvents = useWatch({ control, name: "events" });
  const eventNodeIds = useMemo(() => (watchedEvents ?? []).map((e) => e?.nodeId).filter((id): id is string => Boolean(id)), [watchedEvents]);
  const eventNodeKey = eventNodeIds.join(",");

  // Con una alerta, el formulario arranca con lo observado: nodo, inicio del desvío y caída media.
  useEffect(() => {
    if (!alertSeed) return;
    const label = chainNodes.find((n) => n.id === alertSeed.nodeId)?.label ?? "nodo";
    reset({
      name: `Cómo sigue ${label}`,
      projectionHorizonWeeks: 16,
      events: [
        { nodeId: alertSeed.nodeId, eventType: "degradacion_detectada", startDate: alertSeed.startDate, magnitude: alertSeed.magnitudePct },
      ],
    });
  }, [alertSeed, chainNodes, reset]);

  useEffect(() => {
    onSelectedNodesChange?.(eventNodeKey ? eventNodeKey.split(",") : []);
  }, [eventNodeKey, onSelectedNodesChange]);

  useImperativeHandle(
    ref,
    () => ({
      selectNode(nodeId: string) {
        const [current] = getValues("events") ?? [];
        if (!current) append({ nodeId, eventType: "", startDate: todayIso(), magnitude: 25 });
        // Reclickear el nodo elegido lo saca; clickear otro mueve el evento a ese nodo (se conservan tipo, fecha y magnitud).
        else if (current.nodeId === nodeId) remove(0);
        else setValue("events.0.nodeId", nodeId, { shouldValidate: true });
      },
    }),
    [getValues, setValue, append, remove],
  );

  function onSubmit(values: ScenarioFormValues) {
    const scenarioId = createScenario(
      chainId,
      values.name,
      values.projectionHorizonWeeks,
      values.events,
      alertSeed?.decisionWeek,
    );
    router.push(`/cadenas/${chainId}/escenarios/${scenarioId}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex w-[300px] flex-none flex-col overflow-auto border-r border-border bg-card">
      <div className="border-b border-border px-3.5 py-3">
        <div className="text-[13.5px] font-medium">Nueva simulación</div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">fork — la cadena viva no se altera</div>
      </div>

      <div className="flex flex-col gap-4 p-3.5">
        {alertSeed && (
          <div className="rounded-lg border border-[#f5c9a8] bg-[#fdf5ec] p-2.5 text-[11px] leading-relaxed text-[#8a4313]">
            <div className="font-medium">Simulación desde una alerta</div>
            <div className="mt-0.5">
              El nodo lleva {alertSeed.observedWeeks} {alertSeed.observedWeeks === 1 ? "semana" : "semanas"} con desvío (desde{" "}
              {alertSeed.startDate}). La decisión de reconfigurar se evalúa desde la semana del {alertSeed.decisionWeek}; las semanas
              observadas son pasado y no cuentan para el umbral.
            </div>
            {onClearAlert && (
              <button type="button" onClick={onClearAlert} className="mt-1 underline underline-offset-2">
                Armarla a mano
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">Nombre del escenario</Label>
          <Input placeholder="ej. Corte de suministro en FAB-02" {...register("name")} />
          {errors.name && <span className="text-[11px] text-destructive">{errors.name.message}</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
            Horizonte de proyección (semanas)
          </Label>
          <Input type="number" min={1} max={52} {...register("projectionHorizonWeeks", { valueAsNumber: true })} />
          {errors.projectionHorizonWeeks && (
            <span className="text-[11px] text-destructive">{errors.projectionHorizonWeeks.message}</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
          <div className="flex items-center justify-between">
            <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">Evento</Label>
            {fields.length === 0 && (
              <button
                type="button"
                onClick={() => append({ nodeId: "", eventType: "", startDate: todayIso(), magnitude: 25 })}
                className="flex items-center gap-1 text-[11.5px] text-primary hover:underline"
              >
                <Plus size={12} /> agregar evento
              </button>
            )}
          </div>

          {fields.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              Hacé click en el nodo del canvas que querés afectar, o usá &quot;agregar evento&quot;. Un escenario tiene un solo evento.
            </div>
          )}

          {fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {chainNodes.find((n) => n.id === watchedEvents?.[index]?.nodeId)?.label ?? `Evento ${index + 1}`}
                </span>
                <button type="button" onClick={() => remove(index)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={12} />
                </button>
              </div>

              <Controller
                control={control}
                name={`events.${index}.nodeId`}
                render={({ field: nodeField }) => (
                  <Select value={nodeField.value} onValueChange={nodeField.onChange}>
                    <SelectTrigger className="h-8 text-[12px]">
                      <SelectValue placeholder="Elegí un nodo">
                        {(value: string | null) => {
                          const node = chainNodes.find((n) => n.id === value);
                          return node ? `${node.label} · ${node.nodeType}` : "Elegí un nodo";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {chainNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label} · {n.nodeType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />

              <Controller
                control={control}
                name={`events.${index}.eventType`}
                render={({ field: typeField }) => (
                  <Select value={typeField.value} onValueChange={typeField.onChange}>
                    <SelectTrigger className="h-8 text-[12px]">
                      <SelectValue placeholder="Tipo de evento">
                        {(value: string | null) => EVENT_TYPE_LABELS[value ?? ""] ?? "Tipo de evento"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPE_SUGGESTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {EVENT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />

              <div className="flex gap-2">
                <div className="flex-1">
                  <Input type="date" {...register(`events.${index}.startDate`)} className="text-[12px]" />
                </div>
                <div className="flex w-[104px] items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    {...register(`events.${index}.magnitude`, { valueAsNumber: true })}
                    className="text-[12px]"
                  />
                  <span className="font-mono text-[10.5px] text-muted-foreground">%</span>
                </div>
              </div>
              {errors.events?.[index] && (
                <span className="text-[10.5px] text-destructive">
                  {errors.events[index]?.nodeId?.message ||
                    errors.events[index]?.eventType?.message ||
                    errors.events[index]?.startDate?.message ||
                    errors.events[index]?.magnitude?.message}
                </span>
              )}
            </div>
          ))}
          {errors.events?.root && <span className="text-[10.5px] text-destructive">{errors.events.root.message}</span>}
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          La duración de la disrupción no se carga: es la incógnita que el sistema resuelve al correr la simulación.
        </div>

        {!canRun && (
          <p className="rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Tu rol no puede correr simulaciones.
          </p>
        )}
        {scenariosAtLimit && (
          <p className="rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Tu plan {definition.name} admite hasta {definition.maxScenarios} escenarios guardados y ya tenés {usage.scenarios}.
            Borrá uno o{" "}
            <Link href="/organizacion" className="text-primary underline-offset-2 hover:underline">
              cambiá de plan
            </Link>{" "}
            para crear otro.
          </p>
        )}
        <Button
          type="submit"
          disabled={isSubmitting || !canRun || scenariosAtLimit}
          className="bg-foreground text-background hover:bg-foreground/85"
        >
          ▶ Correr simulación
        </Button>
      </div>
    </form>
  );
});
