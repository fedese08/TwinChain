// Filas de la base (español, columnas nullable) → los tipos que usa la UI (`lib/mock/types.ts`).
import type {
  AristaRow,
  CadenaRow,
  DesempenoSemanalRow,
  EscenarioRow,
  EventoRow,
  NodoRow,
  ResultadoRow,
} from "@/lib/db/schema";
import type {
  Chain,
  DisruptionEvent,
  Scenario,
  ScenarioResult,
  SupplyChainEdge,
  SupplyChainNode,
  WeeklyPerformance,
} from "@/lib/mock/types";

export const toChain = (r: CadenaRow): Chain => ({
  id: r.id,
  name: r.nombre,
  organizationId: r.organizacionId,
  visibility: r.visibilidad,
});

export const toNode = (r: NodoRow): SupplyChainNode => ({
  id: r.id,
  chainId: r.cadenaId,
  nodeType: r.tipo,
  label: r.etiqueta,
  supplyCapacity: r.capacidadSuministro ?? undefined,
  productionCapacity: r.capacidadProduccion ?? undefined,
  storageCapacity: r.capacidadAlmacenamiento ?? undefined,
  currentStockLevel: r.nivelStockActual ?? undefined,
  canvasPosition: { x: r.posX, y: r.posY },
});

export const toEdge = (r: AristaRow): SupplyChainEdge => ({
  id: r.id,
  sourceNodeId: r.nodoOrigenId,
  targetNodeId: r.nodoDestinoId,
  transitTimeDays: r.tiempoTransito,
});

export const toWeeklyPerformance = (r: DesempenoSemanalRow): WeeklyPerformance => ({
  id: r.id,
  nodeId: r.nodoId,
  weekStart: r.semana,
  actualValue: r.valorReal,
  baseline: r.lineaBase,
  baselineLowerBand: r.bandaInferior,
  baselineUpperBand: r.bandaSuperior,
  deficit: r.deficit,
});

export const toScenario = (r: EscenarioRow): Scenario => ({
  id: r.id,
  chainId: r.cadenaId,
  userId: r.usuarioId,
  projectionHorizonWeeks: r.horizonteProyeccion,
  name: r.nombre,
  createdAt: r.creadoEn.toISOString().slice(0, 10),
});

export const toEvent = (r: EventoRow): DisruptionEvent => ({
  id: r.id,
  scenarioId: r.escenarioId,
  nodeId: r.nodoId,
  eventType: r.tipo,
  startDate: r.fechaInicio,
  magnitude: r.magnitud,
});

export const toResult = (r: ResultadoRow): ScenarioResult => ({
  id: r.id,
  scenarioId: r.escenarioId,
  runDate: r.fechaCorrida,
  kTable: r.tablaK.map((row) => ({
    k: row.k,
    thresholdMedian: row.umbral_mediana,
    thresholdLow: row.umbral_min,
    thresholdHigh: row.umbral_max,
  })),
  replications: r.replicas,
  seed: r.semilla,
  reconfigurationWeekIndex: r.semanaReconfiguracion,
});
