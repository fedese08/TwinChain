import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireApiMember } from "@/lib/auth/session";
import { readJson } from "@/lib/api/http";
import { toChain, toEdge, toNode } from "@/lib/data/mappers";
import { aristas, cadenas, getDb, nodos } from "@/lib/db";
import { assertChainCapacity, lockOrganization, PlanLimitError, planLimitResponse } from "@/lib/data/plan-limits";
import { instantiateTemplate, templateNodeCount } from "@/lib/domain/templates";
import { ingestChainHistory } from "@/lib/ingestion/ingest-history";
import { lastCompleteWeek } from "@/lib/domain/synthetic";
import { prepareSensorBaselines, prepareVendedorPlans } from "@/lib/ingestion/vendedor-setup";
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

  // Plan de la organización: los nodos de la plantilla tienen que entrar en el tope de
  // nodos. Se mira ANTES de llamar al modelo de ML (trabajo caro) y se vuelve a mirar dentro de la transacción.
  try {
    await assertChainCapacity(getDb(), user, templateNodeCount(template));
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error);
    throw error;
  }

  const chainId = randomUUID();
  // La plantilla nace con ids de mentira ("tpl-node-0"); se reemplazan por uuids reales antes de insertar.
  const blueprint = instantiateTemplate(template, chainId, "tpl");
  const nodeIds = new Map(blueprint.nodes.map((n) => [n.id, randomUUID()]));

  // Se prepara ANTES de abrir la transacción: llamar al servicio de ML dentro de ella la dejaría abierta mientras
  // espera la red. (Los planes de Vendedor real de Olist están inactivos, ver `lib/domain/vendedor/config.ts`.)
  const vendedorNodeIds = blueprint.nodes.filter((n) => n.nodeType === "Vendedor").map((n) => nodeIds.get(n.id)!);
  const vendedorPlans = await prepareVendedorPlans(vendedorNodeIds);

  // La línea base de cada nodo la estima el modelo de ML a partir de las primeras semanas que reporta su sensor
  // (simulado). `endWeek` se fija acá una vez: la misma semana arma el historial dentro de la transacción.
  const endWeek = lastCompleteWeek();
  const baselines = await prepareSensorBaselines(
    blueprint.nodes.filter((n) => !vendedorPlans.has(nodeIds.get(n.id)!)).map((n) => ({ id: nodeIds.get(n.id)!, tipo: n.nodeType })),
    endWeek,
  );

  let created: Awaited<ReturnType<typeof createChain>>;
  try {
    created = await createChain();
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error);
    throw error;
  }

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

  function createChain() {
    return getDb().transaction(async (tx) => {
    await lockOrganization(tx, user.organizacionId);
    await assertChainCapacity(tx, user, templateNodeCount(template));
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

    const ingested = await ingestChainHistory(tx, chainId, { withLevelShift, vendedorPlans, baselines, endWeek });
    // Releídos después de la ingesta: los nodos Vendedor ahora llevan su vendedor real y la fuente de su línea base.
    const finalNodeRows = nodeRows.length === 0 ? [] : await tx.select().from(nodos).where(eq(nodos.cadenaId, chainId));

    return { chain, nodeRows: finalNodeRows, edgeRows, ingested };
    });
  }
}
