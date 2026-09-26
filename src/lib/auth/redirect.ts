/** Solo rutas internas: evita que `?next=` sirva de redirección abierta a otro sitio. */
export function safeNext(next: string | null | undefined, fallback = "/cadenas"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
