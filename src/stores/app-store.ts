import { create } from "zustand";
import { toast } from "sonner";
import type { AppSnapshot } from "@/lib/data/snapshot-types";
import { DEFAULT_PLAN, type PlanId } from "@/lib/plans";
import type {
  Chain,
  DisruptionEvent,
  NodeType,
  PendingRun,
  Scenario,
  ScenarioResult,
  SupplyChainEdge,
  SupplyChainNode,
  WeeklyPerformance,
} from "@/lib/domain/types";

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

type NodePatch = Partial<
  Pick<SupplyChainNode, "label" | "supplyCapacity" | "productionCapacity" | "storageCapacity" | "currentStockLevel">
> & { position?: { x: number; y: number } };

/** Cuánto se espera antes de mandar un cambio: agrupa lo que se tipea letra por letra en un solo guardado. */
const PATCH_DEBOUNCE_MS = 450;

// --- Escritura al servidor -----------------------------------------------------------------
//
// El store es una copia de trabajo: cada acción cambia el estado local al instante (la UI no
// espera) y después persiste vía API. Si el servidor rechaza el cambio se deshace lo local y se
// avisa. Todas las escrituras salen por UNA cola, en el orden en que se hicieron: así "crear nodo"
// siempre llega antes que "conectarlo" o "renombrarlo".

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

type SendResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function send<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<SendResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return { ok: true, data: (await response.json().catch(() => null)) as T };
    if (response.status === 401) {
      window.location.href = "/login";
      return { ok: false, error: "Tu sesión venció" };
    }
    const data = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    return { ok: false, error: data?.error ?? "No se pudo guardar el cambio", code: data?.code };
  } catch {
    return { ok: false, error: "Sin conexión: el cambio no se guardó" };
  }
}

interface PendingPatch {
  timer: ReturnType<typeof setTimeout>;
  /** Campos modificados con su valor NUEVO (lo que se manda). */
  next: Record<string, unknown>;
  /** Valor que tenían antes del primer cambio del lote (a lo que se vuelve si falla). */
  before: Record<string, unknown>;
}

const pendingNodePatches = new Map<string, PendingPatch>();
const pendingEdgePatches = new Map<string, PendingPatch>();

function schedulePatch(
  pending: Map<string, PendingPatch>,
  id: string,
  next: Record<string, unknown>,
  before: Record<string, unknown>,
  flush: (id: string) => void,
) {
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    Object.assign(existing.next, next);
    for (const [key, value] of Object.entries(before)) if (!(key in existing.before)) existing.before[key] = value;
  }
  const timer = setTimeout(() => flush(id), PATCH_DEBOUNCE_MS);
  pending.set(id, existing ? Object.assign(existing, { timer }) : { timer, next: { ...next }, before: { ...before } });
}

/** `undefined` (campo vaciado) viaja como `null`: en JSON `undefined` se perdería y no se borraría nada. */
const nullify = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === undefined ? null : value]));

interface AppState {
  userId: string;
  organizationName: string;
  /** Plan de la organización (topes de nodos y escenarios guardados). El servidor es quien los hace cumplir. */
  plan: PlanId;
  canWrite: boolean;
  canRun: boolean;
  chains: Chain[];
  nodes: SupplyChainNode[];
  edges: SupplyChainEdge[];
  weeklyPerformance: WeeklyPerformance[];
  scenarios: Scenario[];
  events: DisruptionEvent[];
  results: ScenarioResult[];
  /** Corridas en curso (job en background simulado) — ver PendingRun. */
  pendingRuns: PendingRun[];

