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
   semanas de operar como ahora ↔ umbral de persistencia N(k), por fracción de propagación). El ML **no** corre sobre
   simulaciones. Las definiciones del motor están en `docs/definiciones-motor.md`.

## El modelo de datos real (`docs/modelo-datos.md`) — manda sobre cualquier mockup

- **5 tipos de nodo**: `Proveedor`, `Fabrica`, `Almacen`, `Vendedor`, `Cliente` (valores del discriminador en
  español, tal como los define el modelo). `Vendedor` = `seller_id` de Olist, el único con datos reales.
- El tránsito **no** es un nodo — es propiedad de la arista, y la arista **solo tiene `tiempo_transito`**. Sin
  costo, sin capacidad, sin modo de transporte: **no hay ninguna magnitud monetaria en ningún punto del sistema**.
- **Evento** (no "perturbación con mecanismos fijos"): `tipo` es una lista abierta ("corte", "huelga", "demora", ...),
  `magnitud` (% de caída), `fecha_inicio`, `nodo_id`. **Nunca lleva duración** — la duración es la incógnita que el
  sistema resuelve, no un dato de entrada.
- **Un Escenario tiene UN solo Evento** (decisión del usuario, 23/10/2026): una simulación = un evento sobre un nodo.
  `nodo_id` sigue viviendo en Evento (no en Escenario). La regla se valida en el formulario y en la API
  (`events` con `.max(1)`, `src/lib/validators/scenario.ts` y `scenario-api.ts`). El motor sigue aceptando varios
  eventos y nodos afectados (y "reconfigurar" devuelve a TODOS a su nivel normal), y los escenarios viejos con más de
  un evento se siguen mostrando; la restricción está solo en la entrada.
- **Resultado** = `tabla_k`: array de `{k, fraccion, umbral (mediana, p10, p90 o "no cruza")}` (k = costo de reconfigurar
  en semanas de operar como ahora, `K = k·d0`). No hay costo total, nivel de servicio % ni TTR como tales — esos
  conceptos vienen del mockup viejo y ya no aplican.
- **DesempenoSemanal**: `valor_real`, `linea_base` (ML, congelada), `deficit = max(linea_base - valor_real, 0)`,
  nunca negativo.
