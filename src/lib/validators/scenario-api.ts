import { z } from "zod";
import { ONE_EVENT_MESSAGE } from "@/lib/validators/scenario";

const eventSchema = z.object({
  id: z.uuid(),
  // El evento lleva su nodo (el único nodo afectado del escenario).
  nodeId: z.uuid(),
  eventType: z.string().trim().min(1).max(40),
  startDate: z.iso.date(),
  magnitude: z.number().finite().min(1, "Mínimo 1%").max(100, "Máximo 100%"),
});

export const createScenarioSchema = z.object({
  // Los ids los genera el cliente para poder mostrar el escenario mientras el servidor corre la simulación.
  id: z.uuid(),
  chainId: z.uuid(),
  name: z.string().trim().min(1, "Ponele un nombre al escenario").max(120),
  projectionHorizonWeeks: z.number().finite().min(1).max(52),
  // Un escenario tiene un solo evento.
  events: z.array(eventSchema).min(1, "Agregá el evento").max(1, ONE_EVENT_MESSAGE),
  // Simulación desde una alerta: semana de la decisión de reconfigurar (s_r). Sin ella, s_r es el inicio del primer evento.
  decisionWeek: z.iso.date().optional(),
});

export const rerunScenarioSchema = z.object({
  // Semana del horizonte en que se aplica el escalón de reconfiguración (RF022); null = sin reconfigurar.
  reconfigurationWeekIndex: z.number().int().min(0).nullable(),
});
