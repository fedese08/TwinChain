// Filas de la base (español, columnas nullable) → los tipos que usa la UI (`lib/domain/types.ts`).
import type {
  AristaRow,
  CadenaRow,
  DesempenoSemanalRow,
  EscenarioRow,
  EventoRow,
  NodoRow,
  ResultadoRow,
  TablaKRow,
} from "@/lib/db/schema";
import type {
  Chain,
  DisruptionEvent,
  KTableRow,
  Scenario,
  ScenarioResult,
  BaselineSource,
  SupplyChainEdge,
  SupplyChainNode,
  WeeklyPerformance,
} from "@/lib/domain/types";

export const toChain = (r: CadenaRow): Chain => ({
  id: r.id,
  name: r.nombre,
  organizationId: r.organizacionId,
  visibility: r.visibilidad,
  falseAlarmCost: r.costoFalsaAlarma,
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
  olistSellerId: r.vendedorOlistId ?? undefined,
  baselineSource: (r.fuenteLineaBase as BaselineSource | null) ?? undefined,
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
  weeklyBandLower: r.bandaSemanalInferior ?? undefined,
  weeklyBandUpper: r.bandaSemanalSuperior ?? undefined,
  deficit: r.deficit,
});

export const toScenario = (r: EscenarioRow): Scenario => ({
  id: r.id,
  chainId: r.cadenaId,
  userId: r.usuarioId,
  projectionHorizonWeeks: r.horizonteProyeccion,
  name: r.nombre,
  createdAt: r.creadoEn.toISOString().slice(0, 10),
  ...(r.semanaDecision ? { decisionWeek: r.semanaDecision } : {}),
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
    ...(row.fraccion !== undefined ? { propagationFraction: row.fraccion } : {}),
    ...(row.cruzan !== undefined ? { crossingShare: row.cruzan } : {}),
    thresholdMedian: row.umbral_mediana,
    thresholdLow: row.umbral_min,
    thresholdHigh: row.umbral_max,
  })),
  replications: r.replicas,
  seed: r.semilla,
  reconfigurationWeekIndex: r.semanaReconfiguracion,
});

/** Inverso de la parte `tablaK` de `toResult`: la forma en que se guarda en la columna JSONB. */
export const toKTableRows = (rows: KTableRow[]): TablaKRow[] =>
  rows.map((row) => ({
    k: row.k,
    ...(row.propagationFraction !== undefined ? { fraccion: row.propagationFraction } : {}),
    ...(row.crossingShare !== undefined ? { cruzan: row.crossingShare } : {}),
    umbral_mediana: row.thresholdMedian,
    umbral_min: row.thresholdLow,
    umbral_max: row.thresholdHigh,
  }));
