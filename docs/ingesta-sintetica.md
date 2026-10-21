# Ingesta sintética de desempeño de los nodos

Referencia de cómo se generan los datos de desempeño semanal de cada nodo, por qué se hizo así y qué es provisorio.
Implementa el plan de `docs/plan-simulacion-nodos.md` (las desviaciones respecto del plan están al final).

Alcance: la ingesta sintética es la decisión 12 / RF009 de la bitácora (los sensores IoT reales son la arquitectura
objetivo; el generador sintético es una nota de alcance de la demo). Alimenta la **capa 1** del proyecto, el
monitoreo Digital Twin, y le da a la **capa 2** (simulación) los datos sobre los que trabaja.

## Qué problema resuelve

Antes, solo `scripts/seed.ts` escribía `desempeno_semanal`, y solo para los 14 nodos de la organización demo. Una
cadena creada por un usuario nacía sin datos, y el motor de simulación saltea los nodos sin historial: una
simulación sobre una cadena nueva daba cero nodos alcanzados y cero déficit. Además la línea base se declaraba en
vez de estimarse, y la verificación de estabilidad (C24) decidía con `hash(idCadena) % 4`.

## Arquitectura

```
src/lib/domain/synthetic/   funciones PURAS (sin base de datos), con tests
  node-profiles.ts            1. perfil por tipo de nodo
  generate-series.ts          2. generador de la serie + continuación (avance)
  estimate-baseline.ts        3. línea base y banda (provisorio: reemplaza al ML)
  cusum.ts                    4. CUSUM (C24) y veredicto derivado de la cadena
  build-history.ts              orquestación: nodos → filas + veredicto
  advance.ts                  6. avance semanal
src/lib/domain/monitoring.ts  estado operativo de nodo y cadena
src/lib/ingestion/            5. pipeline de ingesta: la única parte que toca la base
src/app/api/cadenas/...       POST /api/cadenas, POST .../nodos, POST/DELETE .../avance
```

Todo el núcleo es una función pura de sus entradas. La base solo entra en `ingest-history.ts` y en la ruta de
avance, y quien llama pasa su propia transacción: o queda la cadena completa y con datos, o no queda nada.

## Reglas del modelo que se respetan

| Regla | Cómo |
|---|---|
| **RF017**: la línea base sale solo del historial del propio nodo | `estimateBaseline` recibe únicamente la serie del nodo; un test verifica que el historial de un nodo es idéntico con o sin otros nodos en la cadena |
| Línea base **congelada** | Se estima una vez sobre la ventana de entrenamiento y se copia a toda la serie; el avance la copia de lo registrado. Verificado en la base: una sola línea base distinta por nodo |
| **RF012**: banda de incertidumbre | Cada fila lleva `banda_inferior` y `banda_superior` |
| `deficit = max(línea_base − valor_real, 0)` | `buildRows` y `advanceNode`; la base además lo exige con un `CHECK` |
| Capacidades y stock no son insumo (RF027) | Ni los perfiles ni la serie los leen |
| `StabilityCheck` no es una entidad | El veredicto se **deriva** de las filas (`deriveChainStability`) y no se guarda |
| Multi-tenant | Las rutas filtran por la organización de la sesión (`findVisibleChain`) y exigen `chain:write` |

## Los scripts

### 1. Perfiles por tipo (`node-profiles.ts`)

Cada nodo toma su personalidad de un rango de su tipo, sorteada con una semilla derivada de su propio id: es
reproducible y no hay ids escritos a mano. Valores en puntos porcentuales del desempeño semanal (0–100).

| Tipo | Nivel medio | Volatilidad (σ) | Origen |
|---|---|---|---|
| Proveedor | 90–94 | 6–8 | conceptual |
| Fabrica | 91–95 | 5–7 | conceptual |
| Almacen | 93–96 | 4–6 | conceptual |
| **Vendedor** | 88–92 | 8–11 | **provisorio: a calibrar con Olist** |
| Cliente | 96–97 | 3–4 | conceptual |

Todos con persistencia semanal 0,3 y 3 % de probabilidad de una "semana mala" (caída aislada de 1,5 a 3 σ).

### 2. Generador de serie (`generate-series.ts`)

Proceso AR(1) alrededor del nivel del nodo, más semanas malas, recortado a [0, 100]. El ruido de cada semana sale de
un generador sembrado con `(nodo, semana)`: **la serie es función pura de esos dos datos**, sin estado oculto. Eso
permite continuarla semanas después sin guardar ninguna semilla.

- **Cambio de nivel opcional** (`levelShift`): desde una semana, el nivel del nodo se corre N σ. Existe para poder
  mostrar la alerta de C24.
