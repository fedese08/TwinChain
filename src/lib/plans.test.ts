import { describe, expect, it } from "vitest";
import { templateNodeCount } from "@/lib/domain/templates";
import { fitsPlan, MAX_CHAINS_PER_ORGANIZATION, PLAN_DEFINITIONS, planLimitMessage, planOverages } from "./plans";

const usage = (nodes: number, scenarios: number, chains = 1) => ({ nodes, scenarios, chains });

describe("planes de suscripción", () => {
  it("tiene los topes del modelo de negocio", () => {
    expect(PLAN_DEFINITIONS.freemium).toMatchObject({ priceUsd: 0, maxNodes: 6, maxScenarios: 3 });
    expect(PLAN_DEFINITIONS.pro).toMatchObject({ priceUsd: 29, maxNodes: 15, maxScenarios: 6 });
    expect(PLAN_DEFINITIONS.max).toMatchObject({ priceUsd: 99, maxNodes: 100, maxScenarios: 30 });
    expect(MAX_CHAINS_PER_ORGANIZATION).toBe(1);
  });

  it("el tope es inclusivo: se puede llegar al máximo pero no pasarlo", () => {
    expect(fitsPlan("freemium", "nodes", usage(5, 0))).toBe(true);
    expect(fitsPlan("freemium", "nodes", usage(6, 0))).toBe(false);
    expect(fitsPlan("freemium", "scenarios", usage(0, 2))).toBe(true);
    expect(fitsPlan("freemium", "scenarios", usage(0, 3))).toBe(false);
    expect(fitsPlan("max", "scenarios", usage(0, 29))).toBe(true);
    expect(fitsPlan("max", "scenarios", usage(0, 30))).toBe(false);
  });

  it("las plantillas entran o no según el plan", () => {
    const fits = (plan: "freemium" | "pro" | "max", t: Parameters<typeof templateNodeCount>[0]) =>
      fitsPlan(plan, "nodes", usage(0, 0, 0), templateNodeCount(t));
    expect(templateNodeCount("linear")).toBe(5);
    expect(templateNodeCount("forked")).toBe(10);
    expect(templateNodeCount("complex")).toBeGreaterThan(15);
    expect(fits("freemium", "linear")).toBe(true);
    expect(fits("freemium", "forked")).toBe(false);
    expect(fits("pro", "forked")).toBe(true);
    expect(fits("pro", "complex")).toBe(false);
    expect(fits("max", "complex")).toBe(true);
  });

  it("un downgrade que deja la organización por encima de los topes se detecta", () => {
    expect(planOverages("freemium", usage(14, 3))).toEqual(["14 nodos (máximo 6)"]);
    expect(planOverages("freemium", usage(5, 4))).toEqual(["4 escenarios guardados (máximo 3)"]);
    expect(planOverages("pro", usage(15, 6))).toEqual([]);
    expect(planOverages("max", usage(50, 20))).toEqual([]);
  });

  it("los mensajes nombran el plan y el tope", () => {
    expect(planLimitMessage("freemium", "scenarios", usage(0, 3))).toContain("Freemium");
    expect(planLimitMessage("freemium", "scenarios", usage(0, 3))).toContain("3 escenarios");
    expect(planLimitMessage("pro", "nodes", usage(15, 0))).toContain("hasta 15 nodos");
    expect(planLimitMessage("max", "nodes", usage(100, 0))).not.toContain("plan mayor");
    expect(planLimitMessage("freemium", "nodes", usage(0, 0, 0), 10)).toContain("suma 10 nodos");
  });
});
