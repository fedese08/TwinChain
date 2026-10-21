import { z } from "zod";
import { NODE_TYPES } from "@/lib/domain/types";
import { MAX_ADVANCE_WEEKS } from "@/lib/domain/synthetic/config";

const finite = z.number().finite();
const capacity = finite.min(0).max(1e12).nullable();

/** Ajustes de la cadena: hoy, el costo de una falsa alarma que fija el umbral del CUSUM (HU1, RF019). */
export const patchChainSchema = z.object({
  costoFalsaAlarma: finite.min(0).max(3),
});

export const createNodeSchema = z.object({
  // El cliente genera el id para poder dibujar el nodo al instante y que coincida con el de la base.
  id: z.uuid(),
  tipo: z.enum(NODE_TYPES),
  etiqueta: z.string().trim().min(1).max(60),
  x: finite,
  y: finite,
});

/** Nombres "de la app" (no de las columnas): el servidor los traduce. `null` borra el valor. */
export const patchNodeSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    position: z.object({ x: finite, y: finite }),
    supplyCapacity: capacity,
    productionCapacity: capacity,
    storageCapacity: capacity,
    currentStockLevel: capacity,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "No hay nada para actualizar" });
export type PatchNodeInput = z.infer<typeof patchNodeSchema>;

export const createEdgeSchema = z.object({
  id: z.uuid(),
  sourceNodeId: z.uuid(),
  targetNodeId: z.uuid(),
  transitTimeDays: finite.gt(0).max(3650),
});

export const patchEdgeSchema = z.object({
  transitTimeDays: finite.gt(0, "El tiempo de tránsito debe ser mayor a 0").max(3650),
});

export const advanceChainSchema = z.object({
  /** Semanas simuladas a avanzar en esta llamada (1 semana = 1 "tick" del monitoreo vivo). */
  weeks: z.number().int().min(1).max(MAX_ADVANCE_WEEKS),
});

/**
 * Lote de envíos de UN nodo, de cualquier origen (CSV semanal o sensores): cada envío trae su fecha y su margen de
 * despacho en días (positivo = antes de su plazo). El servidor los agrega por semana (RF010).
 */
export const ingestShipmentsSchema = z.object({
  nodeId: z.uuid(),
  envios: z
    .array(z.object({ fecha: z.iso.date(), margen: finite.min(-60).max(60) }))
    .min(1, "Mandá al menos un envío")
    .max(5000, "Máximo 5.000 envíos por lote"),
});