- **Continuación (`continueSeries`)**, el avance del monitoreo vivo: cada semana nueva se calcula solo de lo ya
  registrado, así que el resultado **no depende de cómo se parta el avance**. La serie está **anclada** al nivel del
  nodo (el del perfil) o, si el CUSUM detectó un cambio de nivel en su entrenamiento, al nivel posterior al cambio.

### 3. Estimador de línea base (`estimate-baseline.ts`) — provisorio

Línea base = media recortada (10 % por lado) de la ventana de entrenamiento. Banda = intervalo de confianza del 90 %
de esa media (`±t·s/√n`): la incertidumbre de la **estimación**, que es lo que las réplicas de C36 barren. Reemplaza
al microservicio de ML (Fase 5): la firma queda estable para enchufar el ML real.

### 4. CUSUM (`cusum.ts`) — provisorio

CUSUM retrospectivo estandarizado: para cada punto de corte posible compara el nivel de antes con el de después y
toma el corte más marcado. σ sale de la variación **dentro** de cada tramo, así que el propio cambio de nivel no la
infla. Si el estadístico supera 6,4 hay alarma, y el corte marca la semana del cambio.

- **Veredicto de la cadena:** en alerta si **algún** nodo cambió de nivel. Solo mira la ventana de entrenamiento: C24
  valida que la línea base se haya podido congelar sobre un historial estable.
- **Calibración** (Monte Carlo contra el generador real, 20.000 series de los cinco tipos, 24 semanas):

| Qué | Resultado |
|---|---|
| Falsas alarmas por nodo, umbral 6,4 | **0,16 %** (objetivo ≤ 0,2 %) |
| Detección de una caída de −4 σ a mitad del entrenamiento | **97 %**, con la semana ubicada a ±0,1 |
| Detección de una caída de −3,5 σ | 89 % |
| Detección de una **suba** de +3,5 σ | 13 % — la escala se corta en 100 %, por eso el interruptor solo genera caídas |

El objetivo de 0,2 % no es caprichoso: una cadena de 50 nodos hace 50 pruebas a la vez, y con el 5 % habitual por
nodo casi toda cadena grande saldría en alerta sin motivo.

### 5. Pipeline de ingesta (`ingestion/ingest-history.ts`)

`ingestChainHistory` carga el historial de los nodos de la cadena que todavía no tienen ninguno, en lotes de 1.000
filas. `ingestNodeHistory` hace lo propio con un nodo suelto. Un nodo agregado a una cadena que ya avanzó en el
tiempo termina en la **misma semana** que el resto.

### 6. Avance semanal (`advance.ts` + `/api/cadenas/[id]/avance`)

- `POST { weeks: 1..8 }` suma esas semanas a todos los nodos. `onConflictDoNothing` sobre el índice único
  `(nodo, semana)`: dos llamadas simultáneas no duplican nada.
- `DELETE` vuelve a las 28 semanas originales. Como la serie es determinista, repetir el avance da exactamente lo mismo.
- Tope de 156 semanas por nodo (`409 max_weeks`).
- **El reloj lo maneja el navegador:** Vercel no sostiene un proceso continuo, así que no hay "ticks de 1 segundo"
  en el servidor. El control **▶ Tiempo real** pide una semana por segundo (×1, ×2 o ×4) y los nodos del canvas
  cambian de estado solos.

### Estado operativo (`monitoring.ts`)

El déficit se mide en **σ del propio nodo** y no en puntos absolutos. Con una línea base estimada, una semana floja
por puro ruido da 2–3 puntos de déficit en cualquier nodo volátil; un umbral fijo de 2 puntos habría marcado casi
todo como con problemas todo el tiempo.

| Nivel | Déficit medio de las últimas 3 semanas | Frecuencia en operación estable |
|---|---|---|
| normal | menos de 2 σ | — |
| atención | 2 σ o más | 2,3 % de las semanas por nodo |
| crítico | 3,4 σ o más | 0,13 % |

## Parámetros (`synthetic/config.ts`)

| Parámetro | Valor | Nota |
|---|---|---|
| `HISTORY_WEEKS` | 28 | Semanas de historial al cargar un nodo |
| `TRAINING_WEEKS` | 24 | Ventana de línea base y de CUSUM; las otras 4 son de monitoreo |
| `MIN_BASELINE_WEEKS` | 8 | Mínimo para estimar una línea base |
| `MAX_ADVANCE_WEEKS` | 8 | Por llamada de avance |
| `MAX_WEEKS_PER_NODE` | 156 | Tope de semanas guardadas por nodo |
| `LEVEL_SHIFT_SIGMAS` | −4 | Caída que inyecta el interruptor |
| `LEVEL_SHIFT_NODE_FRACTION` | 30 % | De los nodos, siempre al menos uno |

