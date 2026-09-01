import { Schema, model, models, Types, type Document } from "mongoose";
import { ORG_ROLES } from "@/lib/validators/organization";

export interface OrganizationMemberDocument {
  userId: Types.ObjectId;
  role: (typeof ORG_ROLES)[number];
}

export interface OrganizationDocument extends Document {
  name: string;
  members: OrganizationMemberDocument[];
  createdAt: Date;
}

const organizationMemberSchema = new Schema<OrganizationMemberDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ORG_ROLES, required: true },
  },
  { _id: false },
);

const organizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true },
    members: { type: [organizationMemberSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const OrganizationModel =
  models.Organization ?? model<OrganizationDocument>("Organization", organizationSchema);
