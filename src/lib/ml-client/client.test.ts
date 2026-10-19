import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mlClient, mlConfig, MlServiceError } from "./client";

const prediction = { linea_base: 3.2, banda_inferior: 1.7, banda_superior: 4.6, banda_semanal_inferior: 0.6, banda_semanal_superior: 5.6 };
const evaluation = {
  prediccion: prediction,
  evaluaciones: [{ indice: 0, margin_mean: 2.5, estado: "normal" }],
  resumen: { semanas: 1, por_debajo: 0, normal: 1, por_encima: 0, fraccion_por_debajo: 0 },
};
const phase1 = Array.from({ length: 4 }, () => ({ margin_mean: 3, n_items: 2 }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("cliente del microservicio de línea base", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("ML_SERVICE_URL", "http://ml.test/");
    vi.stubEnv("ML_API_KEY", "clave");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sin ML_SERVICE_URL no llama a nadie y lo dice con un código claro", async () => {
    vi.stubEnv("ML_SERVICE_URL", "");
    expect(mlConfig()).toBeNull();
    await expect(mlClient.health()).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normaliza la URL, manda la clave y valida la respuesta", async () => {
    fetchMock.mockResolvedValue(json(evaluation));
    const result = await mlClient.evaluateSeries({ phase1, phase2: [2.5] });
    expect(result.resumen.normal).toBe(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ml.test/evaluar_serie");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "clave", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ fase1: phase1, fase2: [2.5] });
  });

  it("predict pide la línea base con las 4 semanas de Fase I y respeta el timeout que se le pasa", async () => {
    fetchMock.mockResolvedValue(json(prediction));
    const result = await mlClient.predict({ phase1, timeoutMs: 1234 });
    expect(result.linea_base).toBe(3.2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ml.test/predecir_desde_semanas");
    expect(JSON.parse(init.body)).toEqual({ semanas: phase1 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sin clave configurada no manda el header", async () => {
    vi.stubEnv("ML_API_KEY", "");
    fetchMock.mockResolvedValue(json({ status: "ok", version: "v2", features_esperadas: 7, bundle_sha256: "abc" }));
    await mlClient.health();
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("x-api-key");
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [500, "server_error"],
    [503, "server_error"],
  ])("el estado HTTP %i se traduce a %s", async (status, code) => {
    fetchMock.mockResolvedValue(json({ detail: "x" }, status));
    await expect(mlClient.info()).rejects.toMatchObject({ code, status });
  });

  it("un 422 trae el motivo del servicio", async () => {
    fetchMock.mockResolvedValue(json({ detail: [{ loc: ["body"], msg: "La Fase I requiere exactamente 4 semanas", type: "x" }] }, 422));
    await expect(mlClient.evaluateSeries({ phase1, phase2: [1] })).rejects.toMatchObject({
      code: "rejected",
      message: "La Fase I requiere exactamente 4 semanas",
    });
  });

  it("distingue falta de respuesta a tiempo de falta de conexión", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(mlClient.health()).rejects.toMatchObject({ code: "timeout" });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(mlClient.health()).rejects.toMatchObject({ code: "unreachable" });
  });

  it("una respuesta con otra forma no se propaga: bad_response", async () => {
    fetchMock.mockResolvedValue(json({ prediccion: { linea_base: "tres" } }));
    const error = await mlClient.evaluateSeries({ phase1, phase2: [1] }).catch((e) => e);
    expect(error).toBeInstanceOf(MlServiceError);
    expect(error.code).toBe("bad_response");
  });
});
