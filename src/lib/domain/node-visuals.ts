import type { NodeType } from "@/lib/domain/types";

export const NODE_TYPE_COLOR: Record<NodeType, string> = {
  Proveedor: "#3b82f6",
  Fabrica: "#dfa63c",
  Almacen: "#0d9c84",
  Vendedor: "#8b5cf6",
  Cliente: "#616b7c",
};

export const NODE_TYPE_CODE: Record<NodeType, string> = {
  Proveedor: "supplier",
  Fabrica: "factory",
  Almacen: "warehouse",
  Vendedor: "seller",
  Cliente: "customer",
};

export const SEVERITY_COLOR = {
  severe: { border: "#f2703c", fill: "#fdece0", stroke: "#f2703c" },
  moderate: { border: "#e6b96b", fill: "#fdf6e9", stroke: "#dfa63c" },
  none: { border: "#d6dce6", fill: "#ffffff", stroke: "#c3cede" },
} as const;
