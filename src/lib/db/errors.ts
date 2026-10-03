/** Drizzle envuelve el error del driver en `cause`; se mira en ambos lados. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

/** 23505 = unique_violation */
export function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === "23505";
}
