import { addWeeks, startOfWeek, toIsoDate } from "@/lib/mock/dates";
import { createRng, hashSeed } from "@/lib/mock/rng";
import { runScenarioSimulation } from "@/lib/mock/simulate";
import type {
  Chain,
  DisruptionEvent,
  Organization,
  Scenario,
  ScenarioResult,
  StabilityCheck,
  SupplyChainEdge,
  SupplyChainNode,
  User,
  UserRole,
  WeeklyPerformance,
} from "@/lib/mock/types";

const WEEKS_OF_HISTORY = 16;

export const seedOrganization: Organization = {
  id: "org-1",
  name: "Andes Manufactura",
};

export const seedRoles: UserRole[] = [
  { id: "role-admin", name: "Administrador", permissions: ["organization:manage", "chain:write", "scenario:run"] },
  { id: "role-viewer", name: "Visualizador", permissions: ["chain:read", "scenario:read"] },
];

export const seedUser: User = {
  id: "user-1",
  name: "Federico Sena",
  email: "fedesena2000@gmail.com",
  roleId: "role-admin",
  organizationId: seedOrganization.id,
};

export const seedChains: Chain[] = [
  { id: "chain-norte", name: "Cadena Norte", organizationId: seedOrganization.id, visibility: "shared" },
  { id: "chain-sur", name: "Cadena Sur — empaque", organizationId: seedOrganization.id, visibility: "private" },
];

export const seedNodes: SupplyChainNode[] = [
  { id: "node-sup-01", chainId: "chain-norte", nodeType: "Proveedor", label: "SUP-01", supplyCapacity: 5200, canvasPosition: { x: 40, y: 80 } },
  { id: "node-sup-02", chainId: "chain-norte", nodeType: "Proveedor", label: "SUP-02", supplyCapacity: 3800, canvasPosition: { x: 40, y: 300 } },
  { id: "node-fab-01", chainId: "chain-norte", nodeType: "Fabrica", label: "FAB-01", productionCapacity: 4200, canvasPosition: { x: 300, y: 80 } },
  { id: "node-fab-02", chainId: "chain-norte", nodeType: "Fabrica", label: "FAB-02", productionCapacity: 3100, canvasPosition: { x: 300, y: 300 } },
  { id: "node-alm-01", chainId: "chain-norte", nodeType: "Almacen", label: "ALM-01", storageCapacity: 9000, currentStockLevel: 6100, canvasPosition: { x: 560, y: 80 } },
  { id: "node-alm-02", chainId: "chain-norte", nodeType: "Almacen", label: "ALM-02", storageCapacity: 6500, currentStockLevel: 2400, canvasPosition: { x: 560, y: 300 } },
  { id: "node-ven-01", chainId: "chain-norte", nodeType: "Vendedor", label: "VEN-01", canvasPosition: { x: 820, y: 80 } },
  { id: "node-ven-02", chainId: "chain-norte", nodeType: "Vendedor", label: "VEN-02", canvasPosition: { x: 820, y: 300 } },
  { id: "node-cli-01", chainId: "chain-norte", nodeType: "Cliente", label: "CLI-01", canvasPosition: { x: 1080, y: 190 } },

  { id: "node-s2-sup-01", chainId: "chain-sur", nodeType: "Proveedor", label: "SUP-01", supplyCapacity: 2100, canvasPosition: { x: 40, y: 160 } },
  { id: "node-s2-fab-01", chainId: "chain-sur", nodeType: "Fabrica", label: "FAB-01", productionCapacity: 1800, canvasPosition: { x: 300, y: 160 } },
  { id: "node-s2-alm-01", chainId: "chain-sur", nodeType: "Almacen", label: "ALM-01", storageCapacity: 3200, currentStockLevel: 2950, canvasPosition: { x: 560, y: 160 } },
  { id: "node-s2-ven-01", chainId: "chain-sur", nodeType: "Vendedor", label: "VEN-01", canvasPosition: { x: 820, y: 160 } },
  { id: "node-s2-cli-01", chainId: "chain-sur", nodeType: "Cliente", label: "CLI-01", canvasPosition: { x: 1080, y: 160 } },
];

