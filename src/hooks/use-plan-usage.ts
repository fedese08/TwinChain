"use client";

import { MAX_CHAINS_PER_ORGANIZATION, PLAN_DEFINITIONS } from "@/lib/plans";
import { useAppStore } from "@/stores/app-store";

/**
 * Plan de la organización y cuánto de sus topes se usa, a partir de lo que el usuario ve en el store. Sirve para
 * ANTICIPAR el bloqueo en la interfaz (botones deshabilitados, contadores); quien lo hace cumplir es el servidor.
 * Puede subestimar el uso real si la organización tiene cadenas privadas de otras personas, que el store no ve.
 */
export function usePlanUsage() {
  const plan = useAppStore((s) => s.plan);
  const nodes = useAppStore((s) => s.nodes.length);
  const scenarios = useAppStore((s) => s.scenarios.length);
  const chains = useAppStore((s) => s.chains.length);
  const definition = PLAN_DEFINITIONS[plan];

  return {
    plan,
    definition,
    usage: { nodes, scenarios, chains },
    nodesLeft: Math.max(0, definition.maxNodes - nodes),
    nodesAtLimit: nodes >= definition.maxNodes,
    scenariosAtLimit: scenarios >= definition.maxScenarios,
    chainsAtLimit: chains >= MAX_CHAINS_PER_ORGANIZATION,
  };
}
