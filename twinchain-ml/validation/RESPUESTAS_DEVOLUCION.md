# Respuestas a la devolución académica: modelo de ML y detector de TwinChain

Todo lo de este documento sale del código, de los registros o de una corrida hecha para esta respuesta. Cada bloque lleva una etiqueta:

- **[VERIFICADO EN CÓDIGO]**: leído en un archivo, con su ruta.
- **[CORRIDO AHORA]**: calculado con un script nuevo; la salida está guardada en `scripts_validacion/resultados/`.
- **[NO EXISTE]**: no está implementado o no hay registro.
- **[NO VERIFICADO]**: no lo pude confirmar y hay que revisarlo.

**Rutas:** `TwinChain/` es `~/Documents/02 Areas/Uade/PFI/Proyecto/TwinChain`. `training model/` es `~/Desktop/training model`.

**No se modificó nada del sistema.** `git status` del repo da 0 cambios y sus 34 tests pasan. Los scripts nuevos están en `training model/scripts_validacion/`:

- `validacion_modelo.py`: bloques A y D.
- `detector_checks.ts`: bloque B4. Importa las funciones del repo en modo lectura.

---

## Hallazgos de fondo

1. **El ML no está integrado en el sistema.** `TwinChain/src/lib/domain/synthetic/estimate-baseline.ts:3` dice que el estimador es provisorio: una media recortada con intervalo de confianza del 90%, que reemplaza al microservicio de ML. `TwinChain/docs/pendientes.md:111-114` lo registra como pendiente a revisar con quien defiende la tesis. En el código no hay llamadas a `joblib`, `fastapi` ni `ml-client`; solo aparecen en la documentación de planificación. El único consumidor del bundle es `training model/api.py`, y nada del repo la llama.
2. **`REGISTRO_ENTRENAMIENTO.md` no existe** en ninguna carpeta que revisé (Desktop, Documents, Downloads, ni el repo).
3. **`RF019` y `DataCo` no aparecen** en el repo ni en la carpeta de entrenamiento.
4. **El detector que describen las preguntas del bloque B no está implementado.** No hay CUSUM semanal con k y h, ni banda CQR en el sistema.

---

## Bloque A: Modelo de ML

### A1. Cantidades del pipeline sobre Olist [CORRIDO AHORA]

Script: `scripts_validacion/validacion_modelo.py`, umbral de 60 días. CSV: `resultados/A1_cantidades_pipeline.csv`.

| Concepto | Cantidad |
|---|---|
| Ítems despachados antes del filtro | 110,195 |
| Filas descartadas por \|margin_days\| > 60 | **8** |
| Vendedores con al menos una semana de actividad | **2,970** |
| Descartados por Fase I corta (< 4 semanas) | 1,172 |
| Descartados por no llegar a Fase II (< 2 semanas) | 338 |
| **Vendedores usables** | **1,460** |
| Train (semilla 42) | 876 |
| Calibración (semilla 42) | 292 |
| Test (semilla 42) | 292 |

### A2. Pipeline completo con 10 semillas [CORRIDO AHORA]

La misma semilla fija la partición train/calibración/test y el modelo. La semilla 42 es la de referencia de la guía. CSV: `resultados/A2_diez_semillas.csv` y `resultados/A2_media_desvio.csv`.

| Semilla | MAE modelo | MAE ingenuo | Cobertura sin CQR | Cobertura con CQR | Q (días) |
|---|---|---|---|---|---|
| 42 | 1.3583 | 1.8257 | 0.6986 | 0.7911 | 0.2987 |
| 1 | 1.4105 | 2.0534 | 0.7055 | 0.8048 | 0.3192 |
| 2 | 1.2781 | 1.9924 | 0.7671 | 0.8185 | 0.1599 |
| 3 | 1.1952 | 1.8671 | 0.7432 | 0.8185 | 0.2889 |
| 4 | 1.3198 | 1.9593 | 0.7329 | 0.7842 | 0.2840 |
| 5 | 1.1872 | 1.7051 | 0.7123 | 0.7911 | 0.2423 |
| 6 | 1.2892 | 1.7470 | 0.7705 | 0.8151 | 0.1724 |
| 7 | 1.1755 | 1.7723 | 0.7500 | 0.8014 | 0.2310 |
| 8 | 1.1943 | 1.6626 | 0.7671 | 0.7911 | 0.0788 |
| 9 | 1.1895 | 1.6501 | 0.7500 | 0.8082 | 0.2857 |
| **Media** | **1.2598** | **1.8235** | **0.7397** | **0.8024** | **0.2361** |
| **Desvío (n−1)** | 0.0837 | 0.1415 | 0.0265 | 0.0126 | 0.0768 |

