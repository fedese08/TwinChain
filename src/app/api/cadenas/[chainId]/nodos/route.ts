import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleChain } from "@/lib/data/access";
import { toNode } from "@/lib/data/mappers";
import { getDb, nodos } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { MAX_NODES_PER_CHAIN } from "@/lib/domain/types";
import { createNodeSchema } from "@/lib/validators/chain-api";

export async function POST(request: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { chainId } = await params;
  if (!isUuid(chainId)) return notFound("Cadena no encontrada");

  const body = await readJson(request, createNodeSchema);
  if (!body.ok) return body.response;
  const { id, tipo, etiqueta, x, y } = body.data;

  const db = getDb();
  if (!(await findVisibleChain(db, access.user, chainId))) return notFound("Cadena no encontrada");

  const [{ total }] = await db.select({ total: count() }).from(nodos).where(eq(nodos.cadenaId, chainId));
  if (total >= MAX_NODES_PER_CHAIN) {
    return NextResponse.json({ error: `Una cadena admite hasta ${MAX_NODES_PER_CHAIN} nodos` }, { status: 409 });
  }

  try {
    const [row] = await db
      .insert(nodos)
      .values({ id, tipo, cadenaId: chainId, etiqueta, posX: x, posY: y })
      .returning();
    return NextResponse.json({ node: toNode(row) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "Ese nodo ya existe" }, { status: 409 });
    throw error;
  }
}
