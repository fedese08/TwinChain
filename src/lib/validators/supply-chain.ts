import { z } from "zod";

// 4 tipos de nodo — el tránsito NO es un nodo, es propiedad de la arista (ver CLAUDE.md).
export const NODE_TYPES = ["supplier", "factory", "warehouse", "customer"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const TRANSPORT_MODES = ["truck", "ship", "air"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DISTRIBUTION_POLICIES = ["proportional", "priority"] as const;
export type DistributionPolicy = (typeof DISTRIBUTION_POLICIES)[number];

export const MAX_NODES_PER_CHAIN = 50;

export const supplyChainNodeSchema = z.object({
  clientId: z.string().min(1),
  type: z.enum(NODE_TYPES),
  label: z.string().min(1).max(80),
  position: z.object({ x: z.number(), y: z.number() }),
  capacity: z.number().min(0),
  propagation: z.object({
    absorbWithBuffer: z.boolean().default(false),
    participatesInCascade: z.boolean().default(true),
    distributionPolicy: z.enum(DISTRIBUTION_POLICIES).default("proportional"),
  }),
});
export type SupplyChainNode = z.infer<typeof supplyChainNodeSchema>;

export const supplyChainEdgeSchema = z.object({
  clientId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  leadTimeDays: z.number().min(0),
  cost: z.number().min(0),
  capacity: z.number().min(0),
  transportMode: z.enum(TRANSPORT_MODES),
});
export type SupplyChainEdge = z.infer<typeof supplyChainEdgeSchema>;

export const supplyChainSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(120),
  visibility: z.enum(["private", "shared"]).default("shared"),
  nodes: z.array(supplyChainNodeSchema).max(MAX_NODES_PER_CHAIN),
  edges: z.array(supplyChainEdgeSchema),
});
export type SupplyChain = z.infer<typeof supplyChainSchema>;

// 3 plantillas predefinidas (CLAUDE.md): lineal 5 nodos, bifurcada 10, compleja 20+.
export const CHAIN_TEMPLATES = ["linear", "forked", "complex"] as const;
export type ChainTemplate = (typeof CHAIN_TEMPLATES)[number];
