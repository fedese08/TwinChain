@AGENTS.md

# TwinChain — contexto persistente del proyecto

Plataforma web de monitoreo y simulación de disrupciones en cadenas de suministro.
Trabajo Final de Ingeniería. `docs/TwinChain-DEV.md` es la fuente de verdad **funcional/de proceso**.
`docs/modelo-datos.md` es la fuente de verdad **estructural** — manda sobre el mockup visual y sobre este archivo
en todo lo que choque. Leer ambos antes de tocar modelos, tipos o pantallas de simulación/resultado.

## Dos capas de análisis (no confundirlas)

1. **Monitoreo Digital Twin** — desempeño semanal real vs. línea base por nodo (`DesempenoSemanal`), medido a partir
   de datos de **sensores simulados** para todos los tipos de nodo (generador por perfil de tipo, calibrado con Olist); el modelo de ML, entrenado con Olist, estima la línea base y las bandas de cada nodo a partir de ese historial.
2. **Simulación hipotética** — un `Escenario` (fork conceptual, no altera la cadena viva) agrupa uno o más `Evento`
   (disrupciones) sobre nodos de una cadena, y produce un `Resultado` con una `tabla_k` (costo de reconfigurar en
   semanas malas equivalentes ↔ umbral de reconfiguración). El ML **no** corre sobre simulaciones.

## El modelo de datos real (`docs/modelo-datos.md`) — manda sobre cualquier mockup

- **5 tipos de nodo**: `Proveedor`, `Fabrica`, `Almacen`, `Vendedor`, `Cliente` (valores del discriminador en
  español, tal como los define el modelo). `Vendedor` = `seller_id` de Olist, el único con datos reales.
- El tránsito **no** es un nodo — es propiedad de la arista, y la arista **solo tiene `tiempo_transito`**. Sin
  costo, sin capacidad, sin modo de transporte: **no hay ninguna magnitud monetaria en ningún punto del sistema**.
- **Evento** (no "perturbación con mecanismos fijos"): `tipo` es una lista abierta ("corte", "huelga", "demora", ...),
  `magnitud` (% de caída), `fecha_inicio`, `nodo_id`. **Nunca lleva duración** — la duración es la incógnita que el
  sistema resuelve, no un dato de entrada.
- **Un Escenario afecta un único nodo, pero puede tener varios Eventos sobre él** (RF del usuario). No es "una
  perturbación por simulación" — se le pueden acumular varios eventos al mismo nodo. `nodo_id` sigue viviendo en
  Evento (no en Escenario): el modelo soporta multi-nodo, la restricción se valida en la app, así que habilitar C29
  más adelante no requiere migrar nada.
- **Resultado** = `tabla_k`: array de `{k, umbral}` (k = costo de reconfigurar en semanas malas equivalentes). No
  hay costo total, nivel de servicio % ni TTR como tales — esos conceptos vienen del mockup viejo y ya no aplican.
- **DesempenoSemanal**: `valor_real`, `linea_base` (ML, congelada), `deficit = max(linea_base - valor_real, 0)`,
  nunca negativo.
- Multi-tenant: cadenas pertenecen a la organización. Límite de 50 nodos por cadena. 3 plantillas (lineal 5,
  bifurcada 10, compleja 20+). Un nodo debe desconectarse antes de eliminarse. Sin versionado, sin exportación, sin
  notificaciones externas.
- **Alertas ML** (probabilidad de backorder por umbral) y **Sugerencias** (heurísticas de grafo) del spec funcional
  original **no tienen entidad en el modelo de datos real** — no implementadas todavía; quedan para cuando se
  aborde el microservicio ML (Fase 5/6) y haya que definirlas explícitamente contra el modelo real, no inventarlas.

## Idioma

Interfaz en español. Nomenclatura técnica (variables, funciones, tipos) en inglés — con la excepción deliberada de
los **valores** del discriminador `nodeType` (`"Proveedor"`, `"Fabrica"`, etc.), que se mantienen en español porque
el modelo de datos los define como el discriminador literal de la tabla `nodos`. Comentarios y docs en español.

## Base de datos: PostgreSQL, no MongoDB

