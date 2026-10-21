import { describe, expect, it } from "vitest";
import { createScenarioSchema } from "@/lib/validators/scenario-api";
import { repeatedNodeIds, scenarioFormSchema } from "@/lib/validators/scenario";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const formEvent = (nodeId: string) => ({ nodeId, eventType: "corte", startDate: "2026-10-05", magnitude: 30 });
const apiEvent = (n: number, nodeN: number) => ({ id: uuid(n), nodeId: uuid(nodeN), eventType: "corte", startDate: "2026-10-05", magnitude: 30 });
const base = { id: uuid(1), chainId: uuid(2), name: "Corte doble", projectionHorizonWeeks: 16 };

describe("eventos por nodo (Flujo B / RF026)", () => {
  it("el formulario acepta varios nodos con un evento cada uno", () => {
    expect(scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("a"), formEvent("b")] }).success).toBe(true);
  });

  it("el formulario rechaza dos eventos sobre el mismo nodo y marca el evento repetido", () => {
    const parsed = scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("a"), formEvent("a")] });
    expect(parsed.success).toBe(false);
    expect(repeatedNodeIds([formEvent("a"), formEvent("a"), formEvent("b")])).toEqual(["a"]);
  });

  it("un evento sin nodo elegido todavía no cuenta como repetido, pero no valida", () => {
    expect(repeatedNodeIds([formEvent(""), formEvent("")])).toEqual([]);
    expect(scenarioFormSchema.safeParse({ name: "x", projectionHorizonWeeks: 8, events: [formEvent("")] }).success).toBe(false);
  });

  it("la API acepta varios nodos y rechaza dos eventos sobre el mismo nodo", () => {
    expect(createScenarioSchema.safeParse({ ...base, events: [apiEvent(10, 20), apiEvent(11, 21)] }).success).toBe(true);
    expect(createScenarioSchema.safeParse({ ...base, events: [apiEvent(10, 20), apiEvent(11, 20)] }).success).toBe(false);
  });

  it("la API exige al menos un evento", () => {
    expect(createScenarioSchema.safeParse({ ...base, events: [] }).success).toBe(false);
  });
});