- **Sin CQR**, la cobertura se distingue del 80% (test binomial, p < 0.05) en 6 de 10 semillas. **Con CQR**, en 0 de 10.
- **Con la semilla 42:** MAE 1.358 contra 1.826 ingenuo, cobertura sin CQR 69.9% y con CQR 79.1%. Los valores de referencia que cita la guía (71.6% y 78.1%) no se reproducen exactamente. Puede deberse a la versión de scikit-learn (1.9.1), pero no lo verifiqué.

### A3. Bundle de producción y reentrenamiento [CORRIDO AHORA]

- Los dos bundles (`training model/baseline_model_bundle.joblib` y `..._v2.joblib`) se entrenaron con el **60% de la partición de semilla 42**. No se reentrenaron con todos los datos.
- **Verificación:** las predicciones del bundle coinciden con las de un modelo reentrenado con ese 60% (diferencia máxima 0.0). Contra un modelo entrenado con todos los datos, la diferencia máxima es de 5.0 días. Q del bundle es 0.298733 y coincide con el recalculado.
- **Reentrenamiento programado: [NO EXISTE].**
  - `TwinChain/.github/workflows/ci.yml` solo corre lint, typecheck y `drizzle-kit check`.
  - `TwinChain/vercel.json` solo define la región.
- **El sistema TwinChain no consume ningún bundle** (ver hallazgo 1).

### A4. Comparación con otros algoritmos

**No encontré ningún registro de comparación.** La guía cita un `REGISTRO_ENTRENAMIENTO.md` que no existe en ninguna carpeta que revisé. [NO EXISTE]

Lo corrí ahora [CORRIDO AHORA], sobre las mismas 10 particiones. MAE de la línea base en test. CSV: `resultados/A4_comparacion_algoritmos.csv` y `resultados/A4_media_desvio.csv`.

| Modelo | MAE medio | Desvío |
|---|---|---|
| **GBR cuantil 0.5 (guía)** | **1.2598** | 0.0837 |
| Ridge (alpha = 1) | 1.2833 | 0.0807 |
| Regresión lineal | 1.2854 | 0.0818 |
| GBR con pérdida cuadrática (mismos hiperparámetros) | 1.3202 | 0.0991 |
| Random Forest (300 árboles, hoja ≥ 5) | 1.3215 | 0.0839 |
| Constante: mediana de Fase II en train | 1.3271 | 0.0909 |
| Ingenuo: media de Fase I | 1.8235 | 0.1415 |

**Lectura:** el modelo de la guía le gana a la regresión lineal por apenas 0.02 días, y el desvío entre particiones es de 0.08. Casi todo el beneficio sobre el método ingenuo viene de encoger hacia el centro de la población, y un modelo lineal o una constante lo consiguen igual. Un evaluador puede objetarlo; conviene decirlo antes de que lo pregunten.

### A5. Definiciones y sensibilidad al umbral

**Definiciones [VERIFICADO EN CÓDIGO]:**

- **`margin_days`** = `shipping_limit_date − order_delivered_carrier_date`, en días (`training model/features.py`, función `load_items`; mismo cálculo en `baseline_model.ipynb`). Positivo = despachó antes de su compromiso; negativo = despachó tarde.
- **Semana:** `to_period('W').dt.start_time`. En pandas, 'W' es W-SUN: la semana va de lunes a domingo y se etiqueta con el lunes. Es una semana calendario con inicio en lunes, no una semana ISO estricta.
- **Umbral:** se conservan las filas con \|margin_days\| ≤ 60.