Cambio de decisión del usuario — el modelo de datos se pensó originalmente para MongoDB, pero la base real es
**PostgreSQL** (ORM: Drizzle, hosting: **Neon** — confirmado; Supabase se evaluó y se descartó porque la app no
usa nada de lo que Supabase suma sobre Postgres: Auth, RLS, Storage, Realtime). `docs/modelo-datos.md` ya tiene los tipos traducidos (UUID en vez de ObjectId, FK
reales, Nodo como herencia de tabla única en vez de patrón de discriminadores de Mongo, `tabla_k` como JSONB) — ver
su sección "Migración de motor: MongoDB → PostgreSQL". El modelo conceptual (entidades, atributos, relaciones) no
cambió en nada, solo la implementación.

## Archivos de diseño

- `TwinChain.dc.html` — v1, histórico, no alinear.
- `TwinChain v2.dc.html` — guía de UX/UI (layout, tipografía, paleta), **no** de contenido de datos: sus pantallas de
  dashboard/resumen ejecutivo/comparación asumían costo/servicio/TTR/duración-configurable, que el modelo de datos
  real contradice. Ver tabla de reconciliación al final de `docs/modelo-datos.md`.

## Pendientes y mejoras futuras

**Leer `docs/pendientes.md` al retomar trabajo** y **agregarle** cualquier corrección o mejora que se detecte y no se
resuelva en el momento (con contexto para retomarla en frío). Ahí están, entre otros, los dos bugs metodológicos del
motor que NO se parchean por cuenta propia y el hallazgo de que las curvas del resultado se recalculan con la cadena
actual y no con la de la corrida.

## Estado de avance

