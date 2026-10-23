// Planes de suscripción (modelo de negocio: Freemium, Pro y Max). Es la ÚNICA fuente de los topes: la landing, el
// servidor y las pantallas leen de acá.
//
// Los planes se diferencian por dos topes por ORGANIZACIÓN (el cliente que paga):
//   - nodos: cantidad de nodos (cualquier eslabón) que puede tener su red;
//   - escenarios guardados a la vez: NO las ejecuciones sobre ellos, que son ilimitadas y sin límite de retención.
// Con el tope de escenarios completo, crear uno nuevo queda bloqueado hasta borrar otro o cambiar de plan: no hay
// purga automática ni archivado. No hay tope de cadenas: los nodos y los escenarios se cuentan sobre toda la organización.

export const PLAN_IDS = ["freemium", "pro", "max"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Precio mensual en dólares, neto de IVA. */
  priceUsd: number;
  maxNodes: number;
  maxScenarios: number;
}

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  freemium: { id: "freemium", name: "Freemium", priceUsd: 0, maxNodes: 6, maxScenarios: 3 },
  pro: { id: "pro", name: "Pro", priceUsd: 29, maxNodes: 15, maxScenarios: 6 },
  max: { id: "max", name: "Max", priceUsd: 99, maxNodes: 100, maxScenarios: 30 },
};

/** Plan con el que nace toda organización nueva. Es permanente, no una prueba por tiempo limitado. */
export const DEFAULT_PLAN: PlanId = "freemium";

export const isPlanId = (value: unknown): value is PlanId => typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);

/** Qué tope se alcanzó. */
export type PlanLimitKind = "nodes" | "scenarios";

export interface Usage {
  chains: number;
  nodes: number;
  scenarios: number;
}

export function planLimitMessage(plan: PlanId, kind: PlanLimitKind, usage: Usage, adding = 1): string {
  const def = PLAN_DEFINITIONS[plan];
  const upgrade = plan === "max" ? "" : " Pasá a un plan mayor para tener más.";
  switch (kind) {
    case "nodes":
      return adding > 1
        ? `Esta plantilla suma ${adding} nodos y tu plan ${def.name} admite hasta ${def.maxNodes} (ya usás ${usage.nodes}).${upgrade}`
        : `Tu plan ${def.name} admite hasta ${def.maxNodes} nodos y ya usás ${usage.nodes}.${upgrade}`;
    case "scenarios":
      return `Tu plan ${def.name} admite hasta ${def.maxScenarios} escenarios guardados. Borrá uno o cambiá de plan para crear otro.`;
  }
}

/** ¿Entra `adding` más sin pasarse del tope del plan? */
export function fitsPlan(plan: PlanId, kind: PlanLimitKind, usage: Usage, adding = 1): boolean {
  const def = PLAN_DEFINITIONS[plan];
  return kind === "nodes" ? usage.nodes + adding <= def.maxNodes : usage.scenarios + adding <= def.maxScenarios;
}

/** Topes de un plan que `usage` ya supera (para impedir un downgrade que deje a la organización fuera de plan). */
export function planOverages(plan: PlanId, usage: Usage): string[] {
  const def = PLAN_DEFINITIONS[plan];
  const out: string[] = [];
  if (usage.nodes > def.maxNodes) out.push(`${usage.nodes} nodos (máximo ${def.maxNodes})`);
  if (usage.scenarios > def.maxScenarios) out.push(`${usage.scenarios} escenarios guardados (máximo ${def.maxScenarios})`);
  return out;
}