**Sensibilidad [CORRIDO AHORA]**, con 10 semillas por umbral. CSV: `resultados/A5_sensibilidad_umbral.csv`.

| Umbral | Filas descartadas | Vendedores usables | MAE modelo | MAE ingenuo | Cobertura con CQR | Q |
|---|---|---|---|---|---|---|
| 30 | 155 | 1,458 | 1.1934 | 1.7119 | 0.7939 | 0.1720 |
| 45 | 24 | 1,460 | 1.2615 | 1.8220 | 0.8058 | 0.2557 |
| **60** | 8 | 1,460 | 1.2598 | 1.8235 | 0.8024 | 0.2361 |
| 90 | 8 | 1,460 | 1.2598 | 1.8235 | 0.8024 | 0.2361 |
| sin filtro | 0 | 1,460 | 1.2602 | 1.8238 | 0.8000 | 0.2280 |

- Los umbrales de 45, 60 y 90 dan resultados prácticamente iguales.
- El de 30 baja el MAE absoluto, pero también cambia el ingenuo (por los datos descartados), así que el cociente modelo/ingenuo casi no se mueve (0.697 contra 0.691).
- 60 y 90 son idénticos porque las 8 anomalías superan los 90 días.
- La afirmación de la guía de que 30/45/60/90 dan "resultados casi idénticos" se confirma para 45, 60 y 90. Con 30 hay una diferencia visible en el MAE absoluto.

---

## Bloque B: Cómo se usan la línea base y la banda en el detector

### B1. Residuo semanal que entra a CUSUM [NO EXISTE como se plantea]

No hay un CUSUM sobre el residuo semanal. Lo que existe en `TwinChain/src/lib/domain/`:

- **Residuo semanal (déficit):** `deficit = max(línea_base − valor_real, 0)` (`synthetic/estimate-baseline.ts:65`). Es unilateral: las semanas buenas no compensan a las malas.
- **Estado del nodo** (`monitoring.ts:36-52`): promedia el déficit de las últimas 3 semanas y lo divide por el σ de la ventana de entrenamiento. Es *atención* si da 2σ o más y *crítico* si da 3.4σ o más (`monitoring.ts:14-18`).
- **CUSUM** (`synthetic/cusum.ts:37-59`): es **retrospectivo y estandarizado** y se aplica a los **valores crudos** de las primeras 24 semanas, no a residuos. Para cada punto de corte calcula una diferencia de medias estandarizada y toma el máximo. Sirve solo para validar que la línea base se pudo congelar sobre un historial estable (C24).

### B2. Cómo se usa la banda en el detector [VERIFICADO EN CÓDIGO]

- **La banda del sistema no es la banda CQR del modelo de ML.** Es `baseline ± t·s/√n` sobre la media recortada de las 24 semanas de entrenamiento (`synthetic/estimate-baseline.ts:30-42`), es decir, un intervalo para la estimación de la media.
- **El detector no la usa:** ni como zona muerta, ni como parámetro k de CUSUM, ni con reescalado por `n_items`, por desvío o por largo de ventana.
- **Quién la usa:** el motor de simulación, que sortea una posición dentro de la banda por réplica (`simulate.ts`, campo `baselinePosition`), y los gráficos, que la sombrean (`components/charts/weekly-performance-chart.tsx`).
- **Sobre aplicar la banda del promedio a valores semanales:** es un error de nivel. En mi medición sobre el modelo de Olist, la banda del promedio de Fase II cubre solo ~54% de las semanas individuales, no 80%. Por eso en `baseline_model_v2.ipynb` agregué una banda semanal calibrada con CQR sobre valores semanales. Esa banda semanal tampoco está en el sistema.

### B3. Valores de k y h y calibración [NO EXISTE como se plantea]

