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

// Para eliminar la cuenta se vuelve a pedir la contraseña (la sesión sola no alcanza para algo irreversible).
// Las cuentas sin contraseña propia (inicio con Google, cuando se sume) no la mandan.
export const deleteAccountSchema = z.object({
  contrasena: z.string().max(72).optional(),
});
export type DeleteAccountValues = z.infer<typeof deleteAccountSchema>;

