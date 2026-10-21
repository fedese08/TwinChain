// La simulación como job en segundo plano (E90, arquitectura: el motor corre como job dentro del monolito).
//
// El pedido que crea la corrida (`POST /api/escenarios`, `POST /api/escenarios/[id]/corridas`) valida, guarda el escenario
// y una fila de `resultados` en estado `corriendo`, y responde enseguida (202). El motor corre DESPUÉS de responder, con
// `after()` de Next.js (en Vercel sigue vivo dentro de `maxDuration`), y completa esa fila: la pantalla consulta hasta que
// está lista. Si el motor falla, la corrida se descarta; si era la primera del escenario, también el escenario: o queda
// todo (escenario, eventos y corrida) o nada, igual que cuando todo ocurría dentro del pedido.
import { and, count, eq } from "drizzle-orm";
import { escenarios, resultados, type Database } from "@/lib/db";
import { runScenarioOnChain, type RunInput } from "@/lib/simulation/run-scenario";

/** Corre el motor y completa la fila `corriendo`. No lanza: cualquier falla descarta la corrida. */
export async function executeRun(db: Database, runId: string, input: RunInput): Promise<void> {
  try {
    const run = await runScenarioOnChain(db, { ...input, resultId: runId });
    await db
      .update(resultados)
      .set({
        fechaCorrida: run.fechaCorrida,
        tablaK: run.tablaK,
        replicas: run.replicas,
        semilla: run.semilla,
        semanaReconfiguracion: run.semanaReconfiguracion,
        estado: "listo",
      })
      .where(and(eq(resultados.id, runId), eq(resultados.estado, "corriendo")));
  } catch (error) {
    console.error("[simulación] la corrida falló y se descarta", runId, error);
    await discardRun(db, runId, input.scenarioId);
  }
}

/** Borra una corrida que no terminó y, si el escenario se quedó sin ninguna, el escenario entero (cascade a sus eventos). */
export async function discardRun(db: Database, runId: string, scenarioId: string): Promise<void> {
  await db.delete(resultados).where(and(eq(resultados.id, runId), eq(resultados.estado, "corriendo")));
  const [{ total }] = await db.select({ total: count() }).from(resultados).where(eq(resultados.escenarioId, scenarioId));
  if (total === 0) await db.delete(escenarios).where(eq(escenarios.id, scenarioId));
}
