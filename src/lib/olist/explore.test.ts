import { describe, expect, it } from "vitest";
import type { SeriesEvaluation } from "@/lib/ml-client";
import { buildSellerExploration } from "./explore";
import { getSeller, listSellers, OLIST_META, PHASE1_WEEKS } from "./sample";

const seller = {
  id: "abcdef0123456789",
  semanas: [3, 3, 3, 3, 1, 5, 2].map((margen, i) => ({ inicio: `2018-0${i + 1}-01`, margen, items: 2 })),
};
const evaluation: SeriesEvaluation = {
  prediccion: { linea_base: 3, banda_inferior: 2, banda_superior: 4, banda_semanal_inferior: 1.5, banda_semanal_superior: 4.5 },
  evaluaciones: [
    { indice: 0, margin_mean: 1, estado: "por_debajo" },
    { indice: 1, margin_mean: 5, estado: "por_encima" },
    { indice: 2, margin_mean: 2, estado: "normal" },
  ],
  resumen: { semanas: 3, por_debajo: 1, normal: 1, por_encima: 1, fraccion_por_debajo: 1 / 3 },
};

describe("armado de la exploración de un vendedor", () => {
  it("separa Fase I y Fase II y solo evalúa la segunda", () => {
    const result = buildSellerExploration(seller, evaluation);
    expect(result.weeks.map((w) => w.fase)).toEqual([1, 1, 1, 1, 2, 2, 2]);
    expect(result.weeks.slice(0, PHASE1_WEEKS).every((w) => w.estado === null)).toBe(true);
    expect(result.weeks.slice(PHASE1_WEEKS).map((w) => w.estado)).toEqual(["por_debajo", "por_encima", "normal"]);
    expect(result.shortId).toBe("abcdef01");
  });

  it("compara el modelo contra el método ingenuo con los mismos datos", () => {
    const result = buildSellerExploration(seller, evaluation);
    expect(result.phase1Mean).toBe(3);
    expect(result.phase2Mean).toBeCloseTo((1 + 5 + 2) / 3);
    expect(result.baselineErrorDays).toBeCloseTo(Math.abs(3 - 8 / 3));
    expect(result.naiveErrorDays).toBeCloseTo(Math.abs(3 - 8 / 3));
    expect(result.phase2MeanInBand).toBe(true);
  });

  it("falla si la evaluación no corresponde a las semanas del vendedor", () => {
    expect(() => buildSellerExploration(seller, { ...evaluation, evaluaciones: evaluation.evaluaciones.slice(1) })).toThrow();
  });
});

describe("muestra de vendedores reales", () => {
  it("todos tienen al menos 4 de Fase I y 8 de Fase II, y se encuentran por id", () => {
    const list = listSellers();
    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const item of list) {
      expect(item.weeks).toBeGreaterThanOrEqual(PHASE1_WEEKS + 8);
      expect(getSeller(item.id)?.semanas).toHaveLength(item.weeks);
    }
  });

  it("declara su origen, la licencia y que son vendedores no vistos por el modelo", () => {
    expect(OLIST_META.licencia).toContain("CC BY-NC-SA");
    expect(OLIST_META.particion).toContain("no vio");
  });

  it("las semanas con actividad están ordenadas y los márgenes dentro del dominio del modelo (±60 días)", () => {
    for (const item of listSellers()) {
      const weeks = getSeller(item.id)!.semanas;
      expect(weeks.map((w) => w.inicio)).toEqual([...weeks.map((w) => w.inicio)].sort());
      expect(weeks.every((w) => Math.abs(w.margen) <= 60 && w.items >= 1)).toBe(true);
    }
  });
});