- **Backend real (rama `feat/backend`, en curso).** Mongoose/Mongo ya se eliminó. Estado por paso:
  1. **Fundación — hecho.** `src/lib/db/schema.ts` (Drizzle, 11 tablas, derivado de `docs/modelo-datos.md`; las
     columnas que el modelo formal no tiene están marcadas `app:` — visibilidad/creador de cadena, etiqueta y
     posición de nodo, nombre de escenario, tabla `invitaciones`), migraciones en `drizzle/`, cliente en
     `src/lib/db/index.ts` (`getDb()`, lazy, `prepare:false` por el pooler de Neon), `scripts/seed.ts` (data demo
     idempotente). Scripts: `db:generate`, `db:migrate`, `db:seed`, `db:studio`.
  2. **Auth + organizaciones — hecho y verificado contra Neon.** Auth.js v5, solo credentials
     (Google se suma después), JWT. Registro como `organizacion` (crea org + Administrador) o `empleado` (sin org
     hasta aceptar una invitación). Invitaciones por link con token (solo se guarda su SHA-256) y sin proveedor de
     email todavía: el admin copia el link.
  3. **Cadenas, nodos y aristas — hecho y verificado (37 checks de API + UI).** El layout `(app)` arma un
     **snapshot** de la organización con `loadSnapshot()` (`src/lib/data/snapshot.ts`: cadenas visibles, nodos, aristas,
     desempeño semanal, escenarios, eventos y corridas — **todas las lecturas ya salen de la base**) y `StoreSync`
     lo vuelca en `src/stores/app-store.ts` (zustand). El store es una **copia de trabajo**, no la fuente de verdad:
     cada acción cambia lo local al instante y persiste por API (`/api/cadenas`, `/api/cadenas/[id]/nodos`,
     `/api/nodos/[id]`, `/api/aristas[/id]`) por **una única cola ordenada**, con **rollback + toast** si el
     servidor rechaza. Los cambios que se tipean (label, capacidades, tránsito) se agrupan con debounce de 450 ms.
     Los ids de nodo/arista los genera el cliente (`crypto.randomUUID()`) para que el optimista coincida con la base.
  4. **Desempeño semanal** — la lectura ya sale de la base (viene en el snapshot); no hay escritura todavía
     (datos de demo por seed; la ingesta real es de una fase posterior).
  5. **Escenarios + simulación — hecho y verificado (29 checks de API + UI).** `POST /api/escenarios` crea el
     escenario con sus eventos y **corre la simulación en el servidor** (`src/lib/simulation/run-scenario.ts` arma las
     entradas desde la base y llama a `runScenarioSimulation` **tal cual**), todo en una transacción: o quedan
     escenario, eventos y primera corrida, o nada. `POST /api/escenarios/[id]/corridas` agrega una corrida nueva
     (con o sin escalón de reconfiguración) **sin pisar las anteriores** (RF030). La `semilla` de cada corrida sale
     del id de la propia corrida (`hashSeed`), así que se reproduce **exacta** con semilla + réplicas: es lo que hace
     la pantalla de resultado al reconstruir las curvas. Es **síncrono** (30 réplicas tardan milisegundos): cuando
     el motor pase a 200-300 réplicas hay que mover la corrida a un job real (`after()` / cola) — ver C36. El cliente
     genera los ids del escenario y de sus eventos para mostrarlo al instante y que la pantalla de resultado siga
     con su animación de espera mientras el servidor corre. Exige el permiso `scenario:run`. `DELETE /api/escenarios/[id]`
     elimina la simulación con sus eventos y TODAS sus corridas (cascade); la UI pide confirmación (listado y resultado).
     Borrar una cadena también se lleva sus simulaciones (`DELETE /api/cadenas/[id]`).
  6. **Retirar el mock — hecho.** No queda ningún dato de mentira en la app: `src/lib/mock/` pasó a `src/lib/domain/`
     (tipos de la UI, motor, fechas, plantillas) y el generador de datos demo vive en `scripts/seed-data.ts` (solo lo
     usa `db:seed`).
  7. **Ingesta sintética + monitoreo vivo — hecho.** El desempeño semanal de los nodos ya no sale solo del seed:
     `src/lib/ingestion/ingest-history.ts` (pipeline de ingesta, contenedor C4) lo genera al **crear una cadena** y
     al **agregar un nodo**, en la misma transacción. Núcleo puro en `src/lib/domain/synthetic/` (perfiles por tipo,
     generador AR(1) determinístico por (nodo, semana), estimador de línea base, CUSUM, avance semanal) y estado
     operativo en `src/lib/domain/monitoring.ts`. **Leer `docs/ingesta-sintetica.md` antes de tocarlo**: tiene los
     parámetros, cómo se calibraron y qué es provisorio. Reglas que no se rompen: la línea base se estima **solo**
     del historial del propio nodo (RF017) y queda **congelada** (el avance la copia, nunca la recalcula); capacidades
     y stock no entran en ninguna fórmula; el historial es de 28 semanas y las primeras 24 son la ventana de
     entrenamiento. `POST/DELETE /api/cadenas/[id]/avance` es el monitoreo vivo (un tick = una semana; el reloj lo
     maneja el navegador porque Vercel no sostiene un proceso). `scripts/backfill-history.ts` completa cadenas ya
     existentes (simulacro por defecto, escribe solo con `--apply`).
  8. **Modelo de ML (`twinchain-ml/`) — estima la línea base y las bandas de TODOS los nodos a partir del historial que
     reporta su sensor.** La arquitectura objetivo: cada nodo tendría sensores IoT que le dan su historial; el modelo,
     entrenado con Olist, estima de las primeras semanas del nodo su línea base y sus bandas, **sin saber de dónde
     vienen los datos**. Como no hay sensores reales, el generador de `lib/domain/synthetic` los **simula** (RF009) — y
     solo eso: no conoce al modelo. Flujo: el generador emite el desempeño en **días de margen de despacho**
     (`margin_days`, la métrica del modelo) y el volumen semanal; `prepareSensorBaselines`
     (`ingestion/vendedor-setup.ts`) le pasa al modelo las **4 primeras semanas** (Fase I) del nodo ANTES de la
     transacción y recibe línea base + banda del promedio + banda semanal; esa línea base queda congelada (RF014). Si el
     servicio no contesta en 10 s, queda la **provisoria** (media de la Fase I ± IC 90 %), marcada en `fuente_linea_base`
     (`ml` | `provisoria`) y actualizable con `POST /api/cadenas/[id]/linea-base`. **`fuente_linea_base` es también la
     marca de que el nodo mide en días**: los nodos anteriores (null) siguen en 0–100 (`unitOfNode`,
     `src/lib/domain/units.ts`). **Todo lo que llame al motor pasa las filas por `adaptForEngine`** (escala cada nodo
     en días a línea base = 100; identidad si no hay nodos en días) — no llamar a `runScenarioSimulation` con filas
     crudas. Detección: banda semanal del modelo (2 de las últimas 3 semanas por debajo = atención, 3 = crítico) y C24
     (CUSUM) sobre la ventana de 24 semanas. Medido en `scripts/measure-sensor-model.ts` (ver `docs/modelo-ml.md`, sección 8):
     el modelo supera al método ingenuo pero **subestima el nivel ~0,45 d**, y la banda semanal **detecta mal las caídas
     chicas** (−2 d: 24 % llega a atención). El camino de Vendedor con vendedor REAL de Olist sigue en el código, inactivo
     (`REAL_VENDEDORES_ENABLED = false`, `src/lib/domain/vendedor/config.ts`). El modelo no es el clasificador de backorder
     de `TwinChain-DEV.md`. Variables: `ML_SERVICE_URL`, `ML_API_KEY` (opcionales: sin ellas todo queda provisorio). El
     bundle `.joblib` es un pickle de scikit-learn **1.9.1 exacto**: no actualizar la versión.
  - **Reglas del backend (no romper):** (a) la sesión JWT guarda **solo la identidad**; organización y rol se leen
    de la base en cada request (`getCurrentUser` en `src/lib/auth/session.ts`). (b) toda query de negocio filtra por
    el `organizacionId` que devuelve `requireApiMember()` / `requirePageMember()` — **nunca** por uno que venga en
    el body o la URL; ese es todo el aislamiento multi-tenant (no se usa RLS). (c) lecturas en Server Components
    (el snapshot del layout), escrituras en API Routes bajo `src/app/api/`. Toda ruta de cadenas/nodos/aristas
    resuelve el acceso con `findVisibleChain/Node/Edge` (`src/lib/data/access.ts`): organización de la sesión +
    cadena compartida o privada propia; lo ajeno responde 404, no 403. Escribir exige el permiso `chain:write` (el
    Visualizador ve el canvas en modo solo lectura). Un nodo usado por una simulación no se puede borrar. (d) un usuario es miembro de **una** organización con un rol, o de
    ninguna (CHECK en `usuarios`). (e) aceptar una invitación exige token **y** que el email de la cuenta coincida,
    porque todavía no se verifica el email al registrarse. (f) contraseñas: bcryptjs, máx. 72 caracteres.
  - **Variables de entorno** (`.env.local`, ver `.env.example`): `DATABASE_URL` (pooler de Neon, runtime),
    `DIRECT_URL` (conexión directa, migraciones y seed), `AUTH_SECRET`.
  - Las decisiones metodológicas del motor (`tabla_k` invertida, `MIN_PROPAGATED_MAGNITUDE`) **no** se tocan al
    migrar `simulate.ts` al servidor: se mueve tal cual.
