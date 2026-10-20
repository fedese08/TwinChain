// Tipos derivados de docs/modelo-datos.md (especificación completa del modelo de datos).
// Los valores de `nodeType` se mantienen en español porque la especificación los define
// como el discriminador literal de la tabla `nodos` ("Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente").

export const NODE_TYPES = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface Organization {
  id: string;
  name: string;
}

export type UserRoleName = "Administrador" | "Visualizador";

export interface UserRole {
  id: string;
  name: UserRoleName;
  permissions: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  roleId: string;
  organizationId: string;
}

export type ChainVisibility = "shared" | "private";

export interface Chain {
  id: string;
  name: string;
  organizationId: string;
  visibility: ChainVisibility;
}

/** De dónde salió la línea base de un nodo con datos reales: el modelo de ML o el estimador de respaldo. */
export type BaselineSource = "ml" | "provisoria";

export interface SupplyChainNode {
  id: string;
  chainId: string;
  nodeType: NodeType;
  /** Código visible en canvas/tablas (ej. "FAB-02"). Metadata de UI, no del modelo formal. */
  label: string;
  /** Solo si nodeType === "Proveedor" (capacidad_suministro), en u/semana. */
  supplyCapacity?: number;
  /** Solo si nodeType === "Fabrica" (capacidad_produccion). */
  productionCapacity?: number;
  /** Solo si nodeType === "Almacen" (capacidad_almacenamiento). */
  storageCapacity?: number;
  /**
   * Solo si nodeType === "Almacen" (nivel_stock_actual). **Dato descriptivo, no entra en ningún
   * cálculo**: RF027 excluye explícitamente inventario y unidades físicas de la propagación
   * ("...sin incluir inventario ni unidades físicas en el cálculo"). Se muestra en el inspector
   * como contexto operativo y nada más.
   */
  currentStockLevel?: number;
  /**
   * Solo nodos Vendedor con datos REALES de Olist: el seller_id (anonimizado) cuyo historial usan. Su desempeño
   * está en DÍAS de margen (`margin_days`), no en la escala 0-100 de los nodos sintéticos (ver `domain/units.ts`).
   */
  olistSellerId?: string;
  /** Solo con `olistSellerId`: de dónde salió su línea base. */
  baselineSource?: BaselineSource;
  /** Posición en el canvas. Metadata de UI, no del modelo formal. */
  canvasPosition: { x: number; y: number };
}

export interface SupplyChainEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** tiempo_transito — sin costo asociado: decisión explícita del modelo (no hay magnitud monetaria en el sistema). */
  transitTimeDays: number;
}

export interface WeeklyPerformance {
  id: string;
  nodeId: string;
  /** ISO date del lunes que inicia la semana (semana). */
  weekStart: string;
  /** valor_real — medido (Olist: fecha estimada vs. fecha real de entrega). */
  actualValue: number;
  /** linea_base — predicho por ML, congelado al momento de la decisión. */
  baseline: number;
  /** banda_inferior — extremo inferior de la banda de incertidumbre de la línea base (RF012). */
  baselineLowerBand: number;
  /** banda_superior — extremo superior de la banda de incertidumbre de la línea base (RF012). */
  baselineUpperBand: number;
  /** Banda de UNA semana individual (CQR semanal del modelo de ML). Solo nodos con línea base del modelo. */
  weeklyBandLower?: number;
  weeklyBandUpper?: number;
  /** deficit = max(baseline - actualValue, 0). Nunca negativo: las semanas buenas no compensan a las malas. */
  deficit: number;
}

export interface DisruptionEvent {
  id: string;
  scenarioId: string;
  nodeId: string;
  /** tipo — lista abierta ("corte", "huelga", "demora", ...). */
  eventType: string;
  startDate: string;
  /** magnitud — % de caída en el desempeño del nodo. Nunca la duración: eso lo resuelve el sistema, no se carga. */
  magnitude: number;
}

export interface Scenario {
  id: string;
  chainId: string;
  userId: string;
  /** horizonte_proyeccion (H), en semanas — única magnitud temporal que carga el usuario. */
  projectionHorizonWeeks: number;
  /** Identificador legible en listados. Metadata de UI, no del modelo formal. */
  name: string;
  createdAt: string;
  /**
   * Semana de la decisión de reconfigurar (s_r). Ausente = simulación manual: s_r es el inicio del primer evento.
   * Presente = simulación desde una alerta: s_r es la semana siguiente a la detección, y las semanas observadas
   * entre el inicio del desvío y s_r son pasado que no entra en el umbral.
   */
  decisionWeek?: string;
}

/**
 * Una fila de tabla_k: para un costo de reconfigurar `k` (en semanas de operar como ahora) y una fracción de
 * propagación `c`, cuántas semanas de persistencia hacen falta para que reconfigurar se pague (N(k)).
 * El umbral no es un valor único sino la mediana sobre las réplicas, con el rango entre los percentiles 10 y 90
 * (RF029). Una réplica en la que la pérdida evitable nunca alcanza el costo se ordena como +∞.
 * `thresholdMedian = null` = la mediana es +∞, es decir, "no cruza" en el horizonte.
 */
export interface KTableRow {
  /** k — costo de reconfigurar, en semanas de operar como ahora. */
  k: number;
  /** Fracción de propagación `c` de esta fila. Ausente en las corridas anteriores a la tabla por fracción. */
  propagationFraction?: number;
  /** Mediana de N(k) sobre las réplicas, en semanas desde la decisión. `null` = no cruza. */
  thresholdMedian: number | null;
  /** Percentil 10 de N(k). `null` si ya es +∞. */
  thresholdLow: number | null;
  /** Percentil 90 de N(k). `null` si es +∞ (hay réplicas que no cruzan). */
  thresholdHigh: number | null;
  /** Fracción (0 a 1) de las réplicas en que la pérdida evitable sí alcanza el costo dentro del horizonte. */
  crossingShare?: number;
}

/**
 * Corrida encolada. En el sistema real el motor corre como job en background dentro del
 * monolito (decisión 13 / C36) y recién al terminar escribe la fila de Resultado; en el mock
 * se simula esa asincronía con una demora. NO es una entidad del modelo de datos: es estado
 * del job, no un dato persistido.
 */
export interface PendingRun {
  id: string;
  scenarioId: string;
  startedAt: number;
}

export interface ScenarioResult {
  id: string;
  scenarioId: string;
  runDate: string;
  kTable: KTableRow[];
  /** Cantidad de réplicas estocásticas que produjeron esta corrida (RF023). */
  replications: number;
  /**
   * Semilla del generador pseudoaleatorio de esta corrida. Junto con `replications` permite
   * reproducirla exactamente — cada corrida se conserva y no se pisa (RF030).
   */
  seed: number;
  /**
   * Semana (índice dentro del horizonte) en la que se aplicó la reconfiguración, si se aplicó.
   * La transición es un escalón, no una rampa (RF022 / C23).
   */
  reconfigurationWeekIndex: number | null;
}
