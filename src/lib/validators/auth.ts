import { z } from "zod";
import { CONSENT_REQUIRED_MESSAGE } from "@/lib/legal/consent";

// bcrypt trunca en 72 bytes sin avisar: mejor rechazar antes que aceptar una contraseña "larga" que no lo es.
const passwordField = z.string().min(8, "Mínimo 8 caracteres").max(72, "Máximo 72 caracteres");

const emailField = z.string().trim().toLowerCase().pipe(z.email("Ingresá un email válido"));

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Ingresá tu contraseña").max(72),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const REGISTER_TYPES = ["organizacion", "empleado"] as const;
export type RegisterType = (typeof REGISTER_TYPES)[number];

/**
 * Registro como organización (crea la organización y queda como Administrador) o como empleado
 * (queda sin organización hasta aceptar una invitación).
 */
export const registerSchema = z
  .object({
    tipo: z.enum(REGISTER_TYPES),
    nombre: z.string().trim().min(2, "Ingresá tu nombre").max(120),
    email: emailField,
    password: passwordField,
    nombreOrganizacion: z.string().trim().max(120).optional(),
    // Consentimiento informado (Ley 25.326): se valida también acá, en el servidor, no solo en la pantalla.
    aceptaTratamiento: z.literal(true, { error: CONSENT_REQUIRED_MESSAGE }),
  })
  .refine((d) => d.tipo !== "organizacion" || (d.nombreOrganizacion?.length ?? 0) >= 2, {
    path: ["nombreOrganizacion"],
    message: "Ponele un nombre a la organización",
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const INVITE_ROLES = ["operator", "admin"] as const;
export const inviteSchema = z.object({
  email: emailField,
  rol: z.enum(INVITE_ROLES),
});
export type InviteValues = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
});