- **Frontend: completo para el recorrido principal, incluida edición de atributos y propagación por el grafo.** Se
  construyó primero con datos mock y hoy corre contra la base (ver los pasos del backend arriba): `src/lib/domain/`
  (tipos + motor de simulación placeholder) y `src/stores/app-store.ts` (zustand). Pantallas:
  - `/cadenas` — listado + `/cadenas/nueva` (nombre, visibilidad, plantilla lineal/bifurcada/compleja).
  - `/cadenas/[id]` — canvas React Flow (5 tipos de nodo, aristas con `tiempo_transito`), modo "Diseño y monitoreo"
    (paleta, inspector de nodo con desempeño semanal + edición de label/capacidad, inspector de arista con
    tiempo_transito editable) y modo "Simulación" (`ChainCanvas mode="select"`: el grafo se sigue viendo y cada
    click en un nodo lo fija como el nodo afectado del escenario, y volver a clickearlo lo deselecciona —
    `ScenarioForm` expone `selectNode` vía ref).
  - `/cadenas/[id]/escenarios` y `/escenarios/[scenarioId]` — listado y resultado: tabla_k, déficit proyectado por
    nodo (directos y propagados), y la "red fork" (`ChainCanvas mode="display"`) coloreando cada nodo/arista según
    severidad (severo/moderado/sin efecto) con un slider de semana para ver cómo avanza la propagación.
  - `/cadenas/[id]/escenarios/[scenarioId]` tiene dos vistas: **"Respuesta"** (veredicto de impacto, decisión
    interactiva de reconfigurar según el costo k que asume el usuario, y la red de propagación) y **"Detalle
    técnico"** (ficha de la corrida con réplicas/semilla, corridas guardadas, eventos, tabla_k completa y los
    gráficos por nodo). Toda la jerga metodológica vive en la segunda; la primera no la menciona.
  - **La recomendación NO sale de `tabla_k`** — sale de comparar la pérdida evitable contra k directamente. Motivo:
    la fórmula actual de `computeReplicaThresholds` está **invertida** (el umbral baja cuando k sube, así que
    "cuanto más caro reconfigurar, más conviene"), y el "no existe umbral" de los k altos se dispara porque el
    umbral se hace muy chico, no porque el costo sea inalcanzable. Está marcado con ⚠️ en `simulate.ts`. **Definir
    bien el umbral es metodología de la tesis** — no parchearlo por cuenta propia.
  - **`MIN_PROPAGATED_MAGNITUDE` (piso de propagación) corta la dispersión con magnitudes bajas y realistas.**
    Cada salto multiplica por `PROPAGATION_FRACTION` (0.45–0.65) antes de comparar contra el piso (3), así que un
    evento de ~1–4% de magnitud nunca llega ni al primer vecino — queda encerrado en el nodo de origen, sin
    importar cuán conectada esté la red. Marcado con ⚠️ en `simulate.ts`. Detectado en una demo (magnitud 1% no se
    dispersaba); mientras no se recalibre, usar magnitudes de al menos ~15–20% para que la propagación se vea.
  - `/comparar` — comparación de 2+ escenarios (tabla_k lado a lado, mediana + rango, última corrida de cada uno).
  - `/biblioteca` — referencia de tipos de nodo/arista/plantillas.
  - `src/lib/domain/simulate.ts` es **explícitamente un placeholder** (comentado como MOCK) — no es la propuesta
    metodológica de la tesis. Su API es `runScenarioSimulation(...)`: corre N réplicas (default 30) y devuelve
    `projectionByNode` (mediana + rango por semana), `totalDeficit` y `kTable`. Internamente hace BFS aguas abajo
    por las Aristas trasladando una fracción del déficit por salto y retrasando el onset según `tiempo_transito`.
    El BFS **poda las llegadas dominadas** (mismo nodo y evento, llegada más tardía, magnitud menor o igual, saltos
    mayores o iguales). Sin eso el costo crecía con la cantidad de caminos y una red de 26 nodos muy conectados
    colgaba el motor. **No reemplazarla por un "visitados" plano: cambia resultados** (se probó, 135/600 casos).
    Cualquier cambio de rendimiento del motor se valida con `npx tsx scripts/verify-engine-equivalence.ts` (compara
    bit a bit contra una versión de git) y se mide con `scripts/bench-engine.ts` — ver `docs/rendimiento-motor.md`.
    Las rutas de simulación rechazan con 422 una corrida cuyo trabajo estimado supere `MAX_SIMULATION_WORK`.
    **Despliegue (Vercel, plan Hobby):** `maxDuration = 300` (máximo de Hobby; con 800 el build falla) y las
    funciones corren en `gru1` por `vercel.json`, junto a Neon (`sa-east-1`). No sacar el `vercel.json`: en `iad1`
    cada simulación sumaba ~3,3 s de espera a la base. El motor en Vercel es ~3,3× más lento que en un M4. Mediciones
    en `docs/rendimiento-motor-vercel.md`.
  - `ChainCanvas` tiene tres modos (`edit`/`select`/`display`) en vez de un `readOnly` booleano — ver
    `src/components/canvas/chain-canvas.tsx`.
