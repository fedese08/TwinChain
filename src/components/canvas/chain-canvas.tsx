"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Connection,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge as rfAddEdge,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodePalette } from "@/components/canvas/node-palette";
import { NodeInspector } from "@/components/canvas/node-inspector";
import { EdgeInspector } from "@/components/canvas/edge-inspector";
import { SupplyChainNodeView, type SupplyChainNodeData } from "@/components/canvas/supply-chain-node";
import { TransitEdge } from "@/components/canvas/transit-edge";
import { useAppStore } from "@/stores/app-store";
import type { Severity } from "@/lib/domain/simulate";
import { assessNode } from "@/lib/domain/monitoring";
import { unitOfNode } from "@/lib/domain/units";
import type { NodeType, SupplyChainNode, WeeklyPerformance } from "@/lib/domain/types";

const NODE_TYPES = { supplyChainNode: SupplyChainNodeView };
const EDGE_TYPES = { transitEdge: TransitEdge };

export type ChainCanvasMode = "edit" | "select" | "display";

function nodeDetail(node: SupplyChainNode): string {
  if (node.nodeType === "Proveedor") {
    return node.supplyCapacity ? `sum. ${node.supplyCapacity} u/sem` : "sin capacidad cargada";
  }
  if (node.nodeType === "Fabrica") {
    return node.productionCapacity ? `prod. ${node.productionCapacity} u/sem` : "sin capacidad cargada";
  }
  if (node.nodeType === "Almacen") {
    if (!node.storageCapacity) return "sin capacidad cargada";
    // Con stock cargado se muestra la ocupación, que es más informativa que la capacidad sola.
    return node.currentStockLevel !== undefined
      ? `${node.currentStockLevel}/${node.storageCapacity} u`
      : `almac. ${node.storageCapacity} u`;
  }
  // Vendedor con datos reales de Olist: se muestra de dónde salen sus datos.
  if (node.olistSellerId) return `Olist · ${node.olistSellerId.slice(0, 8)}`;
  return "sin atributos propios";
}

interface CanvasInnerProps {
  chainId: string;
  mode: ChainCanvasMode;
  selectedNodeIds?: string[];
  onNodeSelect?: (nodeId: string) => void;
  severityByNode?: Record<string, Severity>;
  severityByEdge?: Record<string, Severity>;
}

