import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { isUuid, notFound } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { findVisibleScenario } from "@/lib/data/access";
import { toResult } from "@/lib/data/mappers";
import { getDb, resultados } from "@/lib/db";
import { discardRun } from "@/lib/simulation/background-run";
import { isStale } from "@/lib/simulation/run-state";

/**
 * Estado de una corrida lanzada en segundo plano: `corriendo`, `listo` (con el resultado) o `fallido`. Una corrida que ya
 * no existe es una que falló y se descartó; una `corriendo` que lleva más de lo que dura una función se da por perdida.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ scenarioId: string; runId: string }> }) {
  const access = await requireApiMember("scenario:read");
  if (!access.ok) return access.response;
  const { scenarioId, runId } = await params;
  if (!isUuid(scenarioId) || !isUuid(runId)) return notFound("Corrida no encontrada");

  const db = getDb();
  if (!(await findVisibleScenario(db, access.user, scenarioId))) return notFound("Escenario no encontrado");

  const [run] = await db
    .select()
    .from(resultados)
    .where(and(eq(resultados.id, runId), eq(resultados.escenarioId, scenarioId)))
    .limit(1);
  if (!run) return NextResponse.json({ estado: "fallido" });

  if (run.estado === "listo") return NextResponse.json({ estado: "listo", result: toResult(run) });
  if (isStale(run.creadoEn)) {
    await discardRun(db, runId, scenarioId);
    return NextResponse.json({ estado: "fallido" });
  }
  return NextResponse.json({ estado: "corriendo" });
}