- **No hay k ni h de CUSUM tabular.** Hubo una primera versión tabular que dio 40-70% de falsas alarmas y se abandonó (`docs/ingesta-sintetica.md:148-151`).
- **Lo que hay:** un único umbral de 6.4 (`synthetic/cusum.ts:21`) y los umbrales 2σ y 3.4σ del estado de nodo (`monitoring.ts:17-18`).
- **Cómo se calibró:** Monte Carlo con 6,000 series sintéticas (`synthetic/synthetic.test.ts`, bloque "CUSUM: calibración"). Los tests solo comprueban cotas: falsas alarmas ≤ 0.5% y detección ≥ 93% a −4σ.
- **Función de costo, grilla de búsqueda y script de calibración: [NO EXISTEN]** como archivos.
- **Solapamiento entre calibración y evaluación:** la calibración y la evaluación usan el mismo generador sintético (`generate-series.ts`). La calibración es circular y no incluye datos reales.
- **RF019:** no aparece en ningún archivo del repo.
- **Estado declarado:** `docs/pendientes.md:111-114` marca el CUSUM, el umbral de 6.4, los umbrales de estado de nodo y la ventana de 24 semanas como provisorios a revisar con quien defiende la tesis.

### B4. Métricas del detector [CORRIDO AHORA, solo sobre datos sintéticos]

Script: `scripts_validacion/detector_checks.ts`, que importa las funciones del repo y las corre contra series del generador sintético del sistema. Salida: `resultados/salida_detector_checks.txt`.

**Sobre Olist real, todo es [NO EXISTE]:** falsas alarmas sobre vendedores reales sin inyección, ARL0, demora de detección, tasa de detección y episodios de degradación reales por `seller_id`.

**Verificación de estabilidad (C24), sobre 20,000 series sintéticas estables de 24 semanas:**

| Concepto | Resultado |
|---|---|
| Falsas alarmas | 34/20,000 = **0.170%** (IC95% Wilson 0.12-0.24%) |
| Cambio de nivel −4σ (semana 14) | detección 96.9% (error medio de ubicación 0.10 semanas) |
| Cambio de nivel −3σ | detección 73.6% |
| Cambio de nivel −2σ | detección 26.1% |
| Cambio de nivel −1.5σ | detección 9.9% |
| Cambio de nivel +4σ | detección 13.4% |

El umbral de 6.4 tiene una buena tasa de falsas alarmas por serie, pero casi no detecta cambios moderados ni hacia arriba. La medición confirma lo que dicen los comentarios del código (0.16% y 97%).

**Estado de nodo (déficit medio de 3 semanas, 2σ y 3.4σ), sobre 4,000 nodos sintéticos con 156 semanas de monitoreo.** La línea base y el σ se congelan con las primeras 24 semanas. Con el cambio de nivel desde la semana 1 del monitoreo:

| Escenario | Nodos que alguna vez pasan a atención o peor | Mediana de la primera atención | Crítico alguna vez (mediana) |
|---|---|---|---|
| Estable (sin incidente) | 55.4% | semana 45 | 6.4% (semana 64) |
| Cambio −1σ | 96.0% | semana 11 | 37.3% (semana 40) |
| Cambio −2σ | 100% | semana 3 | 82.4% (semana 15) |
| Cambio −3σ | 100% | semana 2 | 98.2% (semana 4) |
| Cambio −4σ | 100% | semana 2 | 100% (semana 3) |

En operación estable el 1.99% de las semanas queda marcado (el código documenta 2.3%). Con un horizonte largo, más de la mitad de los nodos estables recibe al menos una alerta. Esto equivale a un ARL0 empírico bajo; no se había calculado antes.

---

## Bloque C: Datos sintéticos

### C1. Generador de datos sintéticos (RF009) [VERIFICADO EN CÓDIGO]

Archivos en `TwinChain/src/lib/domain/synthetic/`:

- **Perfiles por tipo de nodo:** `node-profiles.ts:39-45`.
- **Generador de serie y continuación:** `generate-series.ts`.
- **Parámetros globales:** `config.ts`.
- **Generador pseudoaleatorio:** `../rng.ts` (mulberry32) y `stats.ts:34` (Box-Muller).
- **Distribución:** proceso AR(1) gaussiano alrededor del nivel del nodo, con "semanas malas" aisladas, recortado a [0, 100].
- **Semilla:** no hay una semilla global. Cada semana usa `hashSeed("week:<nodo>:<semana>")` y cada perfil usa `hashSeed("profile:<nodo>")` (FNV-1a). La serie es función pura de (nodo, semana).

