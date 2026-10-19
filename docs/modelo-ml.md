# Modelo de ML de línea base: integración, auditoría de alineación y plan

Estado al 19/10/2026. El modelo está en `twinchain-ml/` y se integra con la app a través de la pantalla **Modelo de
línea base** (`/modelo`). **Todavía no alimenta el pipeline de ingesta ni el motor de simulación**, y este documento
explica por qué: hay una decisión de unidades que tomar primero (sección 4, hallazgo 1).

## 1. Qué es el modelo

Para un **vendedor real de Olist**, estima cuánto **margen de despacho** (`margin_days = shipping_limit_date −
order_delivered_carrier_date`, en días; positivo = despachó antes de su compromiso) debería tener en adelante, usando
solo estadísticos de **sus propias primeras 4 semanas con actividad** (Fase I, RF017: nada de región, categoría ni
estacionalidad).

- Tres `GradientBoostingRegressor` de cuantil (0,1 / 0,5 / 0,9) sobre 7 features de Fase I. La mediana es la línea base.
- **Conformalized Quantile Regression (CQR)** agrega una holgura Q para que las bandas cubran el 80 %. Hay dos:
  - **banda del promedio** de Fase II (la de la guía): `banda_inferior / banda_superior`;
  - **banda semanal**, para comparar una semana individual (la que corresponde a alertas semana a semana).
- Entrenado con Olist (110.187 ítems despachados, 1.460 vendedores usables), 60 % / 20 % / 20 % con semilla 42.

## 2. Verificación independiente

No di por buenas las cifras del documento de devolución: las **reproduje desde el bundle** sobre su partición de test
(292 vendedores que el modelo nunca vio).

| Métrica | Reproducido | Declarado |
|---|---|---|
| Error medio de la línea base | 1,3583 d | 1,3583 d |
| Error del método ingenuo (media de Fase I) | 1,8257 d | 1,8257 d |
| Cobertura de la banda del promedio (CQR) | 79,11 % | 79,11 % |
| Cobertura de la banda semanal | 79,82 % | 79,82 % |

- **Paridad de features:** la API calcula exactamente lo mismo que el entrenamiento (120 de 120 vendedores comparados).
- **Integridad:** el servicio publica el SHA-256 del bundle (`/health`) y un test falla si el archivo cambia.

## 3. Cómo quedó integrado

```
Navegador ──► Next.js en Vercel ──────────► twinchain-ml (FastAPI)
              /api/ml/estado                  POST /evaluar_serie, GET /info, GET /health
              /api/ml/vendedor                x-api-key (ML_API_KEY)
              lib/ml-client (Zod, timeouts)   bundle v2 + sklearn 1.9.1 exacto
```

- **`twinchain-ml/`**: el servicio de `training model/api.py`, con el **mismo contrato** y estos agregados:
  `POST /evaluar_serie`, `GET /info`, clave de API opcional, validación de rangos (±60 días, sin `NaN`), reordenamiento
  de cuantiles cruzados y errores sin eco del valor recibido. Incluye Dockerfile, `render.yaml` y 22 tests.
- **`src/lib/ml-client/`**: cliente tipado con validación de las respuestas, tiempo de espera de 75 s (arranque en frío de
  Render) y errores con código (`not_configured`, `timeout`, `unauthorized`, …). 16 tests junto con el armado de la exploración.
- **Pantalla `/modelo`**: 40 vendedores **reales y no vistos por el modelo** (`src/data/olist-vendedores.json`). Muestra la
  Fase I, la línea base, las dos bandas y el estado de cada semana posterior; compara contra el método ingenuo, incluso
  cuando el ingenuo gana; y muestra las métricas del bundle, **incluida la validación temporal**.
- **La clave y el servicio nunca llegan al navegador.** Las rutas `/api/ml/*` exigen sesión y corren en el servidor.
- **Sin servicio, la app sigue andando.** `/modelo` informa "no configurado", "sin respuesta" o "clave inválida".

**Probado de punta a punta** (base local + servicio real + app): estado, vendedores y los modos de falla (servicio
caído, clave equivocada, sin sesión, vendedor inexistente). Los números de la pantalla coinciden con el cálculo directo del
bundle en los tres vendedores que contrasté.

**Defectos del servicio original que aparecieron al probarlo** (ya corregidos): un cliente que manda `NaN` o `Infinity`
recibía un 500 en vez de un 422; un cuantil cruzado (1 de 1.798 vendedores) producía una banda invertida; el 500 devolvía
el texto de la excepción.

