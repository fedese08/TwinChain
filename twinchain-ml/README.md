# twinchain-ml — microservicio de línea base de vendedor

Servicio FastAPI que predice, para un vendedor real de Olist, **cuánto margen de despacho debería tener** a partir
de sus propias primeras 4 semanas con actividad (RF017), con dos bandas de incertidumbre calibradas por CQR.
Es el contenedor "Microservicio de ML" de la arquitectura C4. La app lo llama desde el servidor (`src/lib/ml-client`);
el navegador nunca habla con él.

**Unidades: días de `margin_days`** (`shipping_limit_date − order_delivered_carrier_date`; positivo = despachó antes de
su compromiso). **No** es el desempeño 0–100 que usa el resto de la app. Ver `docs/modelo-ml.md`.

## Contrato

| Ruta | Para qué |
|---|---|
| `POST /predecir_desde_semanas` | `{semanas: [4 × {margin_mean, n_items}]}` → línea base y bandas |
| `POST /predecir` | Lo mismo desde las 7 features ya calculadas |
| `POST /evaluar_semana` | Fase I + una semana → `normal` / `por_debajo` / `por_encima` |
| `POST /evaluar_serie` | Fase I + toda la Fase II → predicción y un estado por semana (una sola predicción) |
| `GET /info` | Qué es el modelo y cómo anda, **incluida la validación temporal** |
| `GET /health` | Versión y SHA-256 del bundle (el health check de la plataforma, sin clave) |

Respuesta de predicción: `linea_base`, `banda_inferior/superior` (banda del **promedio** de Fase II: la del modelo de
datos, RF012) y `banda_semanal_inferior/superior` (para **una semana** individual: la de las alertas).

`/predecir`, `/predecir_desde_semanas` y `/evaluar_semana` son el contrato original de `training model/api.py`;
`/evaluar_serie` y `/info` son agregados. Con `ML_API_KEY` definida, todo salvo `/health` exige el header `x-api-key`.

## Correrlo y probarlo

```bash
cd twinchain-ml
python3.14 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q                                    # 22 tests
ML_API_KEY=clave .venv/bin/uvicorn api:app --port 8001 # y en la app: ML_SERVICE_URL=http://127.0.0.1:8001 ML_API_KEY=clave
```

Los tests comparan contra **24 vendedores reales que el modelo nunca vio**, con predicciones calculadas por el código
original de entrenamiento (`tests/fixtures/golden_sellers.json`), y verifican que `features.py` (sin pandas) calcula
exactamente lo mismo que `training/features.py`.

## Desplegarlo en Render

1. Render → New → **Blueprint** → este repo (usa `render.yaml`, servicio Docker con `rootDir: twinchain-ml`).
2. Render genera `ML_API_KEY`: copiarla, junto con la URL del servicio, a las variables de Vercel (`ML_API_KEY`,
   `ML_SERVICE_URL`) y redesplegar.
3. El plan gratuito **se duerme tras ~15 minutos sin uso**: el primer pedido tarda hasta un minuto. La app lo tolera
   (espera hasta 75 s y lo explica en pantalla), pero no conviene meterlo en un camino crítico.

El Dockerfile **no se probó** (no había Docker corriendo al armarlo); el servicio sí se probó con `uvicorn` y la
suite completa.

## Qué hay en cada carpeta

| | |
|---|---|
| `api.py`, `features.py`, `model/` | El servicio y el bundle `baseline_model_bundle_v2.joblib` (+ su SHA-256) |
| `tests/` | Suite del servicio y los datos de referencia (`make_fixtures.py` los regenera) |
| `training/` | Notebooks y `features.py` de entrenamiento, tal como están en `~/Desktop/training model` (sin los CSV de Olist: 250 MB, se bajan de Kaggle) |
| `validation/` | Scripts y resultados de la validación académica (`RESPUESTAS_DEVOLUCION.md`) |

## Límites conocidos

- El bundle es un **pickle de scikit-learn 1.9.1**: se carga solo con esa versión exacta (por eso `requirements.txt`
  fija todo). Cargar un `.joblib` ajeno ejecuta código: solo el que genera este proyecto.
- Entrenado con el **60 % de una partición aleatoria** (semilla 42), no con todos los datos; no hay reentrenamiento
  programado.
- Solo cubre `Vendedor`: es el único tipo de nodo con datos reales.
- Los tres modelos de cuantiles son independientes y pueden cruzarse (1 de 1.798 vendedores); el servicio los
  reordena para garantizar `banda_inferior ≤ linea_base ≤ banda_superior`.
- Datos: Olist Brazilian E-Commerce Public Dataset, CC BY-NC-SA 4.0 (uso no comercial).
