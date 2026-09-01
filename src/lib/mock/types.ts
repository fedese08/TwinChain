// Tipos derivados de docs/modelo-datos.md (especificación completa del modelo de datos).
// Los valores de `nodeType` se mantienen en español porque la especificación los define
// como el discriminador literal de Mongo ("Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente").

export const NODE_TYPES = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const MAX_NODES_PER_CHAIN = 50;

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

export interface SupplyChainNode {
  id: string;
  chainId: string;
  nodeType: NodeType;
  /** Código visible en canvas/tablas (ej. "FAB-02"). Metadata de UI, no del modelo formal. */
  label: string;
  /** Solo si nodeType === "Fabrica" (capacidad_produccion). */
  productionCapacity?: number;
  /** Solo si nodeType === "Almacen" (capacidad_almacenamiento). */
  storageCapacity?: number;
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
}

export interface KTableRow {
  /** k — costo de reconfigurar, en semanas malas equivalentes. */
  k: number;
  /** umbral de reconfiguración resultante para ese k; null = a partir de este k ya no existe umbral. */
  threshold: number | null;
}

export interface ScenarioResult {
  id: string;
  scenarioId: string;
  runDate: string;
  kTable: KTableRow[];
}