- **RF corregidos de la bitácora, ya implementados en el mock** (no son "placeholder libre": el cálculo es de
  mentira, pero la *forma* del resultado respeta las decisiones cerradas):
  - **RF012** — `WeeklyPerformance` lleva `baselineLowerBand`/`baselineUpperBand`; los gráficos la sombrean.
  - **RF023 / C36** — cada corrida barre 30 réplicas variando la posición dentro de esa banda y la fracción de
    propagación. En producción la recomendación registrada es 200-300, todavía sin confirmar.
  - **RF027** — la fracción trasladada por arista no es fija: se barre en el rango 0.45–0.65 entre réplicas.
  - **RF029** — `KTableRow` es `{k, thresholdMedian, thresholdLow, thresholdHigh}`. Nunca un valor puntual.
  - **RF030** — `rerunScenario` agrega una fila de `ScenarioResult` sin pisar las anteriores; la pantalla de
    resultado tiene selector de corridas. Cada corrida guarda `seed` y `replications` para poder reproducirla.
  - **RF022 / C23** — la reconfiguración es un **escalón**: desde `reconfigurationWeekIndex` el déficit cae a cero
    de un salto. Es el **único** mecanismo de salida: el déficit no se corrige solo, se sostiene hasta el fin del
    horizonte. El motor tuvo una rampa de recuperación automática (`RECOVERY_SPAN_WEEKS`) y se sacó a propósito
    porque equivalía a hardcodear la duración de la disrupción — ver `docs/duracion-de-la-disrupcion.md`, **no
    volver a agregarla**. El escalón viaja aguas abajo con el retraso de tránsito de cada nodo.
  - **C36 (ejecución en background)** sigue simulado como estado de runtime en el store (`pendingRuns`). **C24
    (CUSUM) ya es real**: el veredicto se **deriva** de las filas de desempeño (`deriveChainStability` en
    `domain/synthetic/cusum.ts`, hook `useChainStatuses`) y no se guarda. Ninguno de los dos es una entidad del
    modelo de datos ni debe convertirse en tabla: el job y el pipeline son contenedores de la arquitectura C4.
    Cuando exista el job real, `pendingRuns` lo reemplaza el job de Vercel.
  - **Tests:** Vitest (`npm test`, 92) y, para el servicio de ML, pytest (`cd twinchain-ml && .venv/bin/pytest`, 22). Los de la ingesta sintética y el estado operativo incluyen las
    calibraciones de Monte Carlo del CUSUM y de los umbrales de atención/crítico: **no relajarlos para que
    pasen**, si fallan es que cambió algo que afecta la tasa de falsas alarmas.
