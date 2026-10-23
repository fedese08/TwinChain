import { describe, expect, it } from "vitest";
import { createScenarioSchema } from "@/lib/validators/scenario-api";
import { scenarioFormSchema } from "@/lib/validators/scenario";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const formEvent = (nodeId: string) => ({ nodeId, eventType: "corte", startDate: "2026-10-05", magnitude: 30 });
const apiEvent = (n: number, nodeN: number) => ({ id: uuid(n), nodeId: uuid(nodeN), eventType: "corte", startDate: "2026-10-05", magnitude: 30 });
const base = { id: uuid(1), chainId: uuid(2), name: "Corte", projectionHorizonWeeks: 16 };

describe("un evento por simulación", () => {
  it("el formulario acepta un escenario con un solo evento", () => {
    expect(scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("a")] }).success).toBe(true);
  });

  it("el formulario rechaza más de un evento, aunque sean de nodos distintos", () => {
    expect(scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("a"), formEvent("b")] }).success).toBe(false);
  });

  it("el formulario exige elegir el nodo del evento", () => {
    expect(scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("")] }).success).toBe(false);
  });

  it("la API acepta un evento y rechaza dos (de un mismo nodo o de nodos distintos) o ninguno", () => {
    expect(createScenarioSchema.safeParse({ ...base, events: [apiEvent(10, 20)] }).success).toBe(true);
    expect(createScenarioSchema.safeParse({ ...base, events: [apiEvent(10, 20), apiEvent(11, 21)] }).success).toBe(false);
    expect(createScenarioSchema.safeParse({ ...base, events: [apiEvent(10, 20), apiEvent(11, 20)] }).success).toBe(false);
    expect(createScenarioSchema.safeParse({ ...base, events: [] }).success).toBe(false);
  });
});
