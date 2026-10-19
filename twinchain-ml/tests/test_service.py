import hashlib
from pathlib import Path

import numpy as np
import pytest

import api

ROOT = Path(__file__).parents[1]


def fase1(seller):
    return seller["fase1"]


def test_health_expone_version_y_hash_del_bundle(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["version"] == "v2" and body["features_esperadas"] == 7
    assert body["bundle_sha256"] == (ROOT / "model" / "baseline_model_bundle_v2.joblib.sha256").read_text().strip()


def test_el_bundle_no_cambio_sin_avisar():
    computed = hashlib.sha256((ROOT / "model" / "baseline_model_bundle_v2.joblib").read_bytes()).hexdigest()
    assert computed == (ROOT / "model" / "baseline_model_bundle_v2.joblib.sha256").read_text().strip()


def test_valores_de_referencia_de_vendedores_reales(client, golden):
    """Predicciones esperadas calculadas con el código ORIGINAL de entrenamiento, de forma independiente."""
    assert len(golden) >= 20
    for s in golden:
        r = client.post("/predecir_desde_semanas", json={"semanas": fase1(s)})
        assert r.status_code == 200
        for campo, esperado in s["esperado"].items():
            assert r.json()[campo] == pytest.approx(esperado, abs=6e-4), (s["seller"], campo)


def test_invariantes_de_la_banda_en_vendedores_reales(client, golden):
    for s in golden:
        p = client.post("/predecir_desde_semanas", json={"semanas": fase1(s)}).json()
        assert p["banda_inferior"] <= p["linea_base"] <= p["banda_superior"]
        assert p["banda_semanal_inferior"] <= p["banda_inferior"] and p["banda_semanal_superior"] >= p["banda_superior"]


def test_predecir_con_las_7_features_da_lo_mismo_que_desde_semanas(client, golden):
    import features

    s = golden[0]
    f = features.base_features_from_weeks([w["margin_mean"] for w in fase1(s)], [w["n_items"] for w in fase1(s)])
    directo = client.post("/predecir", json={k: float(v) for k, v in f.items()}).json()
    assert directo == client.post("/predecir_desde_semanas", json={"semanas": fase1(s)}).json()


def test_evaluar_serie_coincide_con_evaluar_semana(client, golden):
    for s in golden[:6]:
        serie = client.post("/evaluar_serie", json={"fase1": fase1(s), "fase2": s["fase2_margin_mean"]}).json()
        assert serie["prediccion"] == client.post("/predecir_desde_semanas", json={"semanas": fase1(s)}).json()
        for e in serie["evaluaciones"]:
            una = client.post("/evaluar_semana", json={"fase1": fase1(s), "margin_mean_semana": e["margin_mean"]}).json()
            assert una["estado"] == e["estado"]
        r = serie["resumen"]
        assert r["semanas"] == len(s["fase2_margin_mean"]) == r["por_debajo"] + r["normal"] + r["por_encima"]
        assert r["fraccion_por_debajo"] == pytest.approx(r["por_debajo"] / r["semanas"])


def test_el_estado_depende_de_la_banda_semanal(client, golden):
    s = golden[0]
    p = client.post("/predecir_desde_semanas", json={"semanas": fase1(s)}).json()
    casos = {
        p["banda_semanal_inferior"] - 0.5: "por_debajo",
        p["linea_base"]: "normal",
        p["banda_semanal_superior"] + 0.5: "por_encima",
    }
    for valor, estado in casos.items():
        assert client.post("/evaluar_semana", json={"fase1": fase1(s), "margin_mean_semana": valor}).json()["estado"] == estado


@pytest.mark.parametrize("semanas", [3, 5, 0])
def test_la_fase1_exige_exactamente_4_semanas(client, golden, semanas):
    pesos = (fase1(golden[0]) * 2)[:semanas]
    assert client.post("/predecir_desde_semanas", json={"semanas": pesos}).status_code == 422


@pytest.mark.parametrize("cambio", [{"n_items": 0}, {"margin_mean": 61}, {"margin_mean": -61}])
def test_entradas_invalidas_se_rechazan(client, golden, cambio):
    semanas = [dict(w) for w in fase1(golden[0])]
    semanas[0].update(cambio)
    assert client.post("/predecir_desde_semanas", json={"semanas": semanas}).status_code == 422


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_valores_no_finitos_se_rechazan(client, golden, literal):
    """httpx no serializa NaN/Infinity (JSON estricto), pero un cliente mal portado sí los manda."""
    semanas = ",".join(
        f'{{"margin_mean": {literal if i == 0 else w["margin_mean"]}, "n_items": {w["n_items"]}}}' for i, w in enumerate(fase1(golden[0]))
    )
    r = client.post("/predecir_desde_semanas", content=f'{{"semanas": [{semanas}]}}', headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_evaluar_serie_rechaza_series_vacias_o_fuera_de_rango(client, golden):
    f1 = fase1(golden[0])
    assert client.post("/evaluar_serie", json={"fase1": f1, "fase2": []}).status_code == 422
    assert client.post("/evaluar_serie", json={"fase1": f1, "fase2": [1.0, 99.0]}).status_code == 422


def test_info_describe_el_modelo_y_su_validacion_temporal(client):
    body = client.get("/info").json()
    assert body["unidad"].startswith("días") and body["fase1_semanas"] == 4
    assert body["metricas_validacion_aleatoria"]["MAE línea base"] == pytest.approx(1.3583, abs=1e-3)
    # La validación temporal es la peor: la banda del promedio cubre bastante menos del 80 % prometido.
    assert body["metricas_validacion_temporal"]["cobertura CQR (promedio)"] < 0.7
    assert body["runtime"]["sklearn"] == "1.9.1"


def test_clave_de_api_cuando_esta_configurada(client, golden, monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "secreto")
    body = {"semanas": fase1(golden[0])}
    assert client.post("/predecir_desde_semanas", json=body).status_code == 401
    assert client.post("/predecir_desde_semanas", json=body, headers={"x-api-key": "otra"}).status_code == 401
    assert client.post("/predecir_desde_semanas", json=body, headers={"x-api-key": "secreto"}).status_code == 200
    assert client.get("/info").status_code == 401
    assert client.get("/health").status_code == 200  # el health check de la plataforma no lleva clave


def test_cuantiles_cruzados_se_reordenan(monkeypatch):
    """Los 3 modelos de cuantiles son independientes y pueden cruzarse: la banda nunca debe quedar invertida."""

    class Fijo:
        def __init__(self, valor):
            self.valor = valor

        def predict(self, X):
            return np.array([self.valor])

    monkeypatch.setattr(api, "models", {0.1: Fijo(5.0), 0.5: Fijo(3.0), 0.9: Fijo(1.0)})  # lo > med > hi
    p = api._predecir({c: 1.0 for c in api.FEATURE_COLS})
    assert p.banda_inferior <= p.linea_base <= p.banda_superior
