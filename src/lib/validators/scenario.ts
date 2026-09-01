import { z } from "zod";

export const EVENT_TYPE_SUGGESTIONS = ["corte", "huelga", "demora", "pico_demanda", "falla_calidad"] as const;

// tipo es una lista abierta según el modelo de datos — el schema solo exige que no esté vacío.
// El nodo NO va acá: un escenario apunta a un único nodo (ver `nodeId` en el schema de abajo),
// y todos sus eventos caen sobre ese mismo nodo.
export const disruptionEventInputSchema = z.object({
  eventType: z.string().min(1, "Indicá el tipo de evento"),
  startDate: z.string().min(1, "Elegí una fecha de inicio"),
  magnitude: z.number().min(1, "Mínimo 1%").max(100, "Máximo 100%"),
});
export type DisruptionEventInput = z.infer<typeof disruptionEventInputSchema>;

export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Ponele un nombre al escenario").max(120),
  projectionHorizonWeeks: z.number().min(1, "Mínimo 1 semana").max(52, "Máximo 52 semanas"),
  // RF: un escenario aplica eventos sobre un solo nodo a la vez (varios eventos, un único nodo).
  nodeId: z.string().min(1, "Elegí el nodo afectado"),
  events: z.array(disruptionEventInputSchema).min(1, "Agregá al menos un evento"),
});
export type ScenarioFormValues = z.infer<typeof scenarioFormSchema>;
