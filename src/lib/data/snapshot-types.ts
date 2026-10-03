import type {
  Chain,
  DisruptionEvent,
  Scenario,
  ScenarioResult,
  SupplyChainEdge,
  SupplyChainNode,
  WeeklyPerformance,
} from "@/lib/domain/types";

/**
 * Todo lo que el cliente necesita de la organización para trabajar, ya filtrado por lo que el
 * usuario puede ver (organización + cadenas privadas ajenas). Lo arma el servidor en cada carga
 * completa y el store del cliente lo usa como copia de trabajo.
 */
export interface AppSnapshot {
  userId: string;
  organizationName: string;
  /** Puede crear y editar cadenas (permiso `chain:write`). */
  canWrite: boolean;
  /** Puede correr simulaciones (permiso `scenario:run`). */
  canRun: boolean;
  chains: Chain[];
  nodes: SupplyChainNode[];
  edges: SupplyChainEdge[];
  weeklyPerformance: WeeklyPerformance[];
  scenarios: Scenario[];
  events: DisruptionEvent[];
  results: ScenarioResult[];
}