**Qué falta para verlo en producción:** desplegar el servicio en Render (acción tuya: Blueprint con `render.yaml`) y
cargar `ML_SERVICE_URL` y `ML_API_KEY` en Vercel. El Dockerfile no se probó (no había Docker corriendo).

## 4. Auditoría de alineación: lo que no encaja

### Hallazgo 1 — Las unidades no coinciden (bloquea integrarlo al pipeline)

El modelo de datos define `valor_real` del Vendedor como *"Olist: comparación de fecha estimada vs. fecha real de entrega"*,
es decir **días**. Pero la app entera usa una escala de **0 a 100** para todos los tipos de nodo: el generador sintético
(que escribí yo siguiendo la convención del mock), el eje de los gráficos (`domain={[0, 100]}`) y la agregación del
motor, que suma los déficits de todos los nodos y los divide por 100 para obtener "semanas malas equivalentes".

Con un Vendedor en días, esa suma mezcla unidades (un déficit de 2 días contra uno de 40 puntos) y el Vendedor casi no
pesa. Lo que sí es independiente de la unidad: el motor propaga caídas **relativas** (`baseline × (1 − drop/100)`), el
CUSUM está estandarizado y el estado de nodo se mide en σ.

**Por qué no lo forcé:** convertir días a 0–100 requiere inventar una escala, y cambiar el motor para que agregue déficits
relativos modifica una definición de la tesis ("semana mala equivalente"). Es una decisión metodológica, no un detalle.

### Hallazgo 2 — La ventana de Fase I es de 4 semanas, no de 24

El modelo se define con **4 semanas activas**; la app estima la línea base y corre el CUSUM sobre **24**. En Olist la
mediana de semanas activas por vendedor es **5** y solo 478 de 2.970 vendedores llegan a 24: con datos reales, la
verificación de estabilidad (C24) no se puede correr como hoy.

### Hallazgo 3 — "Semana con actividad" no es "semana calendario"

El modelo cuenta semanas **con actividad**, y el **38 %** de los saltos entre dos de ellas supera los 7 días. La app maneja
semanas calendario consecutivas. La pantalla `/modelo` lo rotula (S1, S2…) pero el pipeline tendría que decidir cómo
ubicarlas en el eje de tiempo.

### Hallazgo 4 — La validación temporal es bastante peor que la aleatoria

| | Aleatoria | Temporal |
|---|---|---|
| Cobertura de la banda del promedio (promete 80 %) | 79,1 % | **65,8 %** |
| Cobertura de la banda semanal (promete 80 %) | 79,8 % | 79,1 % |
| Semanas por debajo de la banda semanal | 7,7 % | 14,4 % |

Si la banda del promedio alimentara las réplicas del motor (RF012 / RF023), subestimaría la incertidumbre en vendedores
nuevos. La banda semanal aguanta bien, pero el esquema no tiene dónde guardarla (solo hay `banda_inferior/superior`).

### Hallazgo 5 — El modelo encoge hacia el centro, y casi no supera a un modelo lineal

Sobre 1.798 vendedores, la línea base predicha va de **2,4 a 4,2 días** (percentiles 5 a 95), mientras que los niveles
reales van de 0,5 a 5,5 (percentiles 10 a 90). Contra otros modelos, en 10 particiones:

| Modelo | Error medio |
|---|---|
| GBR cuantil (el del bundle) | 1,260 |
| Ridge / regresión lineal | 1,283 / 1,285 |
| Constante (mediana de Fase II en train) | 1,327 |
| Ingenuo (media de Fase I) | 1,824 |

La ganancia sobre el ingenuo existe y es sólida (−31 %), pero casi toda viene de encoger hacia el centro: una constante la
consigue casi igual. Además la banda semanal mide ±2,8 días alrededor de una línea base de ~3: **solo detecta degradaciones
severas**. Conviene decirlo antes de que lo pregunte un evaluador, y no es un obstáculo para integrarlo.

### Hallazgo 6 — La documentación funcional describe otro modelo

`docs/TwinChain-DEV.md` (§6 y Fase 5) especifica un **clasificador de backorder** con scoring en cada tick y alertas por
umbral de probabilidad. El modelo real es una **regresión de línea base con bandas CQR**, coherente con `modelo-datos.md` y
la bitácora. El spec quedó desactualizado en este punto (y habla de Python 3.12, XGBoost y Railway).

### Hallazgo 7 — Otros, menores

- **Solo cubre `Vendedor`**: los otros 4 tipos de nodo no tienen modelo ni datos reales.
- **Sin reentrenamiento ni versionado de modelos**: el bundle se entrenó con el 60 % de una partición aleatoria; no hay
  política de reentrenamiento. Hoy es un artefacto estático (con hash).