function CanvasInner({ chainId, mode, selectedNodeIds, onNodeSelect, severityByNode, severityByEdge }: CanvasInnerProps) {
  const isEdit = mode === "edit";
  const isSelect = mode === "select";
  const isDisplay = mode === "display";

  const allNodes = useAppStore((s) => s.nodes);
  const allEdges = useAppStore((s) => s.edges);
  const weeklyPerformance = useAppStore((s) => s.weeklyPerformance);
  const updateNodePosition = useAppStore((s) => s.updateNodePosition);
  const addEdgeToStore = useAppStore((s) => s.addEdge);
  const addNodeToStore = useAppStore((s) => s.addNode);

  const chainNodes = useMemo(() => allNodes.filter((n) => n.chainId === chainId), [allNodes, chainId]);
  const chainNodeIds = useMemo(() => new Set(chainNodes.map((n) => n.id)), [chainNodes]);
  const chainEdges = useMemo(
    () => allEdges.filter((e) => chainNodeIds.has(e.sourceNodeId) && chainNodeIds.has(e.targetNodeId)),
    [allEdges, chainNodeIds],
  );

  const healthByNode = useMemo(() => {
    const rowsByNode = new Map<string, WeeklyPerformance[]>();
    for (const row of weeklyPerformance) {
      if (!chainNodeIds.has(row.nodeId)) continue;
      const list = rowsByNode.get(row.nodeId) ?? [];
      list.push(row);
      rowsByNode.set(row.nodeId, list);
    }
    return new Map([...chainNodeIds].map((nodeId) => [nodeId, assessNode(rowsByNode.get(nodeId) ?? [])]));
  }, [weeklyPerformance, chainNodeIds]);

  const selectedSet = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);

  const rebuiltNodes = useMemo(
    (): Node[] =>
      chainNodes.map((n) => ({
        id: n.id,
        type: "supplyChainNode",
        position: n.canvasPosition,
        // Tamaño fijo y conocido de antemano (ver supply-chain-node.tsx): se lo declaramos a
        // React Flow para que no dependa de ResizeObserver para "medir" el nodo antes de mostrarlo.
        width: 150,
        height: 86,
        data: {
          label: n.label,
          nodeType: n.nodeType,
          detail: nodeDetail(n),
          recentDeficit: healthByNode.get(n.id)?.recentDeficit ?? 0,
          unit: unitOfNode(n),
          health: healthByNode.get(n.id)?.level ?? "normal",
          highlighted: isSelect && selectedSet.has(n.id),
          severity: isDisplay ? severityByNode?.[n.id] : undefined,
        } satisfies SupplyChainNodeData,
      })),
    [chainNodes, healthByNode, isSelect, selectedSet, isDisplay, severityByNode],
  );

  const rebuiltEdges = useMemo(
    (): Edge[] =>
      chainEdges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        type: "transitEdge",
        data: { transitTimeDays: e.transitTimeDays, severity: isDisplay ? severityByEdge?.[e.id] : undefined },
      })),
    [chainEdges, isDisplay, severityByEdge],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>(rebuiltNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(rebuiltEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Mergea sobre los nodos/aristas que React Flow ya está gestionando en vez de
  // reemplazarlos: un `setRfNodes(rebuiltNodes)` a secas le hace perder a React Flow
  // el estado interno de medición (measured/dragging) y los deja en visibility:hidden.
  useEffect(() => {
    setRfNodes((current) => {
      const existingById = new Map(current.map((n) => [n.id, n]));
      return rebuiltNodes.map((n) => {
        const existing = existingById.get(n.id);
        return existing ? { ...existing, position: n.position, data: n.data } : n;
      });
    });
  }, [rebuiltNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges((current) => {
      const existingById = new Map(current.map((e) => [e.id, e]));
      return rebuiltEdges.map((e) => {
        const existing = existingById.get(e.id);
        return existing ? { ...existing, data: e.data } : e;
      });
    });
  }, [rebuiltEdges, setRfEdges]);

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      // Siempre se aplica: React Flow necesita procesar los cambios de tipo "dimensions"
      // para marcar los nodos como medidos, o quedan en visibility:hidden para siempre.
      onNodesChange(changes);
      if (!isEdit) return;
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          updateNodePosition(change.id, change.position);
        }
        if (change.type === "remove") {
          setSelectedNodeId((current) => (current === change.id ? null : current));
        }
      }
    },
    [onNodesChange, updateNodePosition, isEdit],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edgeId = addEdgeToStore(connection.source, connection.target, 3);
      setRfEdges((eds) =>
        rfAddEdge({ ...connection, id: edgeId, type: "transitEdge", data: { transitTimeDays: 3 } }, eds),
      );
    },
    [addEdgeToStore, setRfEdges],
  );

  function handleAddNode(type: NodeType) {
    const prefix = type.slice(0, 3).toUpperCase();

    // El número sale del máximo sufijo ya usado, no de cuántos nodos hay: contando, al borrar
    // un nodo el siguiente que se crea reciclaba su mismo nombre y parecía que el borrado
    // "volvía a aparecer".
    const usedNumbers = chainNodes
      .map((n) => new RegExp(`^${prefix}-(\\d+)$`).exec(n.label)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    const nextNumber = (usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0) + 1;
    const label = `${prefix}-${String(nextNumber).padStart(2, "0")}`;

    // Misma razón para la posición: se busca un hueco libre en vez de derivarla de la cantidad
    // de nodos, que hacía que el nodo nuevo cayera exactamente encima del que se acababa de borrar.
    const taken = chainNodes.map((n) => n.canvasPosition);
    const isFree = (x: number, y: number) => !taken.some((p) => Math.abs(p.x - x) < 90 && Math.abs(p.y - y) < 60);
    let position = { x: 120, y: 120 };
    for (let slot = 0; slot < 200; slot++) {
      const x = 120 + (slot % 5) * 180;
      const y = 120 + Math.floor(slot / 5) * 110;
      if (isFree(x, y)) {
        position = { x, y };
        break;
      }
    }

    addNodeToStore(chainId, type, label, position);
  }

  const selectedNode = isEdit && selectedNodeId ? chainNodes.find((n) => n.id === selectedNodeId) : undefined;
  const selectedEdge = isEdit && selectedEdgeId ? chainEdges.find((e) => e.id === selectedEdgeId) : undefined;

  const onNodeClick = isEdit
    ? (_: unknown, node: Node) => {
        setSelectedNodeId(node.id);
        setSelectedEdgeId(null);
      }
    : isSelect && onNodeSelect
      ? (_: unknown, node: Node) => onNodeSelect(node.id)
      : undefined;

  return (
    // `h-full` ademas de `flex-1`: el canvas se usa tanto dentro de un padre flex (pantalla de
    // cadena) como dentro de una caja de alto fijo (red fork del resultado), donde `flex-1` no
    // aplica y sin altura propia colapsaria a 0.
    <div className="flex h-full min-h-0 flex-1">
      {isEdit && <NodePalette nodeCount={chainNodes.length} edgeCount={chainEdges.length} onAddNode={handleAddNode} />}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={isEdit ? handleConnect : undefined}
          nodesDraggable={isEdit}
          nodesConnectable={isEdit}
          elementsSelectable={isEdit || isSelect}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={onNodeClick}
          onEdgeClick={
            isEdit
              ? (_, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                }
              : undefined
          }
          onPaneClick={
            isEdit
              ? () => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }
              : undefined
          }
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={26} color="#dbe1ea" />
          <Controls showInteractive={false} />
          {/* El minimapa sirve para moverse por un canvas que se edita; en la vista de
              resultado (mode="display") la red se mira, no se navega, así que ahí estorba. */}
          {!isDisplay && (
            <MiniMap pannable zoomable style={{ background: "#fafbfd", width: 116, height: 82 }} />
          )}
        </ReactFlow>

        {isSelect && (
          <div className="pointer-events-none absolute left-3.5 top-3.5 rounded-lg border border-border bg-card/90 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
            Hacé click en el nodo que querés afectar — un escenario apunta a un solo nodo
          </div>
        )}

        {isDisplay && (
          <div className="absolute bottom-3.5 left-3.5 flex flex-col gap-1.5 rounded-lg border border-border bg-card/95 px-3 py-2.5 shadow-sm">
            <div className="font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              Propagación
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 rounded-sm border" style={{ background: "#fdece0", borderColor: "#f2703c" }} />
              severo
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 rounded-sm border" style={{ background: "#fdf6e9", borderColor: "#e6b96b" }} />
              moderado
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 rounded-sm border" style={{ background: "#fff", borderColor: "#d6dce6" }} />
              sin efecto
            </div>
          </div>
        )}
      </div>
      {isEdit && selectedNode && <NodeInspector node={selectedNode} onClose={() => setSelectedNodeId(null)} />}
      {isEdit && selectedEdge && <EdgeInspector edge={selectedEdge} onClose={() => setSelectedEdgeId(null)} />}
    </div>
  );
}

export function ChainCanvas(props: { chainId: string } & Partial<Omit<CanvasInnerProps, "chainId">>) {
  const { chainId, mode = "edit", ...rest } = props;
  return (
    <ReactFlowProvider>
      <CanvasInner chainId={chainId} mode={mode} {...rest} />
    </ReactFlowProvider>
  );
}
