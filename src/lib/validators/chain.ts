import { z } from "zod";
import { CHAIN_TEMPLATES } from "@/lib/domain/templates";

export const chainFormSchema = z.object({
  name: z.string().min(1, "Ponele un nombre a la cadena").max(120),
  visibility: z.enum(["shared", "private"]),
  template: z.enum(CHAIN_TEMPLATES),
  /**
   * Interruptor de demo: genera un historial en el que parte de los nodos cambia de nivel, para poder
   * mostrar la alerta de la verificación de estabilidad (C24). Sin él, todo historial sale estable.
   */
  withLevelShift: z.boolean().optional(),
});
export type ChainFormValues = z.infer<typeof chainFormSchema>;