- Multi-tenant: cadenas pertenecen a la organización. **Plan de suscripción por organización** (Freemium, Pro, Max; ver
  "Planes" más abajo): los nodos y los escenarios guardados tienen tope por plan, y hay una cadena por organización. 3 plantillas (lineal 5,
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
resuelva en el momento (con contexto para retomarla en frío). Ahí están, entre otros, el hallazgo de que las curvas del
resultado se recalculan con la cadena actual y no con la de la corrida, y las decisiones del motor que siguen abiertas
(réplicas de producción, cobertura de las bandas).

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
     la pantalla de resultado al reconstruir las curvas. La corrida es un **job en segundo plano** (E90, arquitectura): el pedido valida, guarda el escenario y una fila de
     `resultados` en estado `corriendo`, responde **202** y el motor corre después con `after()` de Next.js
     (`src/lib/simulation/background-run.ts`); la pantalla consulta `GET /api/escenarios/[id]/corridas/[runId]` hasta
     `listo`. Si el job falla (o la corrida queda `corriendo` más de 6 min, función perdida) se descarta la corrida y, si
     era la primera, el escenario: o queda todo o nada. El snapshot trae las corridas `corriendo` (`runningRuns`) y el
     store retoma la espera tras una recarga. La salvaguarda de tamaño (422) se evalúa ANTES de lanzar el job. El cliente
     genera los ids del escenario y de sus eventos para mostrarlo al instante y que la pantalla de resultado siga
     con su animación de espera mientras el job corre. Exige el permiso `scenario:run`. `DELETE /api/escenarios/[id]`
     elimina la simulación con sus eventos y TODAS sus corridas (cascade); la UI pide confirmación (listado y resultado).
     Borrar una cadena también se lleva sus simulaciones (`DELETE /api/cadenas/[id]`).
  6. **Retirar el mock — hecho.** No queda ningún dato de mentira en la app: `src/lib/mock/` pasó a `src/lib/domain/`
     (tipos de la UI, motor, fechas, plantillas) y el generador de datos demo vive en `scripts/seed-data.ts` (solo lo
     usa `db:seed`).
  7. **Ingesta por envío + monitoreo vivo — hecho.** (El sensor simula **envíos individuales** — RF009 — que la ingesta agrega
     por semana — RF010 —: `synthetic/shipments.ts`. `aggregateShipments` agrega envíos de CUALQUIER origen, y
     `POST /api/cadenas/[id]/envios` acepta los de una fuente real (CSV o sensores) y los agrega igual: la fuente se
     reemplaza sin cambiar el resto.) El desempeño semanal de los nodos ya no sale solo del seed:
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
     crudas. **Detección (Flujo A del E90, `src/lib/domain/degradation.ts`)**: CUSUM tabular unilateral sobre el residuo
     semanal, `S_t = max(0, S_{t-1} + (línea base − desempeño_t) − K)` con K = el margen de la banda de incertidumbre de la
     línea base; al superar el umbral h·K se confirma la degradación sostenida y S se reinicia; las confirmaciones
     consecutivas son UNA alerta (desde cuándo, déficit acumulado: HU2). El umbral h sale de la **calibración** (RF019/RF020,
     `scripts/calibrate-cusum.ts` → `src/data/cusum-calibracion.json`): minimiza `C(h) = retardo + f·falsas alarmas` sobre
     vendedores reales de Olist con episodios inyectados, y es **configurable por cadena** (`cadenas.costo_falsa_alarma`,
     f de 0 a 3; menú Opciones → "Sensibilidad de alertas"). Los nodos anteriores (0-100) siguen con la regla por σ. C24 (CUSUM retrospectivo)
     sigue verificando la estabilidad del historial de entrenamiento. Medido en `scripts/measure-sensor-model.ts` (ver
     `docs/modelo-ml.md`, sección 8): el modelo supera al método ingenuo pero **subestima el nivel ~0,45 d**. El camino de Vendedor con vendedor REAL de Olist sigue en el código, inactivo
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
    Operador ve el canvas en modo solo lectura). Un nodo usado por una simulación no se puede borrar. (d) un usuario es miembro de **una** organización con un rol, o de
    ninguna (CHECK en `usuarios`). (e) aceptar una invitación exige token **y** que el email de la cuenta coincida,
    porque todavía no se verifica el email al registrarse. (f) contraseñas: bcryptjs, máx. 72 caracteres. (h) **consentimiento al registrarse** (Ley 25.326, art. 6): la pantalla de registro muestra la información previa y una casilla obligatoria, validada también en el servidor (`aceptaTratamiento`, `registerSchema`); el texto vive en `src/lib/legal/consent.ts` (contacto: fsena@uade.edu.ar; responsables del archivo: Facundo Guevara y Federico Sena). No se guarda la fecha de aceptación (pediría una migración). (g) **eliminar la cuenta** (`DELETE /api/cuenta`, `src/lib/data/account-deletion.ts`) exige la contraseña y borra los datos
    personales: si es la única persona de la organización se borra la organización entera; si hay más gente se borran
    sus cadenas privadas y lo de la organización pasa a otra administradora; la única administradora con más
    integrantes no puede irse (409): antes tiene que hacer administradora a otra persona o quitar a las demás.
    **Roles (E90): `Administrador` y `Operador`** (`src/lib/db/roles.ts`, migración 0006 que reemplazó a "Visualizador").
    Operador = `chain:read, scenario:read, scenario:run` (consulta la red, simula y ve resultados y alertas; no edita
    la red); Administrador hereda eso y suma `chain:write` y `organization:manage`. **Gestión de integrantes**
    (`src/lib/data/members.ts`, `PATCH/DELETE /api/organizacion/miembros/[id]`, pantalla `/organizacion`): el
    Administrador cambia el rol de otras personas o las saca de la organización (sus cadenas privadas se borran y lo
    compartido pasa a quien las saca); a sí mismo no (para irse está "Eliminar cuenta"), así la organización nunca
    queda sin administrador.
  - **Planes (`src/lib/plans.ts`, única fuente de los topes).** `organizaciones.plan` (`freemium` | `pro` | `max`) y
    `plan_desde`. Topes: Freemium 6 nodos / 3 escenarios guardados (US$0), Pro 15 / 6 (US$29/mes), Max 100 / 30
    (US$99/mes), netos de IVA; una cadena por organización en los tres. Los topes son de **nodos y escenarios
    guardados**; las ejecuciones (corridas) son ilimitadas y sin retención. Se hacen cumplir **en el servidor**
    (`src/lib/data/plan-limits.ts`: `assertNodeCapacity` / `assertScenarioCapacity` / `assertChainCapacity`, con un
    candado `pg_advisory_xact_lock` por organización y recheck dentro de la transacción) y responden 409 con
    `code: "plan_limit"`. El plan viaja en `Member.plan` (se lee de la base en cada request, como el rol) y en el
    snapshot; la UI (`usePlanUsage`) solo anticipa el bloqueo. Cambiar de plan: `PUT /api/organizacion/plan`
    (`organization:manage`), sin cobro; un downgrade que deje más nodos/escenarios que el tope se rechaza (409
    `plan_overage`): no hay purga ni archivado. Reemplazó al viejo `MAX_NODES_PER_CHAIN = 50`. La landing lee los
    mismos topes de `plans.ts`. **Cuenta (`/cuenta`)**: perfil propio (nombre y contraseña, `PATCH /api/cuenta`,
    `PUT /api/cuenta/contrasena` con la actual; el email no se edita) y el plan activo con subir/bajar de plan
    (`PlanManager`); se abre desde el menú de usuario de la barra lateral (`UserMenu`).
  - **Variables de entorno** (`.env.local`, ver `.env.example`): `DATABASE_URL` (pooler de Neon, runtime),
    `DIRECT_URL` (conexión directa, migraciones y seed), `AUTH_SECRET`.
  - Las decisiones metodológicas del motor son las de `docs/definiciones-motor.md`; no se cambian por cuenta propia.
