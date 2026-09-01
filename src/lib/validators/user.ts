import { z } from "zod";

export const userSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  image: z.url().optional(),
});
export type User = z.infer<typeof userSchema>;