**Parámetros por tipo (`node-profiles.ts:39-45`):**

| Tipo | Nivel | Volatilidad (σ) | Origen declarado |
|---|---|---|---|
| Proveedor | 90-94 | 6-8 | conceptual |
| Fabrica | 91-95 | 5-7 | conceptual |
| Almacen | 93-96 | 4-6 | conceptual |
| Vendedor | 88-92 | 8-11 | olist (provisorio, sin calibrar) |
| Cliente | 96-97 | 3-4 | conceptual |

Todos comparten persistencia AR(1) de 0.3 y probabilidad de semana mala de 3%, con profundidad de 1.5 a 3σ.

**Degradación inyectada (`config.ts:33-39`; `build-history.ts`):**

- **Escalón** (cambio de nivel): −4σ en el 30% de los nodos (al menos uno), en la semana 14 de las 24 de entrenamiento (`LEVEL_SHIFT_AT_FRACTION = 0.6`).
- **Rampa: [NO EXISTE].**
- **Inyección de incidentes en el monitoreo vivo: [NO EXISTE]**, figura como pendiente en `docs/pendientes.md:118`.

### C2. Usos de los datos sintéticos [VERIFICADO EN CÓDIGO]

Hoy, el desempeño semanal de todos los nodos del sistema es **100% sintético**; no se cargó ningún dato real de Olist a la aplicación.

| Uso | ¿Se usa? | Proporción sintético/real |
|---|---|---|
| Entrenar el modelo de ML | No (usa Olist real) | — |
| Calibrar el umbral de CUSUM y los umbrales de estado | Sí | 100% sintético |
| Probar el detector | Sí (`synthetic.test.ts`, `monitoring.test.ts`) | 100% sintético |
| Alimentar la simulación | Sí (`desempeno_semanal`) | 100% sintético |
| Demos de la interfaz | Sí (`TwinChain/scripts/seed-data.ts:89`) | 100% sintético |
| Tests | Sí | 100% sintético |

### C3. ¿El modelo se entrena solo con datos reales? [VERIFICADO EN CÓDIGO]

- **El modelo de ML se entrena solo con datos reales de Olist**, usando `olist_orders_dataset.csv` y `olist_order_items_dataset.csv`.
- **Sí hay componentes calibrados o validados con datos que generó el propio sistema:** el umbral de 6.4, los umbrales de estado de nodo y la ventana de 24 semanas.
- **El rango del perfil `Vendedor`** (nivel 88-92, σ 8-11) está marcado como provisorio y **sin calibrar con Olist** (`node-profiles.ts:33`; `docs/pendientes.md:108-110`).

### C4. DataCo [NO EXISTE]

No hay referencias a DataCo en el repo ni en la carpeta de entrenamiento. No se usó en ningún experimento, y tampoco está declarado en los archivos que revisé.

---

## Bloque D: Interpretabilidad

### D1. Importancia de variables [CORRIDO AHORA]

Permutation importance del modelo de la mediana, en el conjunto de test, con scoring MAE, 30 repeticiones y 10 semillas. El valor es el aumento del MAE en días al permutar la variable. CSV: `resultados/D1_permutation_importance_por_semilla.csv` y `resultados/D1_permutation_importance_resumen.csv`.

| Ranking | Variable | Aumento medio del MAE (días) | Desvío entre semillas | Semillas con importancia > 0 |
|---|---|---|---|---|
| 1 | `phase1_mean` | 0.0944 | 0.0313 | 10 de 10 |
| 2 | `phase1_max` | 0.0368 | 0.0085 | 10 de 10 |
| 3 | `phase1_min` | 0.0221 | 0.0176 | 10 de 10 |
| 4 | `phase1_std` | 0.0083 | 0.0151 | 8 de 10 |
| 5 | `phase1_n_weeks` | 0.0000 | 0.0000 | 0 de 10 |
| 6 | `phase1_mean_items_per_week` | −0.0013 | 0.0043 | 5 de 10 |
| 7 | `phase1_total_items` | −0.0014 | 0.0063 | 4 de 10 |

