import { z } from "zod";

export const updateProfileSchema = z.object({
  nombre: z.string().trim().min(2, "Ingresá tu nombre").max(120, "Máximo 120 caracteres"),
});
export type UpdateProfileValues = z.infer<typeof updateProfileSchema>;

// bcrypt trunca en 72 bytes sin avisar: mismo tope que el registro.
export const changePasswordSchema = z
  .object({
    actual: z.string().min(1, "Ingresá tu contraseña actual").max(72),
    nueva: z.string().min(8, "Mínimo 8 caracteres").max(72, "Máximo 72 caracteres"),
    confirmacion: z.string().max(72),
  })
  .refine((d) => d.nueva === d.confirmacion, { path: ["confirmacion"], message: "Las contraseñas no coinciden" })
  .refine((d) => d.nueva !== d.actual, { path: ["nueva"], message: "La nueva contraseña tiene que ser distinta de la actual" });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
