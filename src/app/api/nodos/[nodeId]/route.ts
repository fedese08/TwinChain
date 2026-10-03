import { NextResponse } from "next/server";
import { count, eq, or } from "drizzle-orm";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleNode } from "@/lib/data/access";
import { toNode } from "@/lib/data/mappers";
import { aristas, eventos, getDb, nodos } from "@/lib/db";
import { patchNodeSchema, type PatchNodeInput } from "@/lib/validators/chain-api";

/** Qué atributo propio corresponde a qué tipo de nodo (herencia de tabla única: se valida acá, no en la base). */
const FIELD_OWNER = {
  supplyCapacity: "Proveedor",
  productionCapacity: "Fabrica",
  storageCapacity: "Almacen",
  currentStockLevel: "Almacen",
} as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { nodeId } = await params;
  if (!isUuid(nodeId)) return notFound("Nodo no encontrado");

  const body = await readJson(request, patchNodeSchema);
  if (!body.ok) return body.response;
  const patch: PatchNodeInput = body.data;

  const db = getDb();
  const found = await findVisibleNode(db, access.user, nodeId);
  if (!found) return notFound("Nodo no encontrado");

  for (const [field, owner] of Object.entries(FIELD_OWNER)) {
    if (field in patch && found.nodo.tipo !== owner) {
      return NextResponse.json({ error: `${field} no aplica a un nodo ${found.nodo.tipo}` }, { status: 400 });
    }
  }

  const [row] = await db
    .update(nodos)
    .set({
      ...(patch.label !== undefined && { etiqueta: patch.label }),
      ...(patch.position !== undefined && { posX: patch.position.x, posY: patch.position.y }),
      ...(patch.supplyCapacity !== undefined && { capacidadSuministro: patch.supplyCapacity }),
      ...(patch.productionCapacity !== undefined && { capacidadProduccion: patch.productionCapacity }),
      ...(patch.storageCapacity !== undefined && { capacidadAlmacenamiento: patch.storageCapacity }),
      ...(patch.currentStockLevel !== undefined && { nivelStockActual: patch.currentStockLevel }),
    })
    .where(eq(nodos.id, nodeId))
    .returning();

  return NextResponse.json({ node: toNode(row) });
}

/**
 * Sin `?cascade=true`, un nodo conectado no se elimina (un nodo debe desconectarse antes). Con
 * cascade se lleva sus aristas. En ambos casos se rechaza si alguna simulación usa el nodo.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { nodeId } = await params;
  if (!isUuid(nodeId)) return notFound("Nodo no encontrado");

  const db = getDb();
  if (!(await findVisibleNode(db, access.user, nodeId))) return notFound("Nodo no encontrado");

  const cascade = new URL(request.url).searchParams.get("cascade") === "true";

  const [{ edgeCount }] = await db
    .select({ edgeCount: count() })
    .from(aristas)
    .where(or(eq(aristas.nodoOrigenId, nodeId), eq(aristas.nodoDestinoId, nodeId)));
  if (edgeCount > 0 && !cascade) {
    return NextResponse.json(
      { error: "Desconectá el nodo de todas sus aristas antes de eliminarlo.", code: "HAS_EDGES" },
      { status: 409 },
    );
  }

  const [{ eventCount }] = await db.select({ eventCount: count() }).from(eventos).where(eq(eventos.nodoId, nodeId));
  if (eventCount > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: hay simulaciones que usan este nodo.", code: "HAS_EVENTS" },
      { status: 409 },
    );
  }

  // Las aristas y el desempeño semanal del nodo caen por ON DELETE CASCADE.
  await db.delete(nodos).where(eq(nodos.id, nodeId));
  return NextResponse.json({ ok: true });
}
