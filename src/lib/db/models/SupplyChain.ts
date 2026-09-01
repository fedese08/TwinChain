import { Schema, model, models, Types, type Document } from "mongoose";
import {
  NODE_TYPES,
  TRANSPORT_MODES,
  DISTRIBUTION_POLICIES,
  MAX_NODES_PER_CHAIN,
} from "@/lib/validators/supply-chain";

export interface SupplyChainNodeDocument {
  clientId: string;
  type: (typeof NODE_TYPES)[number];
  label: string;
  position: { x: number; y: number };
  capacity: number;
  propagation: {
    absorbWithBuffer: boolean;
    participatesInCascade: boolean;
    distributionPolicy: (typeof DISTRIBUTION_POLICIES)[number];
  };
}

export interface SupplyChainEdgeDocument {
  clientId: string;
  from: string;
  to: string;
  leadTimeDays: number;
  cost: number;
  capacity: number;
  transportMode: (typeof TRANSPORT_MODES)[number];
}

export interface SupplyChainDocument extends Document {
  organizationId: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  visibility: "private" | "shared";
  nodes: SupplyChainNodeDocument[];
  edges: SupplyChainEdgeDocument[];
  createdAt: Date;
  updatedAt: Date;
}

const positionSchema = new Schema({ x: Number, y: Number }, { _id: false });

const propagationSchema = new Schema(
  {
    absorbWithBuffer: { type: Boolean, default: false },
    participatesInCascade: { type: Boolean, default: true },
    distributionPolicy: { type: String, enum: DISTRIBUTION_POLICIES, default: "proportional" },
  },
  { _id: false },
);

const supplyChainNodeSchema = new Schema<SupplyChainNodeDocument>(
  {
    clientId: { type: String, required: true },
    type: { type: String, enum: NODE_TYPES, required: true },
    label: { type: String, required: true },
    position: { type: positionSchema, required: true },
    capacity: { type: Number, required: true, min: 0 },
    propagation: { type: propagationSchema, required: true },
  },
  { _id: false },
);

const supplyChainEdgeSchema = new Schema<SupplyChainEdgeDocument>(
  {
    clientId: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    leadTimeDays: { type: Number, required: true, min: 0 },
    cost: { type: Number, required: true, min: 0 },
    capacity: { type: Number, required: true, min: 0 },
    transportMode: { type: String, enum: TRANSPORT_MODES, required: true },
  },
  { _id: false },
);

const supplyChainSchema = new Schema<SupplyChainDocument>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    visibility: { type: String, enum: ["private", "shared"], default: "shared" },
    nodes: {
      type: [supplyChainNodeSchema],
      default: [],
      validate: {
        validator: (nodes: unknown[]) => nodes.length <= MAX_NODES_PER_CHAIN,
        message: `Una cadena admite un máximo de ${MAX_NODES_PER_CHAIN} nodos`,
      },
    },
    edges: { type: [supplyChainEdgeSchema], default: [] },
  },
  { timestamps: true },
);

export const SupplyChainModel =
  models.SupplyChain ?? model<SupplyChainDocument>("SupplyChain", supplyChainSchema);
