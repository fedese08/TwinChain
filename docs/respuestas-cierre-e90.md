# Respuestas para cerrar el E90 (verificadas contra el código, 21/10/2026)

> **Actualización (misma fecha, tanda 5): el sistema se alineó con el documento en tres puntos.** Lo que sigue en este archivo
> describe el estado ANTERIOR en esos puntos; vale lo de esta nota.
> - **Roles:** ahora son `Administrador` y `Operador` (migración 0006). El Administrador cambia el rol de otras personas y las saca de la
>   organización (pantalla `/organizacion`, `PATCH/DELETE /api/organizacion/miembros/[id]`). Respuestas 7 y 14 (RF002): implementado.
> - **Escenarios (RF026, Flujo B):** varios nodos con un evento por nodo, validado en el formulario y en la API. Respuesta 14 (RF026): implementado.
> - **Job en segundo plano (4.4):** la simulación responde 202 y corre con `after()`; la pantalla consulta hasta que está lista. Respuesta 11: ahora sí es un job en segundo plano.
> - Pruebas: **163** en Vitest. Falta aplicar en Neon las migraciones 0005, 0006 y 0007.

Fuente de cada dato: el código del repositorio en la rama `main` (último commit local `ae5d7de`, todavía sin pushear), los
tests corridos hoy y los documentos de `docs/`. **No se verificó nada en el sistema desplegado** (Vercel, Render, Neon): lo que
depende de eso figura como "NO SÉ". No se cambió código.

---

## A. Detección y umbral

### 1. RF011 (detección una vez por semana al recibir el lote)
**Respuesta corta: parcialmente.** La detección es una función pura de las filas semanales guardadas
(`runCusum` / `degradationStatus`) y se recalcula cada vez que se leen. **No hay una tarea ni un evento "al recibir el lote"**;
no existe cron. El lote semanal llega de dos formas:
- **Control "Tiempo real"** de la pantalla de la cadena: el navegador pide una semana por tick a `POST /api/cadenas/[id]/avance`
  (el reloj lo maneja el navegador porque Vercel no sostiene un proceso). Es **manual** (el usuario lo enciende).
- **`POST /api/cadenas/[id]/envios`**: recibe los envíos de un nodo (fecha, margen) de cualquier fuente real y los agrega por semana.
  Es una API: **no hay pantalla** para cargar envíos.

También genera historial (28 semanas) al crear una cadena o agregar un nodo.

**Evidencia:** `src/lib/domain/degradation.ts` (comentario de cabecera: "la detección corre sobre el lote de cada semana… no hace falta
guardar el estado"); `src/app/api/cadenas/[chainId]/avance/route.ts` (comentario: "no hay un reloj en el servidor"); `vercel.json` (solo
`regions`, sin `crons`); `src/app/api/cadenas/[chainId]/envios/route.ts`.
**Para el documento:** decir que la detección se evalúa sobre el lote semanal cada vez que se incorpora una semana, sin afirmar un
proceso programado.

### 2. HU1: ¿una sola semana muy mala puede confirmar?
**Respuesta corta: sí.** Desde acumulado 0, una semana confirma si el desempeño cae al menos **(1 + h) márgenes** por debajo de la
línea base (S = (b − x) − K ≥ h·K). Con los 4 niveles de sensibilidad:

| Nivel (f) | h* | Caída de una sola semana que confirma |
|---|---|---|
| 0 | 0,25 | 1,25 márgenes |
| 1 | 0,50 | 1,5 márgenes |
| 2 | 1,25 | 2,25 márgenes |
| 3 (por defecto) | 2,00 | 3 márgenes |

