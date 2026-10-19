"""TwinChain — microservicio de línea base de vendedor + banda CQR (modelo v2).

Contrato original (de `training model/api.py`, se mantiene): POST /predecir, /predecir_desde_semanas,
/evaluar_semana y GET /health. Agregados, sin tocar el modelo: POST /evaluar_serie, GET /info, clave de API
opcional, validación de rangos y una guarda contra cuantiles cruzados.

Unidades: TODO está en DÍAS de `margin_days` (shipping_limit_date - order_delivered_carrier_date). Positivo =
despachó antes de su compromiso; negativo = despachó tarde. NO es el desempeño 0-100 que usa el resto de la app.
"""
import hashlib
import logging
import os
import secrets
from pathlib import Path
from typing import List, Literal, Optional

import joblib
import numpy as np
import scipy
import sklearn
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from features import OUTLIER_ABS_DAYS, base_features_from_weeks

log = logging.getLogger("twinchain-ml")

BUNDLE_PATH = Path(__file__).parent / "model" / "baseline_model_bundle_v2.joblib"
bundle = joblib.load(BUNDLE_PATH)
BUNDLE_SHA256 = hashlib.sha256(BUNDLE_PATH.read_bytes()).hexdigest()
models = bundle["quantile_models"]
Q = bundle["cqr_adjustment_Q_days"]
Q_WEEK = bundle["cqr_adjustment_Q_weekly_days"]
FEATURE_COLS = bundle["feature_columns"]
PHASE1_N_WEEKS = bundle["phase1_n_weeks"]
MAX_SERIE_SEMANAS = 260