## Desviaciones respecto del plan, y por qué

El plan se aprobó con valores predeterminados; tres cambiaron al medir:

1. **Historial de 28 semanas (24 de entrenamiento), no 20 (16).** Con 16 semanas no se puede tener a la vez una tasa
   baja de falsas alarmas y detectar un cambio de nivel: es un límite estadístico de la ventana, no del detector.
2. **El CUSUM no es el tabular que se pensó.** La primera versión (referencia estimada con la misma ventana) dio
   **40–70 % de falsas alarmas**, no 0,2 %: con 16 puntos el σ estimado es muy ruidoso y la serie tiene
   autocorrelación (que infla el estadístico un 36 %). Se pasó al CUSUM retrospectivo estandarizado, calibrado contra
   el generador real.
3. **El avance estaba mal diseñado dos veces, y los tests lo encontraron.** Primero, el resultado dependía de cómo el
   cliente partía el avance (de a una semana o de a varias). Después, al corregirlo estimando el nivel de las últimas
   semanas, la serie derivaba como un paseo aleatorio (1,3 σ a las 52 semanas, 3 σ a las 312). La versión final está
   anclada al nivel del nodo.

Además, el plan decía que el veredicto de la cadena saldría "en la respuesta de la API y derivado". Hoy la API lo
devuelve al crear la cadena y la interfaz lo **deriva** de las filas (así sigue valiendo al recargar, al agregar
nodos y con cadenas viejas), con el mismo código en los dos lados.

## Cómo se verificó

- **34 tests** (`npm test`): determinismo, límites [0,100], déficit ≥ 0, banda que contiene la línea base, RF017,
  línea base congelada, avance idéntico partido o no, ausencia de deriva, nodo con cambio de nivel que sigue en el
  nivel nuevo, y las **calibraciones de Monte Carlo** del CUSUM y de los umbrales de estado.
- **De punta a punta** contra una base Postgres local: crear una cadena desde plantilla (con y sin el interruptor),
  agregar un nodo suelto, correr una simulación sobre la cadena nueva (antes salía vacía), y el avance, el tope, el
  reinicio y la carrera de dos llamadas simultáneas.
- `tsc`, `eslint` y `next build` limpios.

## Cómo correrlo

```bash
npm test                                                  # tests
npx tsx scripts/backfill-history.ts                       # simulacro: cuenta los nodos sin historial
npx tsx scripts/backfill-history.ts --apply               # escribe
npm run db:seed                                           # siembra la demo con el generador nuevo
```

**Cuidado:** esos scripts usan la base que digan las variables de entorno. Si `.env.local` apunta a producción,
`--apply` y `db:seed` escriben en producción. Para desarrollar se usó un Postgres local descartable con las
variables pisadas en la línea de comandos.

## Escala en días y modelo de ML (actualización)

Los nodos nuevos ya no usan la escala 0–100: el generador emite el **margen de despacho en días** (la métrica del modelo
de ML) y el volumen semanal, con perfiles por tipo calibrados con Olist (`DAYS_RANGES` en `node-profiles.ts`). La línea
base no la estima el estimador estadístico sino el **modelo de ML**, a partir de las 4 primeras semanas del nodo; el
estimador de `estimate-baseline.ts` sigue vigente solo para los nodos anteriores en 0–100. El generador sigue siendo
una fuente de datos que no conoce al modelo. Detalles y mediciones: `docs/modelo-ml.md`, sección 8.

## Sensor por envío y detección por CUSUM (actualización de octubre de 2026)

**Sensor por envío (RF009, RF010).** El simulador no genera el valor semanal del nodo: genera sus **envíos individuales**
(`synthetic/shipments.ts`). El nodo tiene un nivel semanal (proceso AR(1) con semanas malas) y cada envío es ese nivel más
un ruido propio; la ingesta **agrega por semana** (media del margen y cantidad de envíos) antes de cualquier análisis. La
variabilidad semanal que ve el sistema se reparte 50/50 entre el nivel del nodo y el ruido de los envíos, así que sigue
siendo la calibrada con Olist (`weeklyVolatility` de cada perfil; hay una prueba que lo verifica). `aggregateShipments`
agrega envíos de cualquier origen y `POST /api/cadenas/[id]/envios` los acepta de una fuente real.

**Detección (Flujo A, RF011, RF018 a RF020).** CUSUM tabular unilateral sobre el residuo semanal (`degradation.ts`), con
umbral calibrado por costo (`cusum-calibration.ts`, `scripts/calibrate-cusum.ts`). Ver `docs/modelo-ml.md`, sección 8.