- Las variables de nivel (media, máximo y mínimo de Fase I) concentran la información. Las de volumen no aportan: los valores negativos indican ruido.
- `phase1_n_weeks` vale siempre 4 (constante), por eso su importancia es exactamente cero.
- La media, el máximo y el mínimo están correlacionados, así que permutarlas una por una puede subestimar su aporte conjunto.
- **SHAP no se calculó:** la librería no está instalada en el entorno virtual y no instalé nada nuevo. Si se quiere SHAP, hace falta aprobar la instalación.

### D2. Qué muestra la interfaz cuando se dispara una alerta [VERIFICADO EN CÓDIGO]

| Elemento | ¿Se muestra? | Dónde |
|---|---|---|
| Semana de inicio del desvío | Sí: "cambió el comportamiento, desde {semana}" | `TwinChain/src/app/(app)/cadenas/[chainId]/page.tsx:51-70` |
| Cantidad de nodos afectados | Sí, en el tooltip del distintivo | idem |
| Déficit reciente del nodo ("déf. −X%") | Sí | `TwinChain/src/components/canvas/supply-chain-node.tsx:60-62` |
| Línea base | Sí, en el gráfico del inspector del nodo | `components/canvas/node-inspector.tsx:182` |
| Banda | Sí, sombreada en el mismo gráfico | `components/charts/weekly-performance-chart.tsx` |
| Valor real y déficit | Sí, en el mismo gráfico | idem |
| Residuo semanal como tal | No; se muestra el déficit (unilateral) | — |
| Acumulado de CUSUM | **No.** El tipo `ChainStability` no expone el estadístico (`synthetic/cusum.ts:61-67`) y el nombre CUSUM se oculta a propósito (`cadenas/[chainId]/page.tsx:50`) | — |

El rol Visualizador no puede abrir el inspector del nodo (`docs/pendientes.md:106`), así que no ve el gráfico.

---

## Bloque E: Infraestructura y seguridad

### E1. Motor de simulación [VERIFICADO EN CÓDIGO]

- **Dónde corre:** en una función serverless de Vercel, dentro del mismo request. No hay job en segundo plano. Las rutas son `POST /api/escenarios` (`TwinChain/src/app/api/escenarios/route.ts`) y `POST /api/escenarios/[scenarioId]/corridas` (`.../corridas/route.ts`). Las dispara el store de la interfaz (`src/stores/app-store.ts:492` y `:530`).
- **Límite de duración:** `maxDuration = 300` segundos (`escenarios/route.ts:15`; `corridas/route.ts:12`), el máximo del plan Hobby. `docs/rendimiento-motor.md` todavía dice 800 en su resumen, aunque su propia nota de actualización lo corrige a 300.
- **Estructura de bucles** (`src/lib/domain/simulate.ts`, función `runScenarioSimulation`):
  1. Por cada **réplica** (30), se hace una propagación de los eventos por las **aristas** (recorrido en anchura, `spreadEvents`).
  2. Dentro de cada réplica, por cada **nodo alcanzado**, se proyecta el **horizonte** semana a semana (`projectReplica`).
  3. La estimación previa de trabajo es `réplicas × (aristas recorridas + llegadas por nodo × semanas del horizonte)` (`simulate.ts:284-296`).
- **Máximos permitidos:**

| Parámetro | Máximo | Dónde |
|---|---|---|
| Nodos por cadena | 50 | `src/lib/domain/types.ts:8` |
| Réplicas | 30 (valor fijo por defecto) | `simulate.ts:52` |
| Horizonte | 52 semanas | `src/lib/validators/scenario-api.ts:15` |
| Eventos por escenario | 20 | `src/lib/validators/scenario-api.ts:18` |
| Trabajo estimado por corrida | 50 M unidades (se rechaza con HTTP 422) | `src/lib/simulation/run-scenario.ts:22` |
| Tránsito por arista | 3650 días | `src/lib/validators/chain-api.ts` |

