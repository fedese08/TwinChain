// El CUSUM del Flujo A: acumula solo lo que excede el margen, confirma al superar el umbral y se reinicia.
import { describe, expect, it } from "vitest";
import { ALERT_HOLD_WEEKS, degradationStatus, runCusum, type CusumRow } from "@/lib/domain/degradation";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";

const START = "2026-01-05";
/** Nodo con línea base 3 d y banda de la línea base 2,0 a 4,0: margen K = 1 d. */
const rows = (values: number[]): CusumRow[] =>
  values.map((actualValue, i) => ({ weekStart: addWeeksIso(START, i), actualValue, baseline: 3, baselineLowerBand: 2 }));

describe("CUSUM de degradación sostenida", () => {
  it("el ruido dentro del margen no acumula nada, por más semanas que pasen", () => {
    const run = runCusum(rows([2.5, 3.4, 2.1, 3, 2.2, 3.6, 2.4, 3, 2.3, 3.1]), 4);
    expect(run.episodes).toHaveLength(0);
    expect(run.weeks.every((w) => w.accumulated === 0)).toBe(true);
  });

  it("una semana mala aislada que se recupera sola no confirma (HU1), y lo acumulado se descuenta con las semanas buenas", () => {
    const run = runCusum(rows([3, 3, 3, 0, 3, 3, 3, 3]), 4); // un déficit de 3 d en una sola semana: S = 3 − 1 = 2 < 4
    expect(run.weeks[3].accumulated).toBeCloseTo(2, 9);
    expect(run.episodes).toHaveLength(0);
    expect(run.weeks[4].accumulated).toBe(1); // la semana buena (+0 − K) descuenta 1
    expect(run.weeks[5].accumulated).toBe(0);
  });

  it("límite propio del CUSUM: suma magnitudes, así que una única semana extremadamente mala sí puede confirmar", () => {
    expect(runCusum(rows([3, 3, 3, -2, 3, 3]), 4).episodes).toHaveLength(1); // déficit de 5 d: 5 − 1 = 4 ≥ 4
  });

  it("acumula lo que excede el margen y confirma cuando supera h·K, con desde cuándo y magnitud (HU2)", () => {
    // Déficit de 2 d por semana desde la semana 3: cada semana suma 2 − K = 1; con h = 4 confirma a la cuarta semana.
    const run = runCusum(rows([3, 3, 3, 1, 1, 1, 1, 1, 1]), 4);
    expect(run.episodes).toHaveLength(1);
    const [episode] = run.episodes;
    expect(episode.since).toBe(addWeeksIso(START, 3));
    expect(episode.confirmedWeek).toBe(addWeeksIso(START, 6));
    expect(episode.weeks).toBe(4);
    expect(episode.accumulatedDeficit).toBeCloseTo(8, 9);
    expect(episode.meanDeficit).toBeCloseTo(2, 9);
  });

  it("al confirmar se reinicia: no vuelve a avisar la semana siguiente, pero si sigue degradado vuelve a confirmar más adelante", () => {
    const run = runCusum(rows([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 4);
    const confirmedAt = run.weeks.flatMap((w, i) => (w.confirmed ? [i] : []));
    expect(confirmedAt[0]).toBe(3);
    expect(confirmedAt[1]).toBe(7); // otra racha completa de cuatro semanas, no la semana 4
    expect(run.weeks[3].accumulated).toBe(0);
  });

  it("las semanas buenas descuentan lo acumulado (el residuo se usa con signo)", () => {
    const withRecovery = runCusum(rows([1, 1, 1, 5, 5, 1, 1, 1]), 4); // 1+1+1 = 3 de S, luego +2 +2 de recuperación
    expect(withRecovery.weeks[2].accumulated).toBeCloseTo(3, 9);
    expect(withRecovery.weeks[4].accumulated).toBe(0);
  });

  it("no depende del orden en que vengan las filas y la presencia de una banda más ancha vuelve el detector menos sensible", () => {
    const data = rows([3, 3, 1, 1, 1, 1, 1]);
    expect(runCusum([...data].reverse(), 4)).toEqual(runCusum(data, 4));
    const wide = data.map((r) => ({ ...r, baselineLowerBand: 0 })); // margen de 3 d: déficits de 2 d ya no exceden
    expect(runCusum(wide, 4).episodes).toHaveLength(0);
  });
});

describe("estado del nodo según el CUSUM", () => {
  it("normal sin degradación; atención mientras se acumula; alerta al confirmar y por unas semanas después", () => {
    expect(degradationStatus(rows([3, 3, 3, 3]), 4).level).toBe("normal");
    expect(degradationStatus(rows([3, 3, 1, 1, 1]), 4).level).toBe("atencion"); // S = 3: más de la mitad de h·K = 4
    const alerta = degradationStatus(rows([3, 3, 1, 1, 1, 1]), 4);
    expect(alerta.level).toBe("alerta");
    expect(alerta.active?.since).toBe(addWeeksIso(START, 2));
  });

  it("la alerta confirmada se mantiene ALERT_HOLD_WEEKS semanas y después vuelve a normal si el nodo se recuperó", () => {
    const degraded = [1, 1, 1, 1]; // confirma en la semana 3
    const recovered = Array(ALERT_HOLD_WEEKS - 1).fill(3);
    expect(degradationStatus(rows([3, 3, ...degraded, ...recovered]), 4).level).toBe("alerta");
    expect(degradationStatus(rows([3, 3, ...degraded, ...recovered, 3]), 4).level).toBe("normal");
  });

  it("mientras el nodo sigue degradado, las confirmaciones consecutivas son UNA alerta que cuenta desde el comienzo (HU2)", () => {
    const status = degradationStatus(rows([3, 3, 1, 1, 1, 1, 1, 1, 1, 1]), 4); // confirma en las semanas 5 y 9
    expect(status.run.episodes.length).toBeGreaterThanOrEqual(2);
    expect(status.level).toBe("alerta");
    expect(status.active?.since).toBe(addWeeksIso(START, 2));
    expect(status.active?.confirmedWeek).toBe(addWeeksIso(START, 5)); // la primera: es la detección
    expect(status.active?.confirmations).toBeGreaterThanOrEqual(2);
    expect(status.active?.weeks).toBe(8);
    expect(status.active?.accumulatedDeficit).toBeCloseTo(16, 9);
    expect(status.active?.first.weeks).toBe(4);
  });
});