  /** Reemplaza la copia de trabajo con lo que el servidor leyó de la base. */
  hydrate: (snapshot: AppSnapshot) => void;
  /** Refleja en el cliente un cambio de plan ya confirmado por el servidor. */
  setPlan: (plan: PlanId) => void;
  /**
   * Suma al store una cadena que el servidor acaba de crear, con el historial de desempeño que el
   * pipeline de ingesta le cargó a cada nodo.
   */
  registerCreatedChain: (data: {
    chain: Chain;
    nodes: SupplyChainNode[];
    edges: SupplyChainEdge[];
    weeklyPerformance?: WeeklyPerformance[];
  }) => void;
  /**
   * Monitoreo vivo: avanza `weeks` semanas simuladas el desempeño de todos los nodos de la cadena. Espera al
   * servidor (el dato nuevo lo genera él) y suma las filas a la copia de trabajo. No muestra avisos: quien lo
   * llama decide qué hacer con el error (p. ej. frenar el reproductor).
   */
  advanceChain: (chainId: string, weeks: number) => Promise<{ ok: true } | { ok: false; error: string; code?: string }>;
  /**
   * Reemplaza con la del modelo de ML las líneas base de los Vendedores que quedaron provisorias (el servicio estaba
   * dormido al crear la cadena). Espera al servidor: puede tardar hasta un minuto si hay que despertarlo.
   */
  refreshBaselines: (chainId: string) => Promise<{ ok: true; updated: number; stillProvisional: number } | { ok: false; error: string }>;
  /** Vuelve la cadena a su historial original (borra las semanas avanzadas). */
  resetMonitoring: (chainId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Elimina la cadena y todo lo que cuelga de ella. NO es optimista: espera al servidor (es
   * irreversible) y recién si confirma la saca del store. Devuelve el error si no se pudo.
   */
  deleteChain: (chainId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Elimina el escenario con sus eventos y todas sus corridas. No es optimista: es irreversible. */
  deleteScenario: (
    scenarioId: string,
    /** Corre apenas el servidor confirma y ANTES de sacarlo del store (para navegar sin parpadeo). */
    onServerConfirmed?: () => void,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  addNode: (chainId: string, nodeType: NodeType, label: string, position: { x: number; y: number }) => string;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNode: (nodeId: string, patch: Omit<NodePatch, "position">) => void;
  addEdge: (sourceNodeId: string, targetNodeId: string, transitTimeDays: number) => string;
  updateEdge: (edgeId: string, patch: Partial<Pick<SupplyChainEdge, "transitTimeDays">>) => void;
  removeEdge: (edgeId: string) => void;
  removeNode: (nodeId: string) => RemoveNodeResult;
  /**
   * Borra el nodo junto con sus aristas en una sola operación. Respeta la regla del modelo
   * (una arista nunca queda apuntando a un nodo inexistente). Es la acción explícita que dispara
   * el usuario cuando confirma que quiere llevarse también las conexiones.
   */
  removeNodeWithEdges: (nodeId: string) => RemoveNodeResult;
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

export const useAppStore = create<AppState>()((set, get) => {
  function flushNodePatch(nodeId: string) {
    const entry = pendingNodePatches.get(nodeId);
    if (!entry) return;
    pendingNodePatches.delete(nodeId);

    void enqueue(async () => {
      const result = await send("PATCH", `/api/nodos/${nodeId}`, nullify(entry.next));
      if (result.ok) return;
      // Vuelve a lo que había antes del primer cambio del lote.
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const { position, ...fields } = entry.before as NodePatch;
          return { ...n, ...fields, ...(position && { canvasPosition: position }) };
        }),
      }));
      toast.error(result.error);
    });
  }

