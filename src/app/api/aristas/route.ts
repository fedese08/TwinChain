import { NextResponse } from "next/server";
import { notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleNode } from "@/lib/data/access";
import { toEdge } from "@/lib/data/mappers";
import { aristas, getDb } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { createEdgeSchema } from "@/lib/validators/chain-api";

export async function POST(request: Request) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;

  const body = await readJson(request, createEdgeSchema);
  if (!body.ok) return body.response;
  const { id, sourceNodeId, targetNodeId, transitTimeDays } = body.data;

  if (sourceNodeId === targetNodeId) {
    return NextResponse.json({ error: "Un nodo no se puede conectar consigo mismo" }, { status: 400 });
  }

  const db = getDb();
  const [source, target] = await Promise.all([
    findVisibleNode(db, access.user, sourceNodeId),
    findVisibleNode(db, access.user, targetNodeId),
  ]);
  if (!source || !target) return notFound("Nodo no encontrado");
  if (source.cadena.id !== target.cadena.id) {
    return NextResponse.json({ error: "Los dos nodos tienen que ser de la misma cadena" }, { status: 400 });
  }

  try {
    const [row] = await db
      .insert(aristas)
      .values({ id, nodoOrigenId: sourceNodeId, nodoDestinoId: targetNodeId, tiempoTransito: transitTimeDays })
      .returning();
    return NextResponse.json({ edge: toEdge(row) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Esos nodos ya están conectados" }, { status: 409 });
    throw error;
  }
}
