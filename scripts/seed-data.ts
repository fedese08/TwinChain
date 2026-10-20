import { addWeeks, startOfWeek, toIsoDate } from "@/lib/domain/dates";
import { hashSeed } from "@/lib/domain/rng";
import { runScenarioSimulation } from "@/lib/domain/simulate";
import { buildChainHistory, HISTORY_WEEKS } from "@/lib/domain/synthetic";
import { adaptForEngine } from "@/lib/domain/units";
import { REAL_VENDEDORES_ENABLED } from "@/lib/domain/vendedor/config";
import { assignSellers } from "@/lib/domain/vendedor/assign";
import { provisionalVendedorBaseline, type NodeBaseline } from "@/lib/domain/vendedor/baseline";
import { getSellerWeeks, poolSellers } from "@/lib/olist/sample";
import type {
  Chain,
  DisruptionEvent,
  Organization,
  Scenario,
  ScenarioResult,
  SupplyChainEdge,
  SupplyChainNode,
  User,
  UserRole,
  WeeklyPerformance,
} from "@/lib/domain/types";

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

/**
 * Con `REAL_VENDEDORES_ENABLED` encendido, los Vendedores de la demo usan vendedores REALES de Olist (en días de
 * margen), como cualquier cadena que se cree en la app; apagado (hoy), son sintéticos como todos los nodos. La asignación es determinística (función del id del nodo) y no repite vendedores dentro de la
 * cadena. El `seller_id` queda en `olistSellerId`; la fuente de la línea base la fija `seed.ts` al resolverla.
 */
for (const chain of seedChains) {
  if (!REAL_VENDEDORES_ENABLED) break;
  const vendedores = seedNodes.filter((n) => n.chainId === chain.id && n.nodeType === "Vendedor");
  const assignment = assignSellers(vendedores.map((n) => n.id), poolSellers(), new Set(), HISTORY_WEEKS);
  for (const node of vendedores) node.olistSellerId = assignment.get(node.id);
}

/** Los nodos Vendedor reales de la demo: lo que `seed.ts` tiene que resolver contra el modelo de ML. */
export const seedVendedorNodes = seedNodes.filter((n) => n.olistSellerId);

/**
 * Historial de desempeño de la demo, generado por el mismo pipeline de ingesta que usa la app al
 * crear una cadena (`lib/domain/synthetic`): la línea base se ESTIMA del historial de cada nodo y se
 * congela (RF017), sin perfiles escritos a mano por id.
 *
 * "Cadena Sur" lleva un cambio de nivel a propósito: la demo tiene que poder mostrar los dos
 * veredictos de la verificación de estabilidad (C24) — "Cadena Norte" sale estable.
 */
const CHAINS_WITH_LEVEL_SHIFT = new Set(["chain-sur"]);

/**
 * `baselines`: la línea base de cada nodo (por id de la semilla), estimada por el modelo de ML con las primeras
 * semanas de su sensor simulado, o la provisoria si el servicio no contesta; `seed.ts` la resuelve antes de armar los
 * datos. `idOf` da el id con el que el nodo queda guardado (la serie del sensor depende de él, así que tiene que ser
 * el mismo con el que luego continúa el monitoreo vivo); devuelve filas con ESE id.
 */
export function buildSeedWeeklyPerformance(
  baselines: ReadonlyMap<string, NodeBaseline>,
  idOf: (seedId: string) => string = (seedId) => seedId,
): WeeklyPerformance[] {
  return seedChains.flatMap((chain) => {
    const chainNodes = seedNodes
      .filter((n) => n.chainId === chain.id)
      .map((n) => {
        const id = idOf(n.id);
        if (n.olistSellerId) {
          const realWeeks = getSellerWeeks(n.olistSellerId)!;
          const baseline = baselines.get(n.id) ?? provisionalVendedorBaseline(realWeeks.slice(0, 4).map((w) => w.margen));
          return { id, type: n.nodeType, vendedor: { realWeeks, baseline } };
        }
        const baseline = baselines.get(n.id);
        return baseline ? { id, type: n.nodeType, baseline } : { id, type: n.nodeType };
      });
    const { rows } = buildChainHistory(chainNodes, { withLevelShift: CHAINS_WITH_LEVEL_SHIFT.has(chain.id) });
    return rows.map((row) => ({ ...row, id: `wp-${row.nodeId}-${row.weekStart}` }));
  });
}

export function weeksAgoIso(weeks: number): string {
  return toIsoDate(addWeeks(startOfWeek(new Date()), -weeks));
}

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

function buildResult(
  scenario: Scenario,
  events: DisruptionEvent[],
  runId: string,
  runDate: string,
  weeklyPerformance: WeeklyPerformance[],
  baselines: ReadonlyMap<string, NodeBaseline>,
): ScenarioResult {
  // Los nodos con línea base del modelo (o provisoria) miden en días: se marcan para que el adaptador los reconozca.
  const chainNodes = seedNodes
    .filter((n) => n.chainId === scenario.chainId)
    .map((n) => ({ ...n, baselineSource: baselines.get(n.id)?.source ?? n.baselineSource }));
  const chainNodeIds = new Set(chainNodes.map((n) => n.id));
  const chainEdges = seedEdges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId));
  const seed = hashSeed(runId);

  // Igual que la app: los Vendedor en días se pasan a escala relativa antes del motor (domain/units.ts).
  const adapter = adaptForEngine(chainNodes, weeklyPerformance);
  const outcome = runScenarioSimulation(
    chainNodes,
    chainEdges,
    events,
    adapter.rows,
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

/** `weeklyPerformance` con los ids de la semilla (los de `seedNodes`), igual que `seedEvents`. */
export function buildSeedResults(weeklyPerformance: WeeklyPerformance[], baselines: ReadonlyMap<string, NodeBaseline>): ScenarioResult[] {
  return [
    ...seedScenarios.map((scenario) =>
      buildResult(
        scenario,
        seedEvents.filter((e) => e.scenarioId === scenario.id),
        `result-${scenario.id}`,
        scenario.createdAt,
        weeklyPerformance,
        baselines,
      ),
    ),
    // Segunda corrida del mismo escenario: cada corrida se conserva por separado, no se pisa
    // la anterior (RF030) — el listado de corridas del resultado arranca con algo que mostrar.
    buildResult(
      seedScenarios[0],
      seedEvents.filter((e) => e.scenarioId === seedScenarios[0].id),
      `result-${seedScenarios[0].id}-2`,
      weeksAgoIso(0),
      weeklyPerformance,
      baselines,
    ),
  ];
}