- **Mediciones de tiempo y memoria: sí existen.** Están en `TwinChain/docs/rendimiento-motor.md` (máquina Apple M4) y `TwinChain/docs/rendimiento-motor-vercel.md` (medido en Vercel el 12/10/2026), con el script `TwinChain/scripts/bench-engine.ts`. Datos de esos documentos: en Vercel el motor es unas 3.3 veces más lento que en la M4; con 300 nodos tarda entre 0.4 y 1.3 s; el peor caso posible que admite el modelo (300 nodos todos con todos y 20 eventos) tarda 16 s; la memoria configurada es 2.05 GB. No las repetí para esta respuesta.

### E2. Autenticación [VERIFICADO EN CÓDIGO]

- **Proveedor:** solo Credentials (`TwinChain/src/auth.ts:23`). Google OAuth está declarado en `.env.example` pero no cableado (`docs/pendientes.md:92`).
- **Hash de contraseñas:** bcrypt con costo 12 (`src/app/api/registro/route.ts`; `src/auth.ts:11`). Hay un hash señuelo para que responder "el email no existe" no sea más rápido que "contraseña incorrecta". La contraseña admite hasta 72 caracteres, el límite de bcrypt (`src/lib/validators/auth.ts`).
- **Estrategia de sesión:** JWT de 14 días (`src/auth.ts:19`). El token guarda solo la identidad. Organización y rol se leen de la base en cada request (`src/lib/auth/session.ts:31-55`).
- **Flags de cookies:** el código **no los configura**. Valen los defaults de `@auth/core` 0.41.3 (`next-auth` 5.0.0-beta.32), leídos del paquete instalado (`node_modules/@auth/core/lib/utils/cookie.js`): `httpOnly: true`, `sameSite: "lax"`, y `secure` con prefijo `__Secure-` cuando hay HTTPS.
- **Dónde se verifica el rol:**
  - En las **API routes**, con `requireApiMember("permiso")` (`src/lib/auth/session.ts:95-103`); todas las rutas de negocio lo llaman.
  - En las **páginas**, con `requirePageMember` (`src/app/(app)/layout.tsx:11`).
  - La interfaz además oculta controles con `canWrite`, pero no es la única barrera.
  - No hay `middleware.ts`.
- **Gaps declarados** (`docs/pendientes.md:94-100`): no hay límite de intentos en login ni registro, ni verificación de email, ni recuperación de contraseña.

### E3. Multi-tenant [VERIFICADO EN CÓDIGO]

- **Filtro por organización:** la condición de aislamiento es `chainVisibleTo(member)` (`TwinChain/src/lib/data/access.ts:10-15`). Filtra por la `organizacionId` del miembro autenticado y por la visibilidad de la cadena (compartida, o privada del creador). La `organizacionId` sale de la sesión, nunca del body ni de la URL.
- **Quién la usa:** `findVisibleChain`, `findVisibleNode`, `findVisibleEdge` y `findVisibleScenario`, que son las que usan todas las rutas de negocio; y el snapshot de lectura (`src/lib/data/snapshot.ts:25`). Las rutas de invitaciones y de creación de cadenas usan la `organizacionId` del miembro.
- **Matiz:** no toda query filtra por `organization_id` directamente. Algunas filtran por IDs de cadenas ya autorizadas (por ejemplo `inArray(nodos.cadenaId, chainIds)` en el snapshot), lo cual es equivalente.
- **Row-Level Security: [NO EXISTE].** `TwinChain/CLAUDE.md:122` dice explícitamente que no se usa RLS. Tampoco hay políticas en `TwinChain/drizzle/0000_small_marrow.sql`.

### E4. Proveedor de base de datos y cifrado [NO VERIFICADO]

- **Proveedor [VERIFICADO EN CÓDIGO]:** Neon (PostgreSQL) con Drizzle ORM. La región es `sa-east-1` según `docs/rendimiento-motor-vercel.md`. La función corre en `gru1` (`TwinChain/vercel.json`).
- **En tránsito:** `TwinChain/.env.example` usa `sslmode=require` en las cadenas de conexión, así que el repo exige TLS. Lo que garantiza Neon del lado servidor no lo verifiqué.
- **En reposo:** lo que declara la documentación de Neon sobre cifrado en reposo **no lo sé con certeza y hay que verificarlo** en su documentación oficial. No lo busqué.

