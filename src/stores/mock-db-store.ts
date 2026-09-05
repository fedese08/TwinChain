import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  seedChains,
  seedEdges,
  seedEvents,
  seedNodes,
  seedOrganization,
  seedResults,
  seedRoles,
  seedScenarios,
  seedStabilityChecks,
  seedUser,
  seedWeeklyPerformance,
  weeksAgoIso,
} from "@/lib/mock/seed";
import { hashSeed } from "@/lib/mock/rng";
import { runScenarioSimulation } from "@/lib/mock/simulate";
import { instantiateTemplate, type ChainTemplateId } from "@/lib/mock/templates";
import type {
  Chain,
  ChainVisibility,
  DisruptionEvent,
  NodeType,
  PendingRun,
  Scenario,
  ScenarioResult,
  StabilityCheck,
  SupplyChainEdge,
  SupplyChainNode,
  WeeklyPerformance,
} from "@/lib/mock/types";

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Un evento del formulario de simulación. No lleva `nodeId`: el escenario apunta a un único
 * nodo (RF: eventos sobre un solo nodo a la vez) y ese nodo se pasa aparte a `createScenario`.
 */
export interface NewEventInput {
  eventType: string;
  startDate: string;
  magnitude: number;
}

interface RemoveNodeResult {
  ok: boolean;
  reason?: string;
}

const SIMULATION_JOB_DELAY_MS = 1600;
const INGESTION_CHECK_DELAY_MS = 1300;

interface MockDbState {
  organization: typeof seedOrganization;
  roles: typeof seedRoles;
  user: typeof seedUser;
  chains: Chain[];
  nodes: SupplyChainNode[];
  edges: SupplyChainEdge[];
  weeklyPerformance: WeeklyPerformance[];
  scenarios: Scenario[];
  events: DisruptionEvent[];
  results: ScenarioResult[];
  /** Corridas en curso (job en background simulado) — ver PendingRun. */
  pendingRuns: PendingRun[];
  /** Validación CUSUM por cadena, disparada por el pipeline de ingesta — ver StabilityCheck. */
  stabilityChecks: Record<string, StabilityCheck>;

  createChain: (name: string, visibility: ChainVisibility, template: ChainTemplateId) => string;
  addNode: (chainId: string, nodeType: NodeType, label: string, position: { x: number; y: number }) => string;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNode: (
    nodeId: string,
    patch: Partial<
      Pick<
        SupplyChainNode,
        "label" | "supplyCapacity" | "productionCapacity" | "storageCapacity" | "currentStockLevel"
      >
    >,
  ) => void;
  addEdge: (sourceNodeId: string, targetNodeId: string, transitTimeDays: number) => string;
  updateEdge: (edgeId: string, patch: Partial<Pick<SupplyChainEdge, "transitTimeDays">>) => void;
  removeEdge: (edgeId: string) => void;
  removeNode: (nodeId: string) => RemoveNodeResult;
  /**
   * Borra el nodo junto con sus aristas en una sola operación. Respeta la regla del modelo
   * (una arista nunca queda apuntando a un nodo inexistente): saca primero las aristas y
   * después el nodo, en el mismo `set`. Es la acción explícita que dispara el usuario cuando
   * confirma que quiere llevarse también las conexiones.
   */
  removeNodeWithEdges: (nodeId: string) => void;
  createScenario: (
    chainId: string,
    name: string,
    projectionHorizonWeeks: number,
    /** Único nodo afectado por el escenario — todos los eventos caen sobre él. */
    nodeId: string,
    events: NewEventInput[],
  ) => string;
  /**
   * Vuelve a correr un escenario y guarda una corrida NUEVA sin pisar las anteriores (RF030).
   * `reconfigurationWeekIndex` aplica el escalón de reconfiguración (RF022).
   */
  rerunScenario: (scenarioId: string, reconfigurationWeekIndex?: number | null) => void;
}

/**
 * Almacenamiento de sesión para el mock. Sin backend, el estado vivía solo en memoria: cualquier
 * recarga completa (incluidas las que dispara el HMR en desarrollo) lo reseteaba al seed, con lo
 * cual los nodos creados se perdían y los borrados que venían de la plantilla reaparecían.
 * Se persiste en sessionStorage para que la edición sobreviva la recarga sin volverse permanente.
 * Cuando exista el backend real, esto se reemplaza por las llamadas al servidor.
 */
const sessionStorageOrNoop = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  return window.sessionStorage;
});

