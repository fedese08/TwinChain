import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleEdge } from "@/lib/data/access";
import { toEdge } from "@/lib/data/mappers";
import { aristas, getDb } from "@/lib/db";
import { patchEdgeSchema } from "@/lib/validators/chain-api";

type Context = { params: Promise<{ edgeId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { edgeId } = await params;
  if (!isUuid(edgeId)) return notFound("Arista no encontrada");

  const body = await readJson(request, patchEdgeSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  if (!(await findVisibleEdge(db, access.user, edgeId))) return notFound("Arista no encontrada");

  const [row] = await db
    .update(aristas)
    .set({ tiempoTransito: body.data.transitTimeDays })
    .where(eq(aristas.id, edgeId))
    .returning();
  return NextResponse.json({ edge: toEdge(row) });
}

export async function DELETE(_request: Request, { params }: Context) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { edgeId } = await params;
  if (!isUuid(edgeId)) return notFound("Arista no encontrada");

  const db = getDb();
  if (!(await findVisibleEdge(db, access.user, edgeId))) return notFound("Arista no encontrada");

  await db.delete(aristas).where(eq(aristas.id, edgeId));
  return NextResponse.json({ ok: true });
}