- **Frontend: completo para el recorrido principal, incluida edición de atributos y propagación por el grafo.** Se
  construyó primero con datos mock y hoy corre contra la base (ver los pasos del backend arriba): `src/lib/domain/`
  (tipos + motor de simulación placeholder) y `src/stores/app-store.ts` (zustand). Pantallas:
  - `/cadenas` — listado + `/cadenas/nueva` (nombre, visibilidad, plantilla lineal/bifurcada/compleja).
  - `/cadenas/[id]` — canvas React Flow (5 tipos de nodo, aristas con `tiempo_transito`), modo "Diseño y monitoreo"
    (paleta, inspector de nodo con desempeño semanal + edición de label/capacidad, inspector de arista con
    tiempo_transito editable) y modo "Simulación" (`ChainCanvas mode="select"`: el grafo se sigue viendo y cada
    click en un nodo fija el nodo del único evento del escenario (clickear otro lo mueve; volver a clickear el elegido lo saca) —
    `ScenarioForm` expone `selectNode` vía ref).
  - `/cadenas/[id]/escenarios` y `/escenarios/[scenarioId]` — listado y resultado: tabla_k, déficit proyectado por
    nodo (directos y propagados), y la "red fork" (`ChainCanvas mode="display"`) coloreando cada nodo/arista según
    severidad (severo/moderado/sin efecto) con un slider de semana para ver cómo avanza la propagación.
  - `/cadenas/[id]/escenarios/[scenarioId]` tiene dos vistas: **"Respuesta"** (solo lo que le importa a quien decide:
    cuánto se pierde, dónde pega y desde cuándo; a partir de cuándo conviene reconfigurar (una tabla que dice, para distintos costos del cambio en
    semanas de operación, cuántas semanas tiene que durar el problema; no decide por el usuario ni le pide el costo); y la red
    de propagación con su reproductor) y **"Detalle técnico"** (ficha de la corrida con réplicas/semilla, corridas
    guardadas, eventos, cómo se calculó la decisión, evolución semanal de la crisis, tabla_k por fracción de
    propagación y los gráficos por nodo). Toda la jerga metodológica vive en la segunda; la primera no la menciona.
  - **El umbral y la recomendación salen de la misma función.** `N(k) = min { t : E(t) ≥ k·d0 }`, con `E(t)` la pérdida
    evitable acumulada al reconfigurar en `s_r`. "Conviene reconfigurar" con el costo `k` que asume el usuario es
    `E(H) ≥ k·d0` en más de la mitad de las réplicas (la pantalla Respuesta no tiene control de costo: muestra la tabla N para varios costos con
    `thresholdAtCost`; el detalle técnico usa k = 3 para "cómo se calculó la decisión"). La fórmula anterior de `tabla_k` estaba invertida y se reemplazó
    (ver `docs/definiciones-motor.md`). **No hay piso de propagación**: el viejo `MIN_PROPAGATED_MAGNITUDE` se sacó.
  - `/comparar` — comparación de 2+ escenarios (tabla_k lado a lado, mediana + rango, última corrida de cada uno).
  - `/biblioteca` — referencia de tipos de nodo/arista/plantillas.
  - `src/lib/domain/simulate.ts` implementa las definiciones de la tesis (`docs/definiciones-motor.md`). Su API es
    `runScenarioSimulation(...)` (y `replayRun` para reproducir una corrida guardada con su semilla). Por cada fracción
    de propagación `c` de `PROPAGATION_FRACTIONS` ([0.45, 0.55, 0.65]) corre `replications` réplicas (30 por defecto);
    cada réplica propaga con la **recurrencia semanal** `d_j(s) = min(1, max(e_j(s), max c·d_i(s − τ_ij)))` para
    mantener (A) y para reconfigurar al decidir (B), y de ahí sale `E(t)`. Devuelve `projectionByNode` (mediana + p10–p90
    por semana), `totalDeficit` y `weeklyLoss` (semanas equivalentes, la suma de los déficits relativos de la red),
    `kTable` (30 filas), `replicaCurves` (para N(k) con cualquier k), `breakEvenKs` y `d0`. Ya **no** hay BFS con poda por
    dominancia: la recurrencia cuesta lo mismo sin importar cuántos caminos tenga la red (300 nodos conectados todos con
    todos, 16 semanas: 0,25 s). El déficit es una **proporción del nivel normal**, así que en una simulación manual el
    sorteo de la banda no mueve el resultado. Cualquier cambio del motor se valida con `src/lib/domain/simulate.test.ts`
    (compara contra una enumeración de caminos independiente) y se mide con `scripts/bench-engine.ts`. Las rutas de
    simulación rechazan con 422 una corrida cuyo trabajo estimado supere `MAX_SIMULATION_WORK` (1.000 M de unidades).
    **Despliegue (Vercel, plan Hobby):** `maxDuration = 300` (máximo de Hobby; con 800 el build falla) y las
    funciones corren en `gru1` por `vercel.json`, junto a Neon (`sa-east-1`). No sacar el `vercel.json`: en `iad1`
    cada simulación sumaba ~3,3 s de espera a la base. Mediciones en `docs/rendimiento-motor-vercel.md` (del motor
    anterior; el costo de cómputo bajó, la latencia a la base no).
  - **Simulación desde una alerta.** Un nodo en atención o crítico ofrece "Simular cómo sigue" (inspector del nodo →
    `/cadenas/[id]?alerta=<nodo>`). `deriveAlertScenario` (`src/lib/domain/detection.ts`) deriva nodo, inicio del desvío
    t0, `s_r` = semana siguiente a la detección y d0; el escenario guarda `s_r` en `escenarios.semana_decision`. Las
    semanas observadas entre t0 y `s_r` son pasado y no entran en el umbral.
  - `ChainCanvas` tiene tres modos (`edit`/`select`/`display`) en vez de un `readOnly` booleano — ver
    `src/components/canvas/chain-canvas.tsx`.
- **RF corregidos de la bitácora, ya implementados en el mock** (no son "placeholder libre": el cálculo es de
  mentira, pero la *forma* del resultado respeta las decisiones cerradas):
  - **RF012** — `WeeklyPerformance` lleva `baselineLowerBand`/`baselineUpperBand`; los gráficos la sombrean.
  - **RF023 / C36** — cada corrida barre 30 réplicas por fracción de propagación, sorteando una posición dentro de la
    banda de la línea base. En producción la recomendación registrada es 200-300, todavía sin confirmar.
  - **RF027** — la fracción trasladada por arista no es fija: se barre en {0.45, 0.55, 0.65} y el umbral se reporta
    para cada una.
  - **RF029** — `KTableRow` es `{k, propagationFraction, thresholdMedian, thresholdLow (p10), thresholdHigh (p90),
    crossingShare}`; `null` = "no cruza". Nunca un valor puntual.
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
  - **Tests:** Vitest (`npm test`, 163) y, para el servicio de ML, pytest (`cd twinchain-ml && .venv/bin/pytest`, 22). Los de la ingesta sintética y el estado operativo incluyen las
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