def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Si `ML_API_KEY` está definida, toda ruta salvo /health la exige. Sin clave el servicio queda abierto:
    solo para desarrollo local (en Render la genera `render.yaml`)."""
    expected = os.environ.get("ML_API_KEY")
    if not expected:
        return
    if x_api_key is None or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="API key inválida o ausente")


app = FastAPI(title="TwinChain — Línea base de vendedor + banda CQR (v2)")
protegida = [Depends(require_api_key)]


@app.exception_handler(RequestValidationError)
async def entrada_invalida(_request, exc: RequestValidationError):
    """422 sin devolver el valor recibido: con el manejador por defecto, un cliente que manda NaN o Infinity
    (JSON no estándar) hacía fallar la serialización del propio mensaje de error y recibía un 500."""
    errores = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errores})



class VendedorFase1(BaseModel):
    """Estadísticos de la Fase I propia del vendedor (RF017)."""
    phase1_mean: float = Field(allow_inf_nan=False)
    phase1_std: float = Field(allow_inf_nan=False)
    phase1_min: float = Field(allow_inf_nan=False)
    phase1_max: float = Field(allow_inf_nan=False)
    phase1_mean_items_per_week: float = Field(allow_inf_nan=False)
    phase1_total_items: float = Field(allow_inf_nan=False)
    phase1_n_weeks: float = Field(allow_inf_nan=False)


class Semana(BaseModel):
    margin_mean: float = Field(ge=-OUTLIER_ABS_DAYS, le=OUTLIER_ABS_DAYS, allow_inf_nan=False,
                               description="Promedio de margin_days de los ítems despachados esa semana")
    n_items: int = Field(ge=1, le=100_000, description="Ítems despachados esa semana")


class SemanasFase1(BaseModel):
    semanas: List[Semana] = Field(description="Las primeras 4 semanas con actividad del vendedor, en orden")


class EvaluarSemanaRequest(BaseModel):
    fase1: List[Semana] = Field(description="Las primeras 4 semanas con actividad del vendedor, en orden")
    margin_mean_semana: float = Field(ge=-OUTLIER_ABS_DAYS, le=OUTLIER_ABS_DAYS, allow_inf_nan=False,
                                      description="margin_mean de la semana de Fase II a evaluar")


class EvaluarSerieRequest(BaseModel):
    fase1: List[Semana] = Field(description="Las primeras 4 semanas con actividad del vendedor, en orden")
    fase2: List[float] = Field(min_length=1, max_length=MAX_SERIE_SEMANAS,
                               description="margin_mean de cada semana de Fase II a evaluar, en orden")


class PrediccionResponse(BaseModel):
    linea_base: float
    # banda del promedio de Fase II (la de la guía): para comparar el desempeño acumulado
    banda_inferior: float
    banda_superior: float
    # banda semanal: para comparar una semana individual (alertas semana a semana)
    banda_semanal_inferior: float
    banda_semanal_superior: float


Estado = Literal["normal", "por_debajo", "por_encima"]


class EvaluacionResponse(BaseModel):
    estado: Estado
    margin_mean_semana: float
    prediccion: PrediccionResponse


class SemanaEvaluada(BaseModel):
    indice: int
    margin_mean: float
    estado: Estado


class ResumenSerie(BaseModel):
    semanas: int
    por_debajo: int
    normal: int
    por_encima: int
    fraccion_por_debajo: float


class EvaluarSerieResponse(BaseModel):
    prediccion: PrediccionResponse
    evaluaciones: List[SemanaEvaluada]
    resumen: ResumenSerie


def _predecir(features: dict) -> PrediccionResponse:
    X = np.array([[features[col] for col in FEATURE_COLS]])
    # Los tres modelos de cuantiles son independientes y pueden cruzarse (medido: 1 de 1.798 vendedores).
    # Se reordenan para garantizar banda_inferior <= linea_base <= banda_superior, que el resto del sistema asume.
    lo, med, hi = sorted(float(models[q].predict(X)[0]) for q in (0.1, 0.5, 0.9))
    return PrediccionResponse(
        linea_base=round(med, 3),
        banda_inferior=round(lo - Q, 3),
        banda_superior=round(hi + Q, 3),
        banda_semanal_inferior=round(lo - Q_WEEK, 3),
        banda_semanal_superior=round(hi + Q_WEEK, 3),
    )


def _features_desde_semanas(semanas: List[Semana]) -> dict:
    if len(semanas) != PHASE1_N_WEEKS:
        raise HTTPException(
            status_code=422, detail=f"La Fase I requiere exactamente {PHASE1_N_WEEKS} semanas con actividad",
        )
    return base_features_from_weeks([s.margin_mean for s in semanas], [s.n_items for s in semanas])


def _estado(valor: float, pred: PrediccionResponse) -> Estado:
    if valor < pred.banda_semanal_inferior:
        return "por_debajo"
    if valor > pred.banda_semanal_superior:
        return "por_encima"
    return "normal"


@app.post("/predecir", response_model=PrediccionResponse, dependencies=protegida)
async def predecir(vendedor: VendedorFase1):
    try:
        return _predecir(vendedor.model_dump())
    except Exception:
        log.exception("Falló la predicción")
        raise HTTPException(status_code=500, detail="Error interno de predicción")


@app.post("/predecir_desde_semanas", response_model=PrediccionResponse, dependencies=protegida)
async def predecir_desde_semanas(req: SemanasFase1):
    return _predecir(_features_desde_semanas(req.semanas))


@app.post("/evaluar_semana", response_model=EvaluacionResponse, dependencies=protegida)
async def evaluar_semana(req: EvaluarSemanaRequest):
    pred = _predecir(_features_desde_semanas(req.fase1))
    return EvaluacionResponse(
        estado=_estado(req.margin_mean_semana, pred), margin_mean_semana=req.margin_mean_semana, prediccion=pred,
    )


@app.post("/evaluar_serie", response_model=EvaluarSerieResponse, dependencies=protegida)
async def evaluar_serie(req: EvaluarSerieRequest):
    """Como /evaluar_semana para toda la Fase II de una vez: una sola predicción y un estado por semana."""
    if any(not np.isfinite(v) or abs(v) > OUTLIER_ABS_DAYS for v in req.fase2):
        raise HTTPException(status_code=422, detail=f"Cada semana de Fase II debe estar entre ±{OUTLIER_ABS_DAYS} días")
    pred = _predecir(_features_desde_semanas(req.fase1))
    evaluadas = [SemanaEvaluada(indice=i, margin_mean=v, estado=_estado(v, pred)) for i, v in enumerate(req.fase2)]
    cuenta = {e: sum(1 for x in evaluadas if x.estado == e) for e in ("por_debajo", "normal", "por_encima")}
    return EvaluarSerieResponse(
        prediccion=pred,
        evaluaciones=evaluadas,
        resumen=ResumenSerie(semanas=len(evaluadas), fraccion_por_debajo=cuenta["por_debajo"] / len(evaluadas), **cuenta),
    )


def _plano(valor):
    """Métricas del bundle vienen como np.float64: se pasan a tipos JSON."""
    if isinstance(valor, dict):
        return {k: _plano(v) for k, v in valor.items()}
    if isinstance(valor, (np.floating, np.integer)):
        return valor.item()
    return valor


@app.get("/info", dependencies=protegida)
async def info():
    """Metadatos del modelo: qué es, con qué se entrenó y qué tan bien anda (incluida la validación TEMPORAL)."""
    return {
        "version": bundle.get("version"),
        "bundle_sha256": BUNDLE_SHA256,
        "familia": bundle.get("model_family"),
        "incertidumbre": bundle.get("uncertainty_technique"),
        "dataset": bundle.get("training_dataset"),
        "definicion_target": bundle.get("target_definition"),
        "unidad": "días de margen (margin_days); positivo = despacho antes del compromiso",
        "fase1_semanas": PHASE1_N_WEEKS,
        "features": FEATURE_COLS,
        "bandas": bundle.get("bands"),
        "q_dias": Q,
        "q_semanal_dias": Q_WEEK,
        "metricas_validacion_aleatoria": _plano(bundle.get("test_metrics_seed42")),
        "metricas_validacion_temporal": _plano(bundle.get("temporal_validation")),
        "runtime": {"sklearn": sklearn.__version__, "numpy": np.__version__, "scipy": scipy.__version__},
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": bundle.get("version"),
        "features_esperadas": len(FEATURE_COLS),
        "bundle_sha256": BUNDLE_SHA256,
    }
