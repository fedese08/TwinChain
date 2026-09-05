import type { NodeType, SupplyChainEdge, SupplyChainNode } from "@/lib/mock/types";

export const CHAIN_TEMPLATES = ["blank", "linear", "forked", "complex"] as const;
export type ChainTemplateId = (typeof CHAIN_TEMPLATES)[number];

export const CHAIN_TEMPLATE_LABELS: Record<ChainTemplateId, { name: string; note: string }> = {
  blank: { name: "En blanco", note: "canvas infinito vacío" },
  linear: { name: "Plantilla lineal", note: "5 nodos preconectados" },
  forked: { name: "Plantilla bifurcada", note: "10 nodos con dos ramas" },
  complex: { name: "Plantilla compleja", note: "20+ nodos multi-planta" },
};

interface TemplateNodeBlueprint {
  nodeType: NodeType;
  label: string;
  x: number;
  y: number;
  supplyCapacity?: number;
  productionCapacity?: number;
  storageCapacity?: number;
  currentStockLevel?: number;
}

interface TemplateEdgeBlueprint {
  from: string;
  to: string;
  transitTimeDays: number;
}

interface TemplateBlueprint {
  nodes: TemplateNodeBlueprint[];
  edges: TemplateEdgeBlueprint[];
}

const LINEAR: TemplateBlueprint = {
  nodes: [
    { nodeType: "Proveedor", label: "SUP-01", x: 40, y: 160, supplyCapacity: 2500 },
    { nodeType: "Fabrica", label: "FAB-01", x: 300, y: 160, productionCapacity: 2000 },
    { nodeType: "Almacen", label: "ALM-01", x: 560, y: 160, storageCapacity: 4000, currentStockLevel: 2600 },
    { nodeType: "Vendedor", label: "VEN-01", x: 820, y: 160 },
    { nodeType: "Cliente", label: "CLI-01", x: 1080, y: 160 },
  ],
  edges: [
    { from: "SUP-01", to: "FAB-01", transitTimeDays: 5 },
    { from: "FAB-01", to: "ALM-01", transitTimeDays: 2 },
    { from: "ALM-01", to: "VEN-01", transitTimeDays: 3 },
    { from: "VEN-01", to: "CLI-01", transitTimeDays: 1 },
  ],
};

const FORKED: TemplateBlueprint = {
  nodes: [
    { nodeType: "Proveedor", label: "SUP-01", x: 40, y: 80, supplyCapacity: 2800 },
    { nodeType: "Proveedor", label: "SUP-02", x: 40, y: 300, supplyCapacity: 2200 },
    { nodeType: "Fabrica", label: "FAB-01", x: 300, y: 80, productionCapacity: 2200 },
    { nodeType: "Fabrica", label: "FAB-02", x: 300, y: 300, productionCapacity: 1800 },
    { nodeType: "Almacen", label: "ALM-01", x: 560, y: 80, storageCapacity: 4200, currentStockLevel: 3100 },
    { nodeType: "Almacen", label: "ALM-02", x: 560, y: 300, storageCapacity: 3600, currentStockLevel: 1500 },
    { nodeType: "Vendedor", label: "VEN-01", x: 820, y: 80 },
    { nodeType: "Vendedor", label: "VEN-02", x: 820, y: 300 },
    { nodeType: "Cliente", label: "CLI-01", x: 1080, y: 190 },
    { nodeType: "Cliente", label: "CLI-02", x: 1080, y: 400 },
  ],
  edges: [
    { from: "SUP-01", to: "FAB-01", transitTimeDays: 4 },
    { from: "SUP-02", to: "FAB-02", transitTimeDays: 6 },
    { from: "FAB-01", to: "ALM-01", transitTimeDays: 2 },
    { from: "FAB-02", to: "ALM-02", transitTimeDays: 3 },
    { from: "ALM-01", to: "VEN-01", transitTimeDays: 2 },
    { from: "ALM-02", to: "VEN-02", transitTimeDays: 2 },
    { from: "VEN-01", to: "CLI-01", transitTimeDays: 1 },
    { from: "VEN-02", to: "CLI-02", transitTimeDays: 1 },
  ],
};

function buildComplex(): TemplateBlueprint {
  const nodes: TemplateNodeBlueprint[] = [];
  const edges: TemplateEdgeBlueprint[] = [];
  const branches = 4;
  for (let b = 0; b < branches; b++) {
    const y = 60 + b * 180;
    const sup = `SUP-0${b + 1}`;
    const fab = `FAB-0${b + 1}`;
    const alm = `ALM-0${b + 1}`;
    const ven = `VEN-0${b + 1}`;
    nodes.push({ nodeType: "Proveedor", label: sup, x: 40, y, supplyCapacity: 1800 + b * 350 });
    nodes.push({ nodeType: "Fabrica", label: fab, x: 300, y, productionCapacity: 1500 + b * 300 });
    nodes.push({ nodeType: "Almacen", label: alm, x: 560, y, storageCapacity: 3000 + b * 400, currentStockLevel: 1800 + b * 250 });
    nodes.push({ nodeType: "Vendedor", label: ven, x: 820, y });
    edges.push({ from: sup, to: fab, transitTimeDays: 4 + b });
    edges.push({ from: fab, to: alm, transitTimeDays: 2 });
    edges.push({ from: alm, to: ven, transitTimeDays: 2 + (b % 2) });
  }
  nodes.push({ nodeType: "Cliente", label: "CLI-01", x: 1080, y: 130 });
  nodes.push({ nodeType: "Cliente", label: "CLI-02", x: 1080, y: 490 });
  edges.push({ from: "VEN-01", to: "CLI-01", transitTimeDays: 1 });
  edges.push({ from: "VEN-02", to: "CLI-01", transitTimeDays: 1 });
  edges.push({ from: "VEN-03", to: "CLI-02", transitTimeDays: 1 });
  edges.push({ from: "VEN-04", to: "CLI-02", transitTimeDays: 1 });
  return { nodes, edges };
}

const BLUEPRINTS: Record<ChainTemplateId, TemplateBlueprint> = {
  blank: { nodes: [], edges: [] },
  linear: LINEAR,
  forked: FORKED,
  complex: buildComplex(),
};

/** Instancia un template en nodos/aristas concretos para una cadena recién creada. */
export function instantiateTemplate(
  templateId: ChainTemplateId,
  chainId: string,
  idPrefix: string,
): { nodes: SupplyChainNode[]; edges: SupplyChainEdge[] } {
  const blueprint = BLUEPRINTS[templateId];
  const labelToId = new Map<string, string>();
  const nodes: SupplyChainNode[] = blueprint.nodes.map((n, i) => {
    const id = `${idPrefix}-node-${i}`;
    labelToId.set(n.label, id);
    return {
      id,
      chainId,
      nodeType: n.nodeType,
      label: n.label,
      supplyCapacity: n.supplyCapacity,
      productionCapacity: n.productionCapacity,
      storageCapacity: n.storageCapacity,
      currentStockLevel: n.currentStockLevel,
      canvasPosition: { x: n.x, y: n.y },
    };
  });
  const edges: SupplyChainEdge[] = blueprint.edges.map((e, i) => ({
    id: `${idPrefix}-edge-${i}`,
    sourceNodeId: labelToId.get(e.from)!,
    targetNodeId: labelToId.get(e.to)!,
    transitTimeDays: e.transitTimeDays,
  }));
  return { nodes, edges };
}