### E5. Eliminación de cuenta y borrado en cascada [VERIFICADO EN CÓDIGO]

- **Eliminar la cuenta de un usuario y sus datos: [NO EXISTE]** (`docs/pendientes.md:99`: "borrar la cuenta").
- **Sí existe** eliminar una cadena: `DELETE /api/cadenas/[chainId]` (`src/app/api/cadenas/[chainId]/route.ts`). Arrastra por cascada nodos, aristas, desempeño semanal, escenarios, eventos y resultados.
- **Reglas de borrado del esquema** (`TwinChain/src/lib/db/schema.ts`):

| Relación | Regla |
|---|---|
| `cadenas.organizacion_id` → organizaciones | CASCADE |
| `invitaciones.organizacion_id` → organizaciones | CASCADE |
| `invitaciones.invitada_por` → usuarios | CASCADE |
| `nodos.cadena_id` → cadenas | CASCADE |
| `aristas` (origen y destino) → nodos | CASCADE |
| `desempeno_semanal.nodo_id` → nodos | CASCADE |
| `escenarios.cadena_id` → cadenas | CASCADE |
| `eventos.nodo_id` y `eventos.escenario_id` | CASCADE |
| `resultados.escenario_id` → escenarios | CASCADE |
| `usuarios.organizacion_id` → organizaciones | **RESTRICT** |
| `usuarios.rol_id` → roles_usuario | **RESTRICT** |
| `invitaciones.rol_id` → roles_usuario | **RESTRICT** |
| `cadenas.creada_por` → usuarios | **RESTRICT** |
| `escenarios.usuario_id` → usuarios | **RESTRICT** |

**Consecuencia:** si se implementara el borrado de una cuenta, un usuario que creó cadenas o escenarios no se podría borrar sin decidir antes qué pasa con ellos. Eso hay que diseñarlo. Borrar una organización tampoco funciona mientras tenga usuarios.

### E6. Dónde vive la línea base y cómo se evita recalcularla (RF014) [VERIFICADO EN CÓDIGO]

- **Dónde se almacena:** en `desempeno_semanal.linea_base`, `banda_inferior` y `banda_superior` (`TwinChain/src/lib/db/schema.ts`), una copia en cada fila semanal de cada nodo. Se estima una sola vez, sobre las 24 semanas de entrenamiento, al cargar el historial (`src/lib/ingestion/ingest-history.ts`; `src/lib/domain/synthetic/build-history.ts:50-58`).
- **Cómo se congela:** el avance semanal copia los valores de la última fila registrada y nunca los recalcula (`src/app/api/cadenas/[chainId]/avance/route.ts:77-78`; `src/lib/domain/synthetic/advance.ts:3`). El único otro punto que inserta en esa tabla es la ingesta inicial.
- **Garantía:** es solo una convención de código, más tests (`synthetic.test.ts`). No hay trigger ni restricción en la base que impida modificar esas columnas.
- **Reentrenamiento:** no existe en el sistema. Mi `training model/api.py` calcula la predicción en cada llamada y no escribe en la base.

---

## Decisión pendiente

Las preguntas B1 a B4 presuponen un detector que no está implementado en el repo. Para la respuesta académica hay tres caminos:

1. **Describir el detector que sí existe:** estimador provisorio, verificación de estabilidad C24 y estado de nodo por déficit en σ.
2. **Implementar el detector que se describió:** CUSUM semanal sobre residuos, con la banda del modelo de ML.
3. **Aclarar qué parte es diseño futuro** y qué parte está implementada.

## Archivos generados

En `training model/scripts_validacion/`:

- `validacion_modelo.py` y `detector_checks.ts`: los scripts.
- `resultados/`: CSV de A1, A2, A4, A5 y D1, más `salida_validacion_modelo.txt` y `salida_detector_checks.txt`.