- **`ChainCanvas` necesita un padre con altura.** Su raíz es `flex h-full min-h-0 flex-1`: dentro de un padre
  flex toma `flex-1`, y dentro de una caja de alto fijo (la red fork del resultado) toma `h-full`. Si el padre es
  `block` **y** se le saca el `h-full`, el canvas colapsa a 0 de alto y no se ve nada.
- **Nota de entorno (no de la app):** en este sandbox de verificación el Browser pane no compone/pinta frames, y se
  comprobó que **`requestAnimationFrame` y `ResizeObserver` nunca disparan** ahí. React Flow depende del
  ResizeObserver para medir los nodos, así que en el pane los nodos quedan con `measured: {}` y sin `handleBounds`
  — y `getEdgePosition` devuelve `null`, con lo cual `EdgeWrapper` renderiza `null` y **no se dibuja ninguna arista,
  ni corre `fitView`** (`fitViewQueued` queda en `true`). Se verificó que los datos que llegan a `<ReactFlow>` son
  correctos (10/10 aristas con source/target válidos contra los 9 nodos) y que el layout sí se calcula
  (`getBoundingClientRect` da medidas reales). Confirmar el renderizado visual de aristas y el `fitView` en un
  browser real la primera vez que se toque este código. **Los gráficos de Recharts sufren lo mismo**: los `path`
  se generan con geometría correcta en el DOM pero el pane no los pinta, así que una captura del pane muestra ejes
  sin curvas. No es un bug de la app — verificar en un browser real.
- Próximo paso del backend: el 3 (cadenas, nodos y aristas contra la DB), manteniendo las pantallas ya construidas.
