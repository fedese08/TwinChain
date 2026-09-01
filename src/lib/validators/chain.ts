import { z } from "zod";
import { CHAIN_TEMPLATES } from "@/lib/mock/templates";

export const chainFormSchema = z.object({
  name: z.string().min(1, "Ponele un nombre a la cadena").max(120),
  visibility: z.enum(["shared", "private"]),
  template: z.enum(CHAIN_TEMPLATES),
});
export type ChainFormValues = z.infer<typeof chainFormSchema>;
