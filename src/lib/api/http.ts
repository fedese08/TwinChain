import { NextResponse } from "next/server";
import { z } from "zod";

export const notFound = (message = "No encontrado") => NextResponse.json({ error: message }, { status: 404 });

export function badRequest(error: z.ZodError) {
  return NextResponse.json(
    { error: error.issues[0]?.message ?? "Datos inválidos", fields: z.flattenError(error).fieldErrors },
    { status: 400 },
  );
}

/** Los ids que llegan por la URL se validan antes de tocar la base: un uuid mal formado es un 404, no un 500. */
export const isUuid = (value: string) => z.uuid().safeParse(value).success;

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: badRequest(parsed.error) };
}
