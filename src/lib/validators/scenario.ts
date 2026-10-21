import { z } from "zod";

export const EVENT_TYPE_SUGGESTIONS = ["corte", "huelga", "demora", "pico_demanda", "falla_calidad"] as const;

/** Etiquetas legibles para el desplegable — el valor guardado sigue siendo el de la lista de arriba. */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  corte: "Corte de suministro",
  huelga: "Huelga",
  demora: "Demora en la entrega",
  pico_demanda: "Pico de demanda",
  falla_calidad: "Falla de calidad",
  degradacion_detectada: "Degradación detectada",
};

// Flujo B / RF026: un escenario tiene al menos un evento sobre la red, como máximo uno por nodo. Cada evento lleva su nodo;
// el tipo es una lista abierta según el modelo de datos, así que el schema solo exige que no esté vacío.
export const disruptionEventInputSchema = z.object({
  nodeId: z.string().min(1, "Elegí el nodo afectado"),
  eventType: z.string().min(1, "Indicá el tipo de evento"),
  startDate: z.string().min(1, "Elegí una fecha de inicio"),
  magnitude: z.number().min(1, "Mínimo 1%").max(100, "Máximo 100%"),
});
export type DisruptionEventInput = z.infer<typeof disruptionEventInputSchema>;

export const ONE_EVENT_PER_NODE_MESSAGE = "Un nodo solo puede tener un evento por escenario";

/** Ids de nodo que aparecen en más de un evento (vacíos no cuentan: todavía no eligieron nodo). */
export function repeatedNodeIds(events: { nodeId: string }[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { nodeId } of events) {
    if (!nodeId) continue;
    if (seen.has(nodeId)) repeated.add(nodeId);
    seen.add(nodeId);
  }
  return [...repeated];
}

export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Ponele un nombre al escenario").max(120),
  projectionHorizonWeeks: z.number().min(1, "Mínimo 1 semana").max(52, "Máximo 52 semanas"),
  events: z
    .array(disruptionEventInputSchema)
    .min(1, "Agregá al menos un evento")
    .superRefine((events, ctx) => {
      const repeated = new Set(repeatedNodeIds(events));
      events.forEach((event, index) => {
        if (repeated.has(event.nodeId)) ctx.addIssue({ code: "custom", path: [index, "nodeId"], message: ONE_EVENT_PER_NODE_MESSAGE });
      });
    }),
});
export type ScenarioFormValues = z.infer<typeof scenarioFormSchema>;
