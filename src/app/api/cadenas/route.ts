import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiMember } from "@/lib/auth/session";
import { readJson } from "@/lib/api/http";
import { toChain, toEdge, toNode } from "@/lib/data/mappers";
import { aristas, cadenas, getDb, nodos } from "@/lib/db";
import { instantiateTemplate } from "@/lib/domain/templates";
import { ingestChainHistory } from "@/lib/ingestion/ingest-history";
import { chainFormSchema } from "@/lib/validators/chain";

/**
 * Crea una cadena (en blanco o desde plantilla) con sus nodos y aristas, y le carga el historial de
 * desempeño de cada nodo (pipeline de ingesta), todo en una transacción: o queda la cadena completa
 * y con datos, o no queda nada.
 */
export async function POST(request: Request) {
  const access = await requireApiMember("chain:write");
  if (!access.ok) return access.response;
  const { user } = access;

  const body = await readJson(request, chainFormSchema);
  if (!body.ok) return body.response;
  const { name, visibility, template, withLevelShift } = body.data;

  const chainId = randomUUID();
  // La plantilla nace con ids de mentira ("tpl-node-0"); se reemplazan por uuids reales antes de insertar.
  const blueprint = instantiateTemplate(template, chainId, "tpl");
  const nodeIds = new Map(blueprint.nodes.map((n) => [n.id, randomUUID()]));

  const created = await getDb().transaction(async (tx) => {
    const [chain] = await tx
      .insert(cadenas)
      .values({ id: chainId, nombre: name, organizacionId: user.organizacionId, visibilidad: visibility, creadaPor: user.id })
      .returning();

    const nodeRows =
      blueprint.nodes.length === 0
        ? []
        : await tx
            .insert(nodos)
            .values(
              blueprint.nodes.map((n) => ({
                id: nodeIds.get(n.id)!,
                tipo: n.nodeType,
                cadenaId: chainId,
                etiqueta: n.label,
                posX: n.canvasPosition.x,
                posY: n.canvasPosition.y,
                capacidadSuministro: n.supplyCapacity ?? null,
                capacidadProduccion: n.productionCapacity ?? null,
                capacidadAlmacenamiento: n.storageCapacity ?? null,
                nivelStockActual: n.currentStockLevel ?? null,
              })),
            )
            .returning();

    const edgeRows =
      blueprint.edges.length === 0
        ? []
        : await tx
            .insert(aristas)
            .values(
              blueprint.edges.map((e) => ({
                nodoOrigenId: nodeIds.get(e.sourceNodeId)!,
                nodoDestinoId: nodeIds.get(e.targetNodeId)!,
                tiempoTransito: e.transitTimeDays,
              })),
            )
            .returning();

    const ingested = await ingestChainHistory(tx, chainId, { withLevelShift });

    return { chain, nodeRows, edgeRows, ingested };
  });

  return NextResponse.json(
    {
      chain: toChain(created.chain),
      nodes: created.nodeRows.map(toNode),
      edges: created.edgeRows.map(toEdge),
      weeklyPerformance: created.ingested.weeklyPerformance,
      stability: created.ingested.stability,
    },
    { status: 201 },
  );
}