  function flushEdgePatch(edgeId: string) {
    const entry = pendingEdgePatches.get(edgeId);
    if (!entry) return;
    pendingEdgePatches.delete(edgeId);

    void enqueue(async () => {
      const result = await send("PATCH", `/api/aristas/${edgeId}`, entry.next);
      if (result.ok) return;
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId ? { ...e, ...(entry.before as Partial<SupplyChainEdge>) } : e)),
      }));
      toast.error(result.error);
    });
  }

  function applyNodePatch(nodeId: string, patch: NodePatch) {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const { position, ...fields } = patch;
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) before[key] = node[key as keyof SupplyChainNode];
    if (position) before.position = node.canvasPosition;

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...fields, ...(position && { canvasPosition: position }) } : n,
      ),
    }));
    schedulePatch(pendingNodePatches, nodeId, { ...fields, ...(position && { position }) }, before, flushNodePatch);
  }

  return {
    userId: "",
    organizationName: "",
    plan: DEFAULT_PLAN,
    canWrite: false,
    canRun: false,
    chains: [],
    nodes: [],
    edges: [],
    weeklyPerformance: [],
    scenarios: [],
    events: [],
    results: [],
    pendingRuns: [],

    setPlan: (plan) => set({ plan }),

    hydrate: (snapshot) => {
      set({
        userId: snapshot.userId,
        organizationName: snapshot.organizationName,
        plan: snapshot.plan,
        canWrite: snapshot.canWrite,
        canRun: snapshot.canRun,
        chains: snapshot.chains,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        weeklyPerformance: snapshot.weeklyPerformance,
        scenarios: snapshot.scenarios,
        events: snapshot.events,
        results: snapshot.results,
      });
    },

    registerCreatedChain: ({ chain, nodes, edges, weeklyPerformance = [] }) => {
      set((s) => {
        const incoming = new Set(nodes.map((n) => n.id));
        return {
          chains: s.chains.some((c) => c.id === chain.id) ? s.chains : [...s.chains, chain],
          nodes: [...s.nodes.filter((n) => n.chainId !== chain.id), ...nodes],
          edges: [...s.edges, ...edges.filter((e) => !s.edges.some((x) => x.id === e.id))],
          weeklyPerformance: [...s.weeklyPerformance.filter((w) => !incoming.has(w.nodeId)), ...weeklyPerformance],
        };
      });
    },

    advanceChain: async (chainId, weeks) => {
      const result = await enqueue(() =>
        send<{ weeklyPerformance: WeeklyPerformance[] }>("POST", `/api/cadenas/${chainId}/avance`, { weeks }),
      );
      if (!result.ok) return result;
      const incoming = result.data?.weeklyPerformance ?? [];
      set((s) => {
        const known = new Set(s.weeklyPerformance.map((w) => `${w.nodeId}|${w.weekStart}`));
        return { weeklyPerformance: [...s.weeklyPerformance, ...incoming.filter((w) => !known.has(`${w.nodeId}|${w.weekStart}`))] };
      });
      return { ok: true };
    },

    refreshBaselines: async (chainId) => {
      const result = await enqueue(() =>
        send<{ updated: number; stillProvisional: number; nodes: SupplyChainNode[]; weeklyPerformance: WeeklyPerformance[] }>(
          "POST",
          `/api/cadenas/${chainId}/linea-base`,
        ),
      );
      if (!result.ok) return result;
      const data = result.data;
      if (!data) return { ok: false, error: "Respuesta vacía del servidor" };
      const updatedIds = new Set(data.nodes.map((n) => n.id));
      set((s) => ({
        nodes: s.nodes.map((n) => {
          const fresh = data.nodes.find((u) => u.id === n.id);
          return fresh ? { ...n, olistSellerId: fresh.olistSellerId, baselineSource: fresh.baselineSource } : n;
        }),
        weeklyPerformance: [...s.weeklyPerformance.filter((w) => !updatedIds.has(w.nodeId)), ...data.weeklyPerformance],
      }));
      return { ok: true, updated: data.updated, stillProvisional: data.stillProvisional };
    },

    resetMonitoring: async (chainId) => {
      const result = await enqueue(() =>
        send<{ weeklyPerformance: WeeklyPerformance[] }>("DELETE", `/api/cadenas/${chainId}/avance`),
      );
      if (!result.ok) return result;
      const nodeIds = new Set(get().nodes.filter((n) => n.chainId === chainId).map((n) => n.id));
      const kept = result.data?.weeklyPerformance ?? [];
      set((s) => ({ weeklyPerformance: [...s.weeklyPerformance.filter((w) => !nodeIds.has(w.nodeId)), ...kept] }));
      return { ok: true };
    },

    deleteChain: async (chainId) => {
      // Los guardados pendientes de sus nodos ya no tienen a dónde ir.
      const nodeIds = new Set(get().nodes.filter((n) => n.chainId === chainId).map((n) => n.id));
      for (const [id, entry] of pendingNodePatches) {
        if (nodeIds.has(id)) {
          clearTimeout(entry.timer);
          pendingNodePatches.delete(id);
        }
      }

      const result = await enqueue(() => send("DELETE", `/api/cadenas/${chainId}`));
      if (!result.ok) return result;

      set((s) => {
        const scenarioIds = new Set(s.scenarios.filter((sc) => sc.chainId === chainId).map((sc) => sc.id));
        return {
          chains: s.chains.filter((c) => c.id !== chainId),
          nodes: s.nodes.filter((n) => n.chainId !== chainId),
          edges: s.edges.filter((e) => !nodeIds.has(e.sourceNodeId) && !nodeIds.has(e.targetNodeId)),
          weeklyPerformance: s.weeklyPerformance.filter((w) => !nodeIds.has(w.nodeId)),
          scenarios: s.scenarios.filter((sc) => sc.chainId !== chainId),
          events: s.events.filter((e) => !scenarioIds.has(e.scenarioId)),
          results: s.results.filter((r) => !scenarioIds.has(r.scenarioId)),
        };
      });
      return { ok: true };
    },

    deleteScenario: async (scenarioId, onServerConfirmed) => {
      const result = await enqueue(() => send("DELETE", `/api/escenarios/${scenarioId}`));
      if (!result.ok) return result;
      onServerConfirmed?.();

      set((s) => ({
        scenarios: s.scenarios.filter((sc) => sc.id !== scenarioId),
        events: s.events.filter((e) => e.scenarioId !== scenarioId),
        results: s.results.filter((r) => r.scenarioId !== scenarioId),
        pendingRuns: s.pendingRuns.filter((r) => r.scenarioId !== scenarioId),
      }));
      return { ok: true };
    },

    addNode: (chainId, nodeType, label, position) => {
      const id = crypto.randomUUID();
      set((state) => ({
        nodes: [...state.nodes, { id, chainId, nodeType, label, canvasPosition: position }],
      }));
      void enqueue(async () => {
        const result = await send<{ node: SupplyChainNode; weeklyPerformance: WeeklyPerformance[] }>("POST", `/api/cadenas/${chainId}/nodos`, {
          id,
          tipo: nodeType,
          etiqueta: label,
          x: position.x,
          y: position.y,
        });
        if (result.ok) {
          // El servidor le cargó al nodo su historial de desempeño: se suma a la copia de trabajo.
          const incoming = result.data?.weeklyPerformance ?? [];
          const saved = result.data?.node;
          set((s) => ({
            // Un Vendedor trae además su vendedor real de Olist y de dónde salió su línea base.
            nodes: saved ? s.nodes.map((n) => (n.id === id ? { ...n, olistSellerId: saved.olistSellerId, baselineSource: saved.baselineSource } : n)) : s.nodes,
            weeklyPerformance: [...s.weeklyPerformance.filter((w) => w.nodeId !== id), ...incoming],
          }));
          return;
        }
        set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) }));
        toast.error(result.error);
      });
      return id;
    },

    updateNodePosition: (nodeId, position) => applyNodePatch(nodeId, { position }),

    updateNode: (nodeId, patch) => applyNodePatch(nodeId, patch),

    addEdge: (sourceNodeId, targetNodeId, transitTimeDays) => {
      const id = crypto.randomUUID();
      set((state) => ({
        edges: [...state.edges, { id, sourceNodeId, targetNodeId, transitTimeDays }],
      }));
      void enqueue(async () => {
        const result = await send("POST", "/api/aristas", { id, sourceNodeId, targetNodeId, transitTimeDays });
        if (result.ok) return;
        set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
        toast.error(result.error);
      });
      return id;
    },

    updateEdge: (edgeId, patch) => {
      const edge = get().edges.find((e) => e.id === edgeId);
      if (!edge || patch.transitTimeDays === undefined) return;
      set((state) => ({
        edges: state.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
      }));
      schedulePatch(
        pendingEdgePatches,
        edgeId,
        { transitTimeDays: patch.transitTimeDays },
        { transitTimeDays: edge.transitTimeDays },
        flushEdgePatch,
      );
    },

    removeEdge: (edgeId) => {
      const edge = get().edges.find((e) => e.id === edgeId);
      if (!edge) return;
      set((state) => ({ edges: state.edges.filter((e) => e.id !== edgeId) }));
      void enqueue(async () => {
        const result = await send("DELETE", `/api/aristas/${edgeId}`);
        if (result.ok) return;
        set((s) => ({ edges: s.edges.some((e) => e.id === edgeId) ? s.edges : [...s.edges, edge] }));
        toast.error(result.error);
      });
    },

    removeNode: (nodeId) => {
      const state = get();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return { ok: false, reason: "El nodo ya no existe." };
      if (state.edges.some((e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId)) {
        return { ok: false, reason: "Desconectá el nodo de todas sus aristas antes de eliminarlo." };
      }
      if (state.events.some((e) => e.nodeId === nodeId)) {
        return { ok: false, reason: "No se puede eliminar: hay simulaciones que usan este nodo." };
      }
      set((s) => ({ nodes: s.nodes.filter((n) => n.id !== nodeId) }));
      void enqueue(async () => {
        const result = await send("DELETE", `/api/nodos/${nodeId}`);
        if (result.ok) return;
        set((s) => ({ nodes: s.nodes.some((n) => n.id === nodeId) ? s.nodes : [...s.nodes, node] }));
        toast.error(result.error);
      });
      return { ok: true };
    },

    removeNodeWithEdges: (nodeId) => {
      const state = get();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return { ok: false, reason: "El nodo ya no existe." };
      if (state.events.some((e) => e.nodeId === nodeId)) {
        return { ok: false, reason: "No se puede eliminar: hay simulaciones que usan este nodo." };
      }
      const removedEdges = state.edges.filter((e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId);
      set((s) => ({
        edges: s.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        nodes: s.nodes.filter((n) => n.id !== nodeId),
      }));
      void enqueue(async () => {
        const result = await send("DELETE", `/api/nodos/${nodeId}?cascade=true`);
        if (result.ok) return;
        set((s) => ({
          nodes: s.nodes.some((n) => n.id === nodeId) ? s.nodes : [...s.nodes, node],
          edges: [...s.edges, ...removedEdges.filter((e) => !s.edges.some((x) => x.id === e.id))],
        }));
        toast.error(result.error);
      });
      return { ok: true };
    },

    createScenario: (chainId, name, projectionHorizonWeeks, nodeId, newEvents) => {
      // Los ids los genera el cliente: el escenario se ve al instante (la pantalla de resultado
      // arranca su animación de espera) mientras el servidor corre la simulación y la guarda.
      const scenarioId = crypto.randomUUID();
      const events: DisruptionEvent[] = newEvents.map((e) => ({
        id: crypto.randomUUID(),
        scenarioId,
        nodeId,
        eventType: e.eventType,
        startDate: e.startDate,
        magnitude: e.magnitude,
      }));
      const scenario: Scenario = {
        id: scenarioId,
        chainId,
        userId: get().userId,
        projectionHorizonWeeks,
        name,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const pendingId = genId("run");

      set((s) => ({
        scenarios: [...s.scenarios, scenario],
        events: [...s.events, ...events],
        pendingRuns: [...s.pendingRuns, { id: pendingId, scenarioId, startedAt: Date.now() }],
      }));

      void enqueue(async () => {
        const result = await send<{ result: ScenarioResult }>("POST", "/api/escenarios", {
          id: scenarioId,
          chainId,
          name,
          projectionHorizonWeeks,
          nodeId,
          events: events.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            startDate: e.startDate,
            magnitude: e.magnitude,
          })),
        });

        if (!result.ok) {
          // No se pudo guardar ni correr: el escenario desaparece igual que si nunca se hubiera creado.
          set((s) => ({
            scenarios: s.scenarios.filter((sc) => sc.id !== scenarioId),
            events: s.events.filter((e) => e.scenarioId !== scenarioId),
            pendingRuns: s.pendingRuns.filter((r) => r.id !== pendingId),
          }));
          toast.error(result.error);
          return;
        }
        set((s) => ({
          results: [...s.results, result.data.result],
          pendingRuns: s.pendingRuns.filter((r) => r.id !== pendingId),
        }));
      });

      return scenarioId;
    },

    rerunScenario: (scenarioId, reconfigurationWeekIndex = null) => {
      const pendingId = genId("run");
      set((s) => ({ pendingRuns: [...s.pendingRuns, { id: pendingId, scenarioId, startedAt: Date.now() }] }));

      void enqueue(async () => {
        const result = await send<{ result: ScenarioResult }>("POST", `/api/escenarios/${scenarioId}/corridas`, {
          reconfigurationWeekIndex,
        });
        set((s) => ({
          pendingRuns: s.pendingRuns.filter((r) => r.id !== pendingId),
          ...(result.ok && { results: [...s.results, result.data.result] }),
        }));
        if (!result.ok) toast.error(result.error);
      });
    },
  };
});
