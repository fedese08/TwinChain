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

// Un escenario tiene UN solo evento sobre la red: el nodo que se ve afectado, qué le pasa, desde cuándo y cuánto cae. El tipo
// es una lista abierta según el modelo de datos, así que el schema solo exige que no esté vacío.
export const disruptionEventInputSchema = z.object({
  nodeId: z.string().min(1, "Elegí el nodo afectado"),
  eventType: z.string().min(1, "Indicá el tipo de evento"),
  startDate: z.string().min(1, "Elegí una fecha de inicio"),
  magnitude: z.number().min(1, "Mínimo 1%").max(100, "Máximo 100%"),
});
export type DisruptionEventInput = z.infer<typeof disruptionEventInputSchema>;

export const ONE_EVENT_MESSAGE = "Un escenario tiene un solo evento";

export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Ponele un nombre al escenario").max(120),
  projectionHorizonWeeks: z.number().min(1, "Mínimo 1 semana").max(52, "Máximo 52 semanas"),
  events: z.array(disruptionEventInputSchema).min(1, "Agregá el evento").max(1, ONE_EVENT_MESSAGE),
});
export type ScenarioFormValues = z.infer<typeof scenarioFormSchema>;
