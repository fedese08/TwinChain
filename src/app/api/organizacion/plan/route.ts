// Cambio de plan de la organización. Solo lo hace un administrador (`organization:manage`).
//
// No hay cobro: TwinChain es un prototipo y el cambio de plan es inmediato. Lo que SÍ se valida es que la
// organización no quede por encima de los topes del plan nuevo (un downgrade con más nodos o escenarios guardados
// que los que admite se rechaza: no hay purga automática ni archivado, el cliente decide qué borrar).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { lockOrganization, organizationUsage } from "@/lib/data/plan-limits";
import { getDb, organizaciones } from "@/lib/db";
import { PLAN_DEFINITIONS, PLAN_IDS, planOverages } from "@/lib/plans";

const changePlanSchema = z.object({ plan: z.enum(PLAN_IDS) });

export async function PUT(request: Request) {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;
  const { user } = access;

  const body = await readJson(request, changePlanSchema);
  if (!body.ok) return body.response;
  const { plan } = body.data;

  const result = await getDb().transaction(async (tx) => {
    await lockOrganization(tx, user.organizacionId);
    const usage = await organizationUsage(tx, user.organizacionId);
    const overages = planOverages(plan, usage);
    if (overages.length > 0) return { ok: false as const, overages };
    const [row] = await tx
      .update(organizaciones)
      .set({ plan, planDesde: new Date() })
      .where(eq(organizaciones.id, user.organizacionId))
      .returning({ plan: organizaciones.plan, planDesde: organizaciones.planDesde });
    return { ok: true as const, row };
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: `Para pasar a ${PLAN_DEFINITIONS[plan].name} primero tenés que quedar dentro de sus topes: tenés ${result.overages.join(" y ")}. Borrá lo que sobra y probá de nuevo.`,
        code: "plan_overage",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ plan: result.row.plan, planDesde: result.row.planDesde.toISOString() });
}
