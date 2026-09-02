@AGENTS.md

# TwinChain — contexto persistente del proyecto

Plataforma web de monitoreo y simulación de disrupciones en cadenas de suministro.
Trabajo Final de Ingeniería. `docs/TwinChain-DEV.md` es la fuente de verdad **funcional/de proceso**.
`docs/modelo-datos.md` es la fuente de verdad **estructural** — manda sobre el mockup visual y sobre este archivo
en todo lo que choque. Leer ambos antes de tocar modelos, tipos o pantallas de simulación/resultado.

## Dos capas de análisis (no confundirlas)

1. **Monitoreo Digital Twin** — desempeño semanal real vs. línea base por nodo (`DesempenoSemanal`), medido a partir
   de datos reales (Olist) para nodos `Vendedor`. El resto de los tipos de nodo son conceptuales todavía.
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
**PostgreSQL** (ORM: Drizzle, hosting: Neon — ambos default provisorio, no confirmados todavía, ver
`docs/stack-tecnologico.md`). `docs/modelo-datos.md` ya tiene los tipos traducidos (UUID en vez de ObjectId, FK
reales, Nodo como herencia de tabla única en vez de patrón de discriminadores de Mongo, `tabla_k` como JSONB) — ver
su sección "Migración de motor: MongoDB → PostgreSQL". El modelo conceptual (entidades, atributos, relaciones) no
cambió en nada, solo la implementación.

## Archivos de diseño

- `TwinChain.dc.html` — v1, histórico, no alinear.
- `TwinChain v2.dc.html` — guía de UX/UI (layout, tipografía, paleta), **no** de contenido de datos: sus pantallas de
  dashboard/resumen ejecutivo/comparación asumían costo/servicio/TTR/duración-configurable, que el modelo de datos
  real contradice. Ver tabla de reconciliación al final de `docs/modelo-datos.md`.

## Estado de avance

- **Fase 0 — Setup base (backend real): completa pero doblemente desactualizada — modelo de datos viejo Y motor de
  base de datos viejo.** Next.js 15 + TS strict + Tailwind v4 + shadcn/ui, tokens visuales del diseño
  (`src/app/globals.css`) siguen vigentes. Pero `src/lib/db/connect.ts` y los modelos en `src/lib/db/models/`
  (`User`, `Organization`, `SupplyChain`) están en **Mongoose/MongoDB** — con 4 tipos de nodo y arista con
  costo/capacidad/modo (ya obsoleto frente a `docs/modelo-datos.md`) y además sobre el motor equivocado (ahora es
  PostgreSQL). Hay que tirar ese código y reescribirlo entero contra Drizzle + Postgres cuando se retome el backend.
  No tocar todavía: es trabajo de la próxima fase de backend, no de esta iteración de frontend mock. `mongoose`
  sigue en `package.json` como dependencia — se puede sacar recién cuando se instale Drizzle.
- **Frontend con datos mock (esta iteración): completo para el recorrido principal, incluida edición de atributos y
  propagación por el grafo.** Sin backend — todo vive en `src/lib/mock/` (tipos + seed + motor de simulación
  placeholder) y `src/stores/mock-db-store.ts` (zustand, estado en memoria de sesión). Pantallas:
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
  - `/comparar` — comparación de 2+ escenarios (tabla_k lado a lado, mediana + rango, última corrida de cada uno).
  - `/biblioteca` — referencia de tipos de nodo/arista/plantillas.
  - `src/lib/mock/simulate.ts` es **explícitamente un placeholder** (comentado como MOCK) — no es la propuesta
    metodológica de la tesis. Su API es `runScenarioSimulation(...)`: corre N réplicas (default 30) y devuelve
    `projectionByNode` (mediana + rango por semana), `totalDeficit` y `kTable`. Internamente hace BFS aguas abajo
    por las Aristas trasladando una fracción del déficit por salto y retrasando el onset según `tiempo_transito`.
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
  - **C36 (ejecución en background)** y **C24 (CUSUM en el pipeline de ingesta)** están simulados como estado de
    runtime en el store — `pendingRuns` y `stabilityChecks`. **No son entidades del modelo de datos** y no deben
    convertirse en tablas: el job y el pipeline son contenedores de la arquitectura C4, no filas. Cuando exista el
    backend real, `pendingRuns` lo reemplaza el job de Vercel y `stabilityChecks` el pipeline de ingesta.
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
- Próxima fase: reescribir el backend (Drizzle + PostgreSQL + Server Actions) contra `docs/modelo-datos.md`, y
  reemplazar `mock-db-store` por llamadas reales, manteniendo las pantallas ya construidas.
