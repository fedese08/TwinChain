import { create } from "zustand";
import {
  seedChains,
  seedEdges,
  seedEvents,
  seedNodes,
  seedOrganization,
  seedResults,
  seedRoles,
  seedScenarios,
  seedUser,
  seedWeeklyPerformance,
} from "@/lib/mock/seed";
import { computeChainPropagation, computeKTable } from "@/lib/mock/simulate";
import { instantiateTemplate, type ChainTemplateId } from "@/lib/mock/templates";
import type {
  Chain,
  ChainVisibility,
  DisruptionEvent,
  NodeType,
  Scenario,
  ScenarioResult,
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

  createChain: (name: string, visibility: ChainVisibility, template: ChainTemplateId) => string;
  addNode: (chainId: string, nodeType: NodeType, label: string, position: { x: number; y: number }) => string;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNode: (
    nodeId: string,
    patch: Partial<Pick<SupplyChainNode, "label" | "productionCapacity" | "storageCapacity">>,
  ) => void;
  addEdge: (sourceNodeId: string, targetNodeId: string, transitTimeDays: number) => string;
  updateEdge: (edgeId: string, patch: Partial<Pick<SupplyChainEdge, "transitTimeDays">>) => void;
  removeEdge: (edgeId: string) => void;
  removeNode: (nodeId: string) => RemoveNodeResult;
  createScenario: (
    chainId: string,
    name: string,
    projectionHorizonWeeks: number,
    /** Único nodo afectado por el escenario — todos los eventos caen sobre él. */
    nodeId: string,
    events: NewEventInput[],
  ) => string;
}

export const useMockDbStore = create<MockDbState>()((set, get) => ({
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

  createChain: (name, visibility, template) => {
    const chainId = genId("chain");
    const { nodes, edges } = instantiateTemplate(template, chainId, chainId);
    set((state) => ({
      chains: [...state.chains, { id: chainId, name, organizationId: state.organization.id, visibility }],
      nodes: [...state.nodes, ...nodes],
      edges: [...state.edges, ...edges],
    }));
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

  createScenario: (chainId, name, projectionHorizonWeeks, nodeId, newEvents) => {
    const scenarioId = genId("scenario");
    const state = get();
    const events: DisruptionEvent[] = newEvents.map((e) => ({
      id: genId("event"),
      scenarioId,
      nodeId,
      eventType: e.eventType,
      startDate: e.startDate,
      magnitude: e.magnitude,
    }));

    const chainNodes = state.nodes.filter((n) => n.chainId === chainId);
    const chainNodeIds = new Set(chainNodes.map((n) => n.id));
    const chainEdges = state.edges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId));
    const propagation = computeChainPropagation(chainNodes, chainEdges, events, state.weeklyPerformance, projectionHorizonWeeks);
    let totalDeficit = 0;
    for (const weeks of propagation.values()) {
      totalDeficit += weeks.reduce((sum, w) => sum + w.deficit, 0);
    }

    const scenario: Scenario = {
      id: scenarioId,
      chainId,
      userId: state.user.id,
      projectionHorizonWeeks,
      name,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const result: ScenarioResult = {
      id: genId("result"),
      scenarioId,
      runDate: scenario.createdAt,
      kTable: computeKTable(totalDeficit, projectionHorizonWeeks),
    };

    set((s) => ({
      scenarios: [...s.scenarios, scenario],
      events: [...s.events, ...events],
      results: [...s.results, result],
    }));
    return scenarioId;
  },
}));