export const seedEdges: SupplyChainEdge[] = [
  { id: "edge-1", sourceNodeId: "node-sup-01", targetNodeId: "node-fab-01", transitTimeDays: 4 },
  { id: "edge-2", sourceNodeId: "node-sup-02", targetNodeId: "node-fab-01", transitTimeDays: 6 },
  { id: "edge-3", sourceNodeId: "node-sup-02", targetNodeId: "node-fab-02", transitTimeDays: 5 },
  { id: "edge-4", sourceNodeId: "node-fab-01", targetNodeId: "node-alm-01", transitTimeDays: 2 },
  { id: "edge-5", sourceNodeId: "node-fab-02", targetNodeId: "node-alm-02", transitTimeDays: 3 },
  { id: "edge-6", sourceNodeId: "node-alm-01", targetNodeId: "node-ven-01", transitTimeDays: 2 },
  { id: "edge-7", sourceNodeId: "node-alm-01", targetNodeId: "node-ven-02", transitTimeDays: 4 },
  { id: "edge-8", sourceNodeId: "node-alm-02", targetNodeId: "node-ven-02", transitTimeDays: 2 },
  { id: "edge-9", sourceNodeId: "node-ven-01", targetNodeId: "node-cli-01", transitTimeDays: 1 },
  { id: "edge-10", sourceNodeId: "node-ven-02", targetNodeId: "node-cli-01", transitTimeDays: 1 },

  { id: "edge-s2-1", sourceNodeId: "node-s2-sup-01", targetNodeId: "node-s2-fab-01", transitTimeDays: 5 },
  { id: "edge-s2-2", sourceNodeId: "node-s2-fab-01", targetNodeId: "node-s2-alm-01", transitTimeDays: 2 },
  { id: "edge-s2-3", sourceNodeId: "node-s2-alm-01", targetNodeId: "node-s2-ven-01", transitTimeDays: 3 },
  { id: "edge-s2-4", sourceNodeId: "node-s2-ven-01", targetNodeId: "node-s2-cli-01", transitTimeDays: 1 },
];

function generateHistory(nodeId: string, seed: number, basePerformance: number, volatility: number): WeeklyPerformance[] {
  const rng = createRng(seed);
  const firstWeek = addWeeks(startOfWeek(new Date()), -WEEKS_OF_HISTORY);

  // La línea base se estima UNA sola vez y queda congelada (Diseño B, Fase I / Fase II): el
  // sistema no la recalcula con las semanas que va monitoreando, porque si la referencia se
  // moviera junto con la caída que se quiere detectar, el déficit se encogería solo y la
  // disrupción sostenida no se detectaría nunca. Por eso es un valor único por nodo, no uno
  // por semana. Su banda de incertidumbre (RF012) es fija por la misma razón — más ancha
  // cuanto más volátil es el nodo.
  const baseline = basePerformance;
  const bandHalfWidth = volatility * 0.35;
  const baselineLowerBand = Math.max(0, baseline - bandHalfWidth);
  const baselineUpperBand = Math.min(100, baseline + bandHalfWidth);

  const history: WeeklyPerformance[] = [];
  for (let i = 0; i < WEEKS_OF_HISTORY; i++) {
    const weekStart = toIsoDate(addWeeks(firstWeek, i));
    // Lo único que varía semana a semana es la medición real.
    const noise = (rng() - 0.55) * volatility;
    const actualValue = Math.min(100, Math.max(0, baseline + noise));
    const deficit = Math.max(0, baseline - actualValue);
    history.push({
      id: `wp-${nodeId}-${i}`,
      nodeId,
      weekStart,
      actualValue,
      baseline,
      baselineLowerBand,
      baselineUpperBand,
      deficit,
    });
  }
  return history;
}

// desempeño base por tipo: Vendedor usa datos reales (Olist); el resto es conceptual (ver modelo de datos).
const PERFORMANCE_PROFILE: Record<string, { base: number; volatility: number; seed: number }> = {
  "node-sup-01": { base: 94, volatility: 6, seed: 1 },
  "node-sup-02": { base: 90, volatility: 8, seed: 2 },
  "node-fab-01": { base: 95, volatility: 5, seed: 3 },
  "node-fab-02": { base: 91, volatility: 7, seed: 4 },
  "node-alm-01": { base: 96, volatility: 4, seed: 5 },
  "node-alm-02": { base: 93, volatility: 6, seed: 6 },
  "node-ven-01": { base: 92, volatility: 9, seed: 7 },
  "node-ven-02": { base: 88, volatility: 11, seed: 8 },
  "node-cli-01": { base: 97, volatility: 3, seed: 9 },
  "node-s2-sup-01": { base: 93, volatility: 6, seed: 10 },
  "node-s2-fab-01": { base: 94, volatility: 5, seed: 11 },
  "node-s2-alm-01": { base: 95, volatility: 5, seed: 12 },
  "node-s2-ven-01": { base: 90, volatility: 8, seed: 13 },
  "node-s2-cli-01": { base: 96, volatility: 4, seed: 14 },
};