export const useMockDbStore = create<MockDbState>()(persist((set, get) => {
  /**
   * Encola una corrida y la resuelve después de una demora, imitando al job en background
   * del monolito (C36): la fila de Resultado aparece recién cuando el job termina.
   */
  function launchSimulationJob(scenarioId: string, reconfigurationWeekIndex: number | null) {
    const runId = genId("result");
    set((s) => ({ pendingRuns: [...s.pendingRuns, { id: runId, scenarioId, startedAt: Date.now() }] }));

    setTimeout(() => {
      const state = get();
      const scenario = state.scenarios.find((sc) => sc.id === scenarioId);
      if (!scenario) {
        set((s) => ({ pendingRuns: s.pendingRuns.filter((r) => r.id !== runId) }));
        return;
      }

      const scenarioEvents = state.events.filter((e) => e.scenarioId === scenarioId);
      const chainNodes = state.nodes.filter((n) => n.chainId === scenario.chainId);
      const chainNodeIds = new Set(chainNodes.map((n) => n.id));
      const chainEdges = state.edges.filter(
        (e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId),
      );
      const seed = hashSeed(runId);

      const outcome = runScenarioSimulation(
        chainNodes,
        chainEdges,
        scenarioEvents,
        state.weeklyPerformance,
        scenario.projectionHorizonWeeks,
        { seed, reconfigurationWeekIndex },
      );

      const result: ScenarioResult = {
        id: runId,
        scenarioId,
        runDate: new Date().toISOString().slice(0, 10),
        kTable: outcome.kTable,
        replications: outcome.replications,
        seed,
        reconfigurationWeekIndex: outcome.reconfigurationWeekIndex,
      };

      set((s) => ({
        results: [...s.results, result],
        pendingRuns: s.pendingRuns.filter((r) => r.id !== runId),
      }));
    }, SIMULATION_JOB_DELAY_MS);
  }

  /**
   * Dispara la validación de estabilidad estructural del pipeline de ingesta (C24). Corre por
   * cada cadena nueva, no como chequeo único de desarrollo. El veredicto es determinístico a
   * partir del id de la cadena para que la demo sea reproducible.
   */
  function launchIngestionCheck(chainId: string) {
    set((s) => ({ stabilityChecks: { ...s.stabilityChecks, [chainId]: { status: "corriendo" } } }));

    setTimeout(() => {
      const stable = hashSeed(chainId) % 4 !== 0;
      const ranAt = new Date().toISOString().slice(0, 10);
      set((s) => ({
        stabilityChecks: {
          ...s.stabilityChecks,
          [chainId]: stable
            ? { status: "estable", ranAt }
            : { status: "alerta", ranAt, changePointWeek: weeksAgoIso(5) },
        },
      }));
    }, INGESTION_CHECK_DELAY_MS);
  }

  return {
    organization: seedOrganization,
    roles: seedRoles,
    user: seedUser,
    chains: seedChains,
    nodes: seedNodes,
    edges: seedEdges,
    weeklyPerformance: seedWeeklyPerformance,
    scenarios: seedScenarios,
    events: seedEvents,
    results: seedResults,
    pendingRuns: [],
    stabilityChecks: seedStabilityChecks,

    createChain: (name, visibility, template) => {
      const chainId = genId("chain");
      const { nodes, edges } = instantiateTemplate(template, chainId, chainId);
      set((state) => ({
        chains: [...state.chains, { id: chainId, name, organizationId: state.organization.id, visibility }],
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...edges],
      }));
      launchIngestionCheck(chainId);
      return chainId;
    },

    addNode: (chainId, nodeType, label, position) => {
      const id = genId("node");
      set((state) => ({
        nodes: [...state.nodes, { id, chainId, nodeType, label, canvasPosition: position }],
      }));
      return id;
    },

    updateNodePosition: (nodeId, position) => {
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, canvasPosition: position } : n)),
      }));
    },

    updateNode: (nodeId, patch) => {
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      }));
    },

    addEdge: (sourceNodeId, targetNodeId, transitTimeDays) => {
      const id = genId("edge");
      set((state) => ({
        edges: [...state.edges, { id, sourceNodeId, targetNodeId, transitTimeDays }],
      }));
      return id;
    },

    updateEdge: (edgeId, patch) => {
      set((state) => ({
        edges: state.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
      }));
    },

    removeEdge: (edgeId) => {
      set((state) => ({ edges: state.edges.filter((e) => e.id !== edgeId) }));
    },

    removeNode: (nodeId) => {
      const hasConnections = get().edges.some((e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId);
      if (hasConnections) {
        return { ok: false, reason: "Desconectá el nodo de todas sus aristas antes de eliminarlo." };
      }
      set((state) => ({ nodes: state.nodes.filter((n) => n.id !== nodeId) }));
      return { ok: true };
    },

    removeNodeWithEdges: (nodeId) => {
      set((state) => ({
        edges: state.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        nodes: state.nodes.filter((n) => n.id !== nodeId),
      }));
    },

    createScenario: (chainId, name, projectionHorizonWeeks, nodeId, newEvents) => {
      const scenarioId = genId("scenario");
      const events: DisruptionEvent[] = newEvents.map((e) => ({
        id: genId("event"),
        scenarioId,
        nodeId,
        eventType: e.eventType,
        startDate: e.startDate,
        magnitude: e.magnitude,
      }));

      const scenario: Scenario = {
        id: scenarioId,
        chainId,
        userId: get().user.id,
        projectionHorizonWeeks,
        name,
        createdAt: new Date().toISOString().slice(0, 10),
      };

      set((s) => ({
        scenarios: [...s.scenarios, scenario],
        events: [...s.events, ...events],
      }));

      // El Resultado no se escribe acá: lo escribe el job cuando termina (C36).
      launchSimulationJob(scenarioId, null);
      return scenarioId;
    },

    rerunScenario: (scenarioId, reconfigurationWeekIndex = null) => {
      launchSimulationJob(scenarioId, reconfigurationWeekIndex);
    },
  };
}, {
  name: "twinchain-mock-db",
  storage: sessionStorageOrNoop,
  version: 1,
  // El servidor no tiene sessionStorage: si se hidratara en el render inicial, el HTML del
  // servidor y el del cliente no coincidirían. Se rehidrata a mano al montar (ver StoreHydration).
  skipHydration: true,
  // `pendingRuns` es estado de un job en vuelo: si se persistiera, al recargar quedaría una
  // corrida "corriendo" que ya no tiene ningún timer detrás.
  partialize: (state) => ({
    organization: state.organization,
    roles: state.roles,
    user: state.user,
    chains: state.chains,
    nodes: state.nodes,
    edges: state.edges,
    weeklyPerformance: state.weeklyPerformance,
    scenarios: state.scenarios,
    events: state.events,
    results: state.results,
    stabilityChecks: state.stabilityChecks,
  }),
}));