**Evidencia:** `src/lib/domain/degradation.ts` (`runCusum`); test `degradation.test.ts:26` ("límite propio del CUSUM: … una única semana
extremadamente mala sí puede confirmar"). Ya figura como límite en el texto del E90.

**Cuánto cuesta cambiarlo (no se hizo).** Dos opciones, ambas de unas 5 líneas en `runCusum` más tests:
(a) exigir al menos 2 semanas de racha para confirmar, o (b) limitar el aporte semanal a c·K. **Lo que lo encarece es que cambia el
retardo y las falsas alarmas**, así que hay que **recalcular la calibración** (`scripts/calibrate-cusum.ts` → `src/data/cusum-calibracion.json`),
ajustar los tests de umbral y rehacer la tabla y las cifras del documento. Estimación (no medida): medio día de trabajo.
**Decisión recomendada para el sábado:** dejarlo como límite declarado.

### 3. Valor de k y niveles de sensibilidad
**Respuesta corta:** k es el **costo de reconfigurar, en semanas de operar como ahora** (K = k·d0). El motor lo barre de 1 a 10
(`K_MAX = 10`). **El "3" es una convención, no un valor derivado**: la pantalla Respuesta supone k = 3 (`DEFAULT_RECONFIGURATION_COST_WEEKS`)
y la sensibilidad toma `MAX_FALSE_ALARM_COST = 3` ("igual al k por defecto"). Por eso la tabla dice "3 (cota superior)": es el tope que ofrece
la interfaz, no un k calculado. La calibración sí barrió f más arriba (hasta 89, está en el JSON).

**Los 4 niveles corresponden exactamente a f = 0, 1, 2, 3** (`FALSE_ALARM_COST_CHOICES = [0,1,2,3]`) y a los h* de la tabla del documento:
0,25; 0,50; 1,25; 2,00. Cada uno es una fila del JSON, sin interpolar. Valores del JSON: retardo 2,14 / 2,43 / 3,41 / 4,17 semanas;
falsas alarmas cada 26 semanas 1,96 / 1,54 / 0,85 / 0,59; detectados 97,9 / 97,9 / 92,6 / 90,1 %.
**Evidencia:** `src/lib/domain/cusum-config.ts`, `src/data/cusum-calibracion.json`, `src/lib/domain/k-table.ts`, `escenarios/[scenarioId]/page.tsx:48`.
**Ojo con el texto del E90:** la tabla muestra "98 %, 98 %, 93 %, 90 %" (redondeado). Está bien. Decir "k = 3" como cota es una convención de la interfaz.

---

## B. Mediciones y pruebas

### 4. RNF "red de hasta 100 nodos y 52 semanas en menos de 5 s en producción"
**Respuesta corta: NO se midió en producción con el motor actual.**
- La única medición en Vercel + Neon es del **12/10/2026**, hecha con el **motor anterior** (el de caminos). Resultados: red densa de
  150 nodos y 52 semanas, 0,62 s de motor; de 300 nodos, 1,27 s; más ~0,12 s de base desde `gru1`. **No hay medición de 100 nodos.**
- Con el motor actual solo hay medición **local** (Apple M4): 300 nodos × 52 semanas = 0,24 s (`scripts/bench-engine.ts`).
- Estimación (no medida): 0,24 s × ~3,5 ≈ 0,9 s para 300 nodos en Vercel, por debajo de 5 s para 100 nodos. **Es una estimación.**

**Las dos "3,3" son mediciones distintas, y el E90 las mezcla:**
1. **Factor Vercel/local:** 1,6× a 3,5× según el caso (3,2× con 40 nodos, 3,5× con 300). El documento dice "3,3 veces"; lo correcto es "entre 3 y 3,5 veces" en redes medianas.
2. **Espera a la base:** funciones en Washington (`iad1`) vs base en São Paulo: 3,575 s dentro de la función contra 0,122 s en `gru1` (el motor aportaba 0,007 a 0,011 s). Es la "3,3 s a 0,1 s" (`docs/pendientes.md:89`).
Son números parecidos por casualidad.

**Evidencia:** `docs/rendimiento-motor-vercel.md` (tablas "Resultados del motor", "Comparación con la medición local" y "Tiempo de instancia"), `docs/rendimiento-motor.md`.
**Para el documento:** redactar el RNF como objetivo ("se espera") o medir antes del sábado (una corrida de 100 nodos en producción).

### 5. Cantidad de pruebas hoy
**Vitest: 152 pruebas en 14 archivos. pytest: 22.** Comandos:
```
npm test                                   # Vitest: "Tests  152 passed (152)"
cd twinchain-ml && .venv/bin/pytest -q     # "22 passed"
```
(El 148 era del estado anterior, antes de las pruebas de períodos de degradación y alertas simuladas.)
**Aviso:** una prueba Monte Carlo (`monitoring.test.ts` → "un nodo sano casi nunca sale en crítico…", nodos viejos 0–100) falló 1 de ~22 corridas
(0,51 % contra un tope de 0,5 %), porque usa ids aleatorios. Está anotada en `docs/pendientes.md`. No afecta al CUSUM.

---

## C. Datos

### 6. DataCo
**NO, firme.** No se usa en código, scripts, pruebas ni notebooks. Aparece solo en documentos de texto (`docs/e90-tecnologias-*.md`,
`docs/alineacion-documento-app.md`, `twinchain-ml/validation/RESPUESTAS_DEVOLUCION.md`). **Evidencia:** búsqueda de "dataco" en todo el repositorio (sin `node_modules`).

---

## D. Usuarios, roles y privacidad

### 7. Roles
**Nombres exactos en código y base: `Administrador` y `Visualizador`** (tabla `roles_usuario`; `src/lib/db/roles.ts`).
**"Operador" NO EXISTE.** Permisos: Administrador = `organization:manage, chain:read, chain:write, scenario:read, scenario:run`;
Visualizador = `chain:read, scenario:read`.

| Acción | Administrador | Visualizador | Evidencia |
|---|---|---|---|
| Consultar la red | Sí | Sí | `chain:read` (lecturas en el snapshot del layout) |
| Simular (crear escenario, nueva corrida, borrar simulación) | Sí | **No** | `requireApiMember("scenario:run")` en `api/escenarios/**` |
| Editar la red (cadenas, nodos, aristas, avance, línea base, envíos) | Sí | **No** | `requireApiMember("chain:write")` |
| Invitar miembros | Sí | No | `POST /api/organizacion/invitaciones`, `organization:manage` |
| Revocar una invitación pendiente | Sí | No | `DELETE /api/organizacion/invitaciones/[id]` |
| Cambiar el plan de la organización | Sí | No | `PUT /api/organizacion/plan` |
| **Eliminar a otro miembro** | **NO EXISTE** | **NO EXISTE** | no hay endpoint ni pantalla |
| **Cambiar el rol de otro miembro** | **NO EXISTE** | **NO EXISTE** | no hay endpoint ni pantalla (solo se elige el rol al invitar) |
| Eliminar su propia cuenta | Sí* | Sí | `DELETE /api/cuenta` (`requireApiUser`, cualquier rol) |

\* La única administradora no puede irse mientras queden integrantes.
**Lo que el Administrador puede hacer realmente sobre los usuarios:** invitar con un rol (Administrador o Visualizador) y revocar invitaciones.
La pantalla `/organizacion` solo lista a los miembros. **Es una diferencia grande con el documento** ("gestiona usuarios y sus roles").
**Costo de alinear (no se hizo):** renombrar Visualizador→Operador y darle `scenario:run` (migración de datos de `roles_usuario`, `ROLE_DEFINITIONS`, seed, etiquetas): ~2–3 h. Pantalla de usuarios con cambio de rol y baja (con reglas para no dejar la organización sin administrador): ~1 día con tests.

### 8. Eliminación de cuenta (RF032)
**Respuesta corta: el comportamiento descrito es exacto.** Pide la contraseña actual (bcrypt; 400 si no coincide). Disponible para **todos los roles**,
y también para una cuenta sin organización. Casos (`src/lib/data/account-deletion.ts`, transacción con candado por organización):
- **Sin organización:** se borra solo la fila de `usuarios`.
- **Única integrante:** se borran todas las `cadenas` de la organización (cascade: nodos, aristas, `desempeno_semanal`, escenarios, eventos, resultados), el usuario y la `organizaciones` (cascade a `invitaciones`).
- **Con más integrantes y otra persona administradora:** se borran las cadenas **privadas** que creó; `cadenas.creada_por`, `escenarios.usuario_id` e `invitaciones.invitada_por` pasan a la administradora; se borra el usuario.
- **Única administradora con más integrantes:** 409 `last_admin_with_members`.

**Datos personales que se borran:** en `usuarios`, `nombre`, `email`, `contrasena` (hash bcrypt), `rol_id`, `organizacion_id`, `creado_en` (la fila entera). La interfaz lo dice así: "Se borran tu cuenta y tus datos personales (nombre, email y contraseña). No se puede deshacer." (`src/components/account/profile-form.tsx:159`).
**Qué queda:** (1) `invitaciones.email` de las personas invitadas por esa cuenta, si la organización sigue existiendo (son datos de terceros; solo cambia `invitada_por`); (2) lo que es de la organización (cadenas compartidas, simulaciones); (3) **copias de seguridad / historial de Neon y registros de Vercel: NO SÉ** (depende del plan de Neon y no está en el código). No hay registro de auditoría propio.

### 9. Registro y consentimiento
**Respuesta corta: NO EXISTE texto de finalidad, aviso de privacidad, casilla de aceptación ni enlace a una política.** Búsqueda de "privacidad / términos / consentimiento / política" en `src/`: sin resultados fuera del texto de eliminación de cuenta.
Textos exactos del registro (`src/app/(auth)/registro/page.tsx`, `src/components/auth/register-form.tsx`):
- Título: "Crear cuenta". Subtítulo: "Elegí cómo vas a usar TwinChain."
- "Me registro como": **Organización** — "Creás tu organización y después invitás a tu equipo"; **Empleado** — "Te sumás a una organización con una invitación".
- Campos: "Nombre de la organización" (solo si es Organización), "Tu nombre", "Email", "Contraseña" (ayuda: "Entre 8 y 72 caracteres").
- Botón: "Crear cuenta" ("Creando cuenta…"). Pie: "¿Ya tenés cuenta? Iniciá sesión".

**Datos que se piden:** tipo de registro, nombre, email, contraseña y, si es organización, su nombre.
**Datos que guarda el sistema:** `usuarios` (id, nombre, email, hash de contraseña, rol, organización, fecha de alta); `organizaciones` (nombre, plan, fecha del plan, fecha de alta); `invitaciones` (email invitado, rol, quién invitó, hash del token, vencimiento). La sesión es un JWT con solo la identidad. **El email no se verifica.**

---

## E. Despliegue y arquitectura

### 10. Planes y qué corre hoy
- **Vercel: Hobby** (el build rechazó `maxDuration` mayor a 300 el 12/10/2026; `docs/rendimiento-motor-vercel.md`, "Entorno medido"). Región `gru1` (`vercel.json`).
- **Neon: NO SÉ el plan.** El repositorio solo dice que está en `sa-east-1`. Hay que mirarlo en el panel de Neon.
- **Render: NO SÉ si está desplegado.** El repositorio lo deja declarado (`twinchain-ml/render.yaml`: `runtime: docker`, `plan: free`, región `oregon`, el plan gratuito se duerme tras ~15 min; `Dockerfile` en `twinchain-ml/`), pero el despliegue y las variables `ML_SERVICE_URL` / `ML_API_KEY` en Vercel eran un paso pendiente en esta sesión. Sin esas variables, el sistema funciona con línea base **provisoria** (marcada en `fuente_linea_base`). **Confirmarlo en el panel de Render y de Vercel antes de afirmar "corre en Render".**
- **Migraciones:** la 0005 (sensibilidad por cadena) debe aplicarse a Neon con `npm run db:migrate`; el código ya pusheado depende de ella.

**Para el documento:** el modelo de negocio usa planes pagos como proyección de costos; el apartado Tecnologías describe el plan gratuito, que es lo que está declarado en el código. Aclararlo con una frase.

### 11. Simulación en el mismo pedido e ingesta en el monolito
**Confirmado en ambos.**
- La simulación corre **síncrona dentro del pedido**: `POST /api/escenarios` abre `db.transaction` y llama a `runScenarioOnChain` (`src/app/api/escenarios/route.ts`, `src/lib/simulation/run-scenario.ts`). No hay cola, `after()`, ni job (búsqueda de `after(`, `waitUntil`, `cron` en `src/` y `vercel.json`: sin resultados). La espera que ve el usuario en pantalla (`pendingRuns`) es solo estado del navegador.
- La ingesta corre **dentro del monolito**: `ingestChainHistory` / `ingestNodeHistory` (`src/lib/ingestion/ingest-history.ts`), llamadas desde `api/cadenas/route.ts`, `api/cadenas/[chainId]/nodos/route.ts` y `avance`. Lo único externo es la **llamada HTTP al microservicio de ML** para la línea base, antes de la transacción.
**Esto contradice la sección 4.4 si dice "job en segundo plano".** Pasarlo a `after()` es una tanda planificada (~medio día: columna de estado, respuesta 202, consulta desde la pantalla); no está hecha.

---

## F. Evidencia para el documento

### 12. Capturas
**No las tomé.** El navegador integrado de esta herramienta no pinta los gráficos de Recharts ni las aristas de React Flow (ver nota en `CLAUDE.md`), así que las capturas tienen que salir de un navegador real, con el sistema corriendo (local o desplegado) y la fecha visible.
Estado de cada pantalla pedida:
| Pantalla | Existe | Dónde |
|---|---|---|
| Registro e inicio de sesión | Sí | `/registro`, `/login` |
| Canvas de la red | Sí | `/cadenas/[id]` |
| Carga de envíos / ingesta semanal | **Solo el control "Tiempo real"** (avance semanal); la carga de envíos reales es una API **sin pantalla** | `POST /envios` |
| Alerta de degradación sostenida con la banda | Sí (tarjeta de alerta del inspector del nodo y gráfico con períodos) | inspector de nodo |
| Simulación y resultado (mediana y rango) | Sí | `/cadenas/[id]/escenarios/[id]`, vistas Respuesta y Detalle técnico |
| Historial de ejecuciones | Sí ("corridas guardadas") | Detalle técnico del resultado |
| Eliminación de cuenta | Sí | `/cuenta` |
Si prefieren, puedo levantar el sistema local y tomar las capturas con Chrome (extensión).

### 13. Esquema de la base
Archivo completo: **`src/lib/db/schema.ts`** (313 líneas, Drizzle). Tablas: `organizaciones`, `roles_usuario`, `usuarios`, `invitaciones`, `cadenas`, `nodos`,
`aristas`, `desempeno_semanal`, `escenarios`, `eventos`, `resultados`. Explicación del modelo: `docs/modelo-datos.md`. Migraciones: `drizzle/0000` a `0005`.

### 14. Estado de RF001 a RF031
Criterio: "Implementado" = existe en el código y se probó (tests o recorrido en pantalla); la evidencia es el archivo o la prueba. Texto de cada RF: Anexo A del E90.

| RF | Estado | Evidencia |
|---|---|---|
| RF001 multi-tenant | Implementado | `cadenas.organizacion_id`; toda consulta filtra por la organización de la sesión (`requireApiMember`, `findVisibleChain`) |
| RF002 rol por usuario | **Parcial** | `roles_usuario` + permisos; los roles son Administrador/Visualizador, no Operador/Administrador |
| RF003 edición individual persistida | Implementado | edición optimista con persistencia por API en cada cambio (no hay botón "guardar") |
| RF004 solo versión vigente | Implementado | no hay versionado |
| RF005 cinco tipos de nodo | Implementado | discriminador `nodos.tipo` |
| RF006 validar Vendedor contra Olist | **No implementado en la app** | el camino con vendedor real está inactivo (`REAL_VENDEDORES_ENABLED = false`); la validación contra vendedores reales es offline (modelo y calibración) |
| RF007 capacidades de Fábrica/Almacén | Implementado | campos de capacidad en el nodo e inspector |
| RF008 tiempo de tránsito sin costo | Implementado | `aristas.tiempo_transito`, sin costo |
| RF009 ingesta sintética por envío | **Parcial** | `synthetic/shipments.ts` emite envíos individuales por semana; no es un flujo continuo en tiempo real |
| RF010 agregación semanal | Implementado | `aggregateShipments` |
| RF011 detección semanal al recibir el lote | **Parcial** | función pura sobre las filas; sin tarea programada (ver respuesta 1) |
| RF012 desempeño, línea base y banda por semana | Implementado | `desempeno_semanal` con `banda_inferior/superior` |
| RF013 déficit sin negativos | Implementado | `max(línea base − real, 0)`; tests |
| RF014 línea base inalterada | Implementado | queda congelada; el avance la copia; no se reentrena en la app |
| RF015 modelo entrenado con Olist | Implementado | `twinchain-ml/`; **despliegue en Render: NO SÉ** |
| RF016 valor esperado con banda | Implementado | cuantiles 0,1/0,5/0,9 con corrección conformal |
| RF017 línea base del propio historial | Implementado | 7 variables del propio nodo; test de aislamiento |
| RF018 CUSUM sobre el residuo | Implementado | `degradation.ts`; los nodos viejos (0–100) usan la regla por desvíos |
| RF019 umbral por costo | Implementado | `calibrate-cusum.ts`, JSON; f barrido de 0 a 89, la interfaz ofrece 0 a 3 |
| RF020 paso separado del entrenamiento | Implementado | script aparte sobre el modelo ya entrenado (guarda su SHA-256) |
| RF021 pérdida acumulada mantener vs reconfigurar | Implementado | `simulate.ts`, E(t) |
| RF022 escalón | Implementado | `docs/definiciones-motor.md`, tests |
| RF023 réplicas con sorteo dentro de la banda | **Parcial** | 30 réplicas por fracción (la recomendación es 200–300); en una simulación manual el sorteo de la banda no mueve el resultado |
| RF024 unidades no monetarias | Implementado | no hay magnitud monetaria en el sistema |
| RF025 escenario con horizonte | Implementado | formulario de escenario |
| RF026 eventos sobre un nodo | **Parcial** | un nodo con varios eventos; el Flujo B del documento pide como máximo uno por nodo (varios nodos) |
| RF027 fracción trasladada con retraso | Implementado | {0,45; 0,55; 0,65} |
| RF028 umbral por ejecución y costo | Implementado | `kTable`, N(k) |
| RF029 mediana y rango | Implementado | p10–p90, "no cruza" |
| RF030 ejecuciones separadas | Implementado | `resultados` 1-a-muchos, semilla por corrida |
| RF031 tabla o gráfico costo → umbral | Implementado | pantalla de resultado |

### 15. Referencias (abiertas y verificadas hoy en la fuente; el DOI/URL es el de la fuente)
| Referencia | Dato verificado |
|---|---|
| Koenker y Bassett (1978) | *Econometrica* 46(1), pp. 33–50. DOI 10.2307/1913643. [econometricsociety.org](https://www.econometricsociety.org/publications/econometrica/1978/01/01/regression-quantiles). La página mostró los autores en orden distinto al que citamos: confirmar el orden en JSTOR. |
| Friedman (2001) | *The Annals of Statistics* 29(5), pp. 1189–1232. DOI 10.1214/aos/1013203451. [Project Euclid](https://projecteuclid.org/euclid.aos/1013203451) |
| Romano, Patterson y Candès (2019) | *Advances in Neural Information Processing Systems* 32, pp. 3543–3553. [proceedings.neurips.cc](https://proceedings.neurips.cc/paper_files/paper/2019/file/5103c3584b063c431bd1268e9b5e76fb-Paper.pdf). Sin DOI de revista; arXiv 1905.03222. |
| Lundberg y Lee (2017) | *Advances in Neural Information Processing Systems* 30. [papers.nips.cc](https://papers.nips.cc/paper_files/paper/2017/file/8a20a8621978632d76c43dfd28b67767-Paper.pdf); arXiv 1705.07874. Páginas: no verificadas. |
| Lundberg et al. (2020) | *Nature Machine Intelligence* 2(1), pp. 56–67. DOI 10.1038/s42256-019-0138-9. [PubMed](https://pubmed.ncbi.nlm.nih.gov/32607472/) |
| Pedregosa et al. (2011) | *Journal of Machine Learning Research* 12, pp. 2825–2830. [jmlr.org](https://jmlr.org/papers/v12/pedregosa11a.html). Sin DOI. |
| Provos y Mazières (1999) | *Proceedings of the FREENIX Track: 1999 USENIX Annual Technical Conference*, pp. 81–92. [usenix.org](https://www.usenix.org/conference/1999-usenix-annual-technical-conference/presentation/future-adaptable-password-scheme). Las páginas salen de la ficha de USENIX, no del encabezado del PDF. |

---

## Lo que el documento debe corregir según estas respuestas
1. **Roles:** el sistema tiene Administrador y Visualizador; el documento dice Operador y Administrador, y que el Administrador "gestiona usuarios y sus roles" (hoy solo invita y revoca invitaciones).
2. **"3,3 veces más lento"** → "entre 3 y 3,5 veces" (medido con el motor anterior); la "3,3 s a 0,1 s" es otra medición (espera a la base).
3. **RNF de 5 s para 100 nodos en producción:** no está medido con el motor actual; redactarlo como objetivo o medirlo.
4. **Job en segundo plano (4.4):** no existe; la simulación y la ingesta corren dentro del monolito.
5. **RF011, RF023, RF026, RF009, RF002, RF006:** declarar como parciales o no implementados.
6. **Render:** confirmar en el panel antes de afirmar que corre en Render con Docker y plan gratuito.
7. **Consentimiento:** no hay texto de finalidad ni casilla de aceptación en el registro.