export const seedWeeklyPerformance: WeeklyPerformance[] = seedNodes.flatMap((node) => {
  const profile = PERFORMANCE_PROFILE[node.id];
  return generateHistory(node.id, profile.seed, profile.base, profile.volatility);
});

export function weeksAgoIso(weeks: number): string {
  return toIsoDate(addWeeks(startOfWeek(new Date()), -weeks));
}

/**
 * Las cadenas del seed ya pasaron por el pipeline de ingesta, así que arrancan con su
 * validación CUSUM resuelta (C24). "Cadena Sur" queda con alerta a propósito: la demo tiene
 * que poder mostrar los dos veredictos.
 */
export const seedStabilityChecks: Record<string, StabilityCheck> = {
  "chain-norte": { status: "estable", ranAt: weeksAgoIso(4) },
  "chain-sur": { status: "alerta", ranAt: weeksAgoIso(4), changePointWeek: weeksAgoIso(9) },
};

export const seedScenarios: Scenario[] = [
  {
    id: "scenario-1",
    chainId: "chain-norte",
    userId: seedUser.id,
    projectionHorizonWeeks: 16,
    name: "Corte de suministro en FAB-02",
    createdAt: weeksAgoIso(1),
  },
  {
    id: "scenario-2",
    chainId: "chain-norte",
    userId: seedUser.id,
    projectionHorizonWeeks: 12,
    name: "Demora prolongada en VEN-01",
    createdAt: weeksAgoIso(2),
  },
  {
    id: "scenario-3",
    chainId: "chain-norte",
    userId: seedUser.id,
    projectionHorizonWeeks: 16,
    name: "Huelga en proveedores + corte en FAB-01",
    createdAt: weeksAgoIso(3),
  },
];

export const seedEvents: DisruptionEvent[] = [
  { id: "event-1", scenarioId: "scenario-1", nodeId: "node-fab-02", eventType: "corte", startDate: weeksAgoIso(1), magnitude: 45 },
  { id: "event-2", scenarioId: "scenario-2", nodeId: "node-ven-01", eventType: "demora", startDate: weeksAgoIso(2), magnitude: 30 },
  { id: "event-3", scenarioId: "scenario-3", nodeId: "node-sup-02", eventType: "huelga", startDate: weeksAgoIso(3), magnitude: 25 },
  // Segundo evento sobre el MISMO nodo que event-3: un escenario afecta un único nodo, pero puede
  // acumularle varios eventos.
  { id: "event-4", scenarioId: "scenario-3", nodeId: "node-sup-02", eventType: "corte", startDate: weeksAgoIso(2), magnitude: 20 },
];

function buildResult(scenario: Scenario, events: DisruptionEvent[], runId: string, runDate: string): ScenarioResult {
  const chainNodes = seedNodes.filter((n) => n.chainId === scenario.chainId);
  const chainNodeIds = new Set(chainNodes.map((n) => n.id));
  const chainEdges = seedEdges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId));
  const seed = hashSeed(runId);

  const outcome = runScenarioSimulation(
    chainNodes,
    chainEdges,
    events,
    seedWeeklyPerformance,
    scenario.projectionHorizonWeeks,
    { seed },
  );

  return {
    id: runId,
    scenarioId: scenario.id,
    runDate,
    kTable: outcome.kTable,
    replications: outcome.replications,
    seed,
    reconfigurationWeekIndex: outcome.reconfigurationWeekIndex,
  };
}

export const seedResults: ScenarioResult[] = [
  ...seedScenarios.map((scenario) =>
    buildResult(
      scenario,
      seedEvents.filter((e) => e.scenarioId === scenario.id),
      `result-${scenario.id}`,
      scenario.createdAt,
    ),
  ),
  // Segunda corrida del mismo escenario: cada corrida se conserva por separado, no se pisa
  // la anterior (RF030) — el listado de corridas del resultado arranca con algo que mostrar.
  buildResult(
    seedScenarios[0],
    seedEvents.filter((e) => e.scenarioId === seedScenarios[0].id),
    `result-${seedScenarios[0].id}-2`,
    weeksAgoIso(0),
  ),
];
