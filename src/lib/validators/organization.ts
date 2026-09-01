import { z } from "zod";

// Todos los miembros de una organización tienen el mismo permiso;
// solo el líder puede invitar (ver CLAUDE.md).
export const ORG_ROLES = ["leader", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const organizationMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ORG_ROLES),
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const organizationSchema = z.object({
  name: z.string().min(1).max(120),
  members: z.array(organizationMemberSchema).min(1),
});
export type Organization = z.infer<typeof organizationSchema>;