- **El detector no usa ninguna banda del modelo.** El estado de nodo (déficit en σ) y el CUSUM de la app son independientes
  del ML; para los Vendedores habría dos detectores posibles (σ propio vs. banda semanal del modelo).
- **Licencia:** Olist es CC BY-NC-SA 4.0 (uso no comercial). Está bien para una tesis, pero choca con la narrativa de
  "salida al mercado" de los tiers si alguna vez fuera real. La pantalla `/modelo` lo declara.
- **Arranque en frío:** en Render gratis el primer pedido tarda hasta un minuto. Aceptable en una pantalla de exploración,
  inaceptable si se llamara en cada creación de cadena.

## 5. Plan de acción

**Lo que cambia con tu decisión es la Fase B.** Las fases A, C y D no dependen de ella.

| Fase | Qué | Quién | Tamaño |
|---|---|---|---|
| **A. Ponerlo en producción** | Desplegar `twinchain-ml` en Render (Blueprint), cargar `ML_SERVICE_URL` y `ML_API_KEY` en Vercel, redesplegar y probar `/modelo` | **Vos** (cuenta de Render) y yo | S |
| **B. Resolver las unidades** | Elegir una de las tres opciones de abajo | **Vos y quien defiende la tesis** | decisión |
| **C. Limpiar la documentación** | Actualizar `TwinChain-DEV.md` (§6 y Fase 5), `stack-tecnologico.md` y el diagrama C4 con el modelo real | Yo | S |
| **D. Cerrar la brecha de cobertura** | Recalibrar el CQR con partición temporal (y/o reentrenar con todos los datos) para que la banda del promedio cubra cerca del 80 % también en vendedores nuevos; definir la política de reentrenamiento | Yo, con tu OK al método | M |
| **E. Integrar al pipeline** (según B) | Ver abajo | Yo | L |

### Fase B: las tres opciones

- **Opción 1 — Vendedor real en días, motor relativo (mi recomendación).** El Vendedor conserva las unidades del modelo de
  datos (días). El motor pasa a agregar **déficit relativo** (`déficit / línea base`), lo que lo deja sin unidades y arregla
  de paso la mezcla entre tipos. Es la más fiel a la tesis y la que permite usar el ML tal cual. Cuesta: tocar la
  preparación de datos del motor (servidor y 3 pantallas), ejes por tipo en los gráficos, y decidir cómo ubicar semanas
  activas en el tiempo. **Requiere aprobar el cambio de definición de "semana mala equivalente".**
- **Opción 2 — Reentrenar sobre un puntaje 0–100.** Cambiar el target del modelo a algo ya en escala porcentual (por
  ejemplo, la tasa de ítems despachados a tiempo por semana, también calculable con Olist). La app no cambia, pero es **otro
  modelo**: hay que reentrenar y revalidar, y se pierde lo ya medido.
- **Opción 3 — Dejar el ML como módulo de exploración** (lo que hay hoy). Cero riesgo, ya está hecho, pero el sistema sigue
  usando el estimador provisorio y la respuesta a "¿el ML está integrado?" es "en una pantalla, no en el pipeline".

### Fase E (si se elige la Opción 1)

1. Los nodos Vendedor toman un vendedor real de la muestra (hay 392 con 28 o más semanas activas) en vez de datos sintéticos.
2. La ingesta llama a `/predecir_desde_semanas` con sus 4 primeras semanas para fijar la línea base y la banda del promedio,
   con el estimador provisorio como respaldo si el servicio no contesta, y registrando de dónde salió cada línea base.
3. El monitoreo en vivo de un Vendedor avanza por sus semanas reales siguientes y se detiene al agotarlas.
4. Decidir qué detector rige para Vendedores (el de σ propio o la banda semanal) y qué ventana usa C24.
5. Si se quiere la banda semanal: dos columnas nuevas en `desempeno_semanal` (migración).

## 6. Archivos nuevos

| Ruta | Qué |
|---|---|
| `twinchain-ml/` | Servicio, bundle, tests, Dockerfile, `render.yaml`, README, y copia de `training/` y `validation/` |
| `src/lib/ml-client/` | Cliente tipado del servicio |
| `src/lib/olist/` y `src/data/olist-vendedores.json` | Muestra de vendedores reales y armado de la exploración |
| `src/app/api/ml/{estado,vendedor}/` | Rutas del lado servidor |
| `src/app/(app)/modelo/`, `src/components/model/` | Pantalla "Modelo de línea base" |
