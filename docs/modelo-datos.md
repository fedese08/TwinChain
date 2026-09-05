# Modelo de datos — especificación completa

Sistema de Supply Chain con Digital Twin (PFI UADE — Sena y Guevara). Base de datos elegida: **PostgreSQL
(relacional)** — originalmente se había definido MongoDB; ver la nota de migración al final de este documento.
Las relaciones que abajo se describen como "FK" son ahora **claves foráneas reales**, con integridad referencial
forzada por el motor (a diferencia del documento original pensado para Mongo).

La notación de cardinalidad usa el estándar entidad-relación (pata de gallo): "1 a muchos" significa que un registro
del lado "1" puede tener cero o más registros asociados del lado "muchos".

**Este documento tiene prioridad estructural sobre `TwinChain-DEV.md` y sobre `TwinChain v2.dc.html`** — ver la nota
de reconciliación al final.

## Entidades

### Organizacion
Cliente que usa el sistema.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nombre | string | | |

### RolUsuario
Catálogo de roles de usuario.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nombre | string | | ej. "Administrador", "Visualizador" |
| permisos | array de string (`text[]`) | | lista abierta de acciones permitidas; se completa cuando se definan los roles concretos. La validación de qué significa cada permiso vive en la aplicación, no en el modelo de datos |

### Usuario
Accede al sistema.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nombre | string | | |
| email | string | | |
| contrasena | string | | hasheada, nunca en texto plano |
| rol_id | UUID | FK → RolUsuario | |
| organizacion_id | UUID | FK → Organizacion | |

### Cadena
Cadena de suministro de una Organizacion. Una organización puede tener más de una.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nombre | string | | |
| organizacion_id | UUID | FK → Organizacion | |

### Nodo
Proveedor, fábrica, almacén, vendedor o cliente — los eslabones tradicionales de una cadena de suministro. Sin
origen/destino — eso vive en Arista.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| tipo | string | | "Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente" |
| cadena_id | UUID | FK → Cadena | |

Atributos propios por tipo (no van en el diagrama como cajas aparte — se documentan acá y se implementan como
columnas nullable de la misma tabla Nodo, ver nota de implementación abajo):

- Proveedor → `capacidad_suministro` (float, u/semana)
- Fabrica → `capacidad_produccion` (float, u/semana)
- Almacen → `capacidad_almacenamiento` (float, u) y `nivel_stock_actual` (float, u)
- Vendedor, Cliente → sin atributos propios identificados todavía; se agregan cuando haga falta

**`nivel_stock_actual` es un dato descriptivo, no un insumo de cálculo.** RF027 excluye
explícitamente inventario y unidades físicas de la propagación ("...sin incluir inventario ni
unidades físicas en el cálculo"), así que este campo existe para dar contexto operativo en la
ficha del nodo y **no debe entrar en ninguna fórmula** del motor de simulación. Se agregó por
decisión del usuario, con esa restricción explícita.

Ninguno de estos atributos participa hoy del cálculo: son estructurales, reservados para cuando
el motor real modele restricciones de capacidad. Vendedor se deja sin atributos a propósito —
los candidatos naturales (región, categoría) son justamente las variables de contexto que RF017
descartó para condicionar la línea base, y agregarlos invitaría a usarlos contra esa decisión.

Vendedor es el tipo que corresponde al `seller_id` de Olist — el único nodo para el que hay datos reales de
desempeño. Proveedor y Fábrica, por ahora, son conceptuales: no hay forma de validarlos empíricamente con el dataset
elegido.

**Nota de implementación (PostgreSQL, para Claude Code):** esto se implementa como **herencia de tabla única**
(single table inheritance) — una sola tabla `nodos` con las columnas comunes (`id`, `tipo`, `cadena_id`) más las
columnas propias de cada tipo, todas nullable (`capacidad_suministro`, `capacidad_produccion`,
`capacidad_almacenamiento`, `nivel_stock_actual`). No se crean
tablas separadas por tipo. Opcionalmente se puede reforzar con un `CHECK` a nivel tabla (ej.
`CHECK (tipo <> 'Fabrica' OR capacidad_produccion IS NOT NULL)`) para que la base rechace un nodo Fábrica sin
capacidad cargada — evaluar si conviene o si esa validación queda mejor del lado de la aplicación, como en el resto
del modelo.

### Arista
Conecta dos Nodos. Reemplaza el campo origen/destino que en algún momento se pensó como atributo directo de Nodo.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nodo_origen_id | UUID | FK → Nodo | |
| nodo_destino_id | UUID | FK → Nodo | |
| tiempo_transito | float | | sin costo económico — decisión explícita, ver nota abajo |

### Evento
Instancia concreta de una disrupción inyectada o detectada. No hay una entidad TipoEvento aparte: todos los tipos
comparten la misma estructura (fecha, magnitud), así que el tipo es un campo simple.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| tipo | string | | "corte", "huelga", "demora", etc. — lista abierta |
| fecha_inicio | date | | |
| magnitud | float | | porcentaje de caída en el desempeño del nodo, unidad única sin importar el tipo |
| nodo_id | UUID | FK → Nodo | nodo afectado |
| escenario_id | UUID | FK → Escenario | a qué escenario pertenece esta instancia — no se reutiliza entre escenarios |

**Un Escenario, un solo Nodo (requerimiento funcional).** Un Escenario aplica eventos sobre **un único Nodo**: puede
tener varios Eventos, pero todos comparten el mismo `nodo_id`. La estructura no cambia — `nodo_id` sigue viviendo en
Evento, no en Escenario, porque el modelo ya soporta lo contrario y C29 (disrupciones concurrentes en varios nodos)
podría habilitarlo más adelante sin migrar nada. La restricción se valida en la capa de aplicación; opcionalmente se
puede reforzar en la base con un trigger o con un `UNIQUE (escenario_id, nodo_id)` desnormalizado si alguna vez se
quiere garantía a nivel motor.

### DesempenoSemanal
Registro semanal de desempeño real y esperado por nodo. Es la serie de tiempo sobre la que trabaja todo el sistema
— detección, déficit, simulación.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| nodo_id | UUID | FK → Nodo | |
| semana | date | | fecha de inicio de la semana que representa el registro |
| valor_real | float | | medido, sale de los datos reales (Olist: comparación de fecha estimada vs. fecha real de entrega) |
| linea_base | float | | predicho por el modelo de ML, congelado al momento de la decisión — no se recalcula con el tiempo |
| banda_inferior | float | | extremo inferior de la banda de incertidumbre de la línea base (RF012) |
| banda_superior | float | | extremo superior de la banda de incertidumbre de la línea base (RF012) |
| deficit | float | | linea_base − valor_real, nunca negativo (las semanas buenas no compensan a las malas) |

**Banda de incertidumbre (RF012).** La línea base no se registra como un valor puntual: el modelo de ML devuelve
también la banda dentro de la cual cae la predicción, y esa banda es la que barren las réplicas estocásticas de C36
al correr una simulación. Sin ella, RF023 no tendría de dónde sacar la variabilidad de cada réplica.

### Escenario
Configuración armada por un usuario para correr una simulación.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| horizonte_proyeccion | float | | hasta dónde proyecta la simulación (H) — la única de las tres magnitudes de tiempo que carga el usuario; necesaria para que "no existe umbral" tenga sentido como resultado acotado |
| usuario_id | UUID | FK → Usuario | quién lo armó |
| cadena_id | UUID | FK → Cadena | sobre qué cadena corre |

### Resultado
Salida de una corrida del sistema para un Escenario. Cada corrida se guarda por separado — no se pisa la anterior —
para poder comparar cómo cambió la recomendación con más datos.

| Atributo | Tipo | Clave | Notas |
|---|---|---|---|
| id | UUID | PK | |
| escenario_id | UUID | FK → Escenario | |
| fecha_corrida | date | | |
| tabla_k | JSONB — array de `{k, umbral_mediana, umbral_min, umbral_max}` | | correspondencia entre k (costo de reconfigurar, en semanas malas equivalentes) y el umbral de reconfiguración resultante; incluye el k a partir del cual el umbral deja de existir |
| replicas | int | | cantidad de réplicas estocásticas que produjeron esta corrida (RF023) |
| semilla | bigint | | semilla del generador pseudoaleatorio — permite reproducir la corrida exactamente (RF030) |
| semana_reconfiguracion | int | nullable | semana del horizonte en la que se aplicó la reconfiguración; null = no se reconfiguró (RF022) |

**El umbral es mediana y rango, nunca un valor puntual (RF029 / C36).** Cada corrida barre N réplicas variando los
parámetros dentro de la banda de incertidumbre (RF023) y, para cada k, reporta la mediana de los umbrales obtenidos
más el rango observado entre réplicas. Un k se marca como "sin umbral" solo si ninguna réplica encontró uno.

**Cada corrida se conserva (RF030).** `Resultado` sigue siendo 1-a-muchos con `Escenario`: volver a correr el mismo
escenario agrega una fila, nunca pisa la anterior. `semilla` y `replicas` son lo que hace que una corrida guardada
se pueda volver a reproducir tal cual — conservarla sin poder repetirla no alcanza para defenderla.

## Relaciones y cardinalidad

| Entidad A | Cardinalidad | Entidad B | Descripción |
|---|---|---|---|
| RolUsuario | 1 a muchos | Usuario | |
| Organizacion | 1 a muchos | Usuario | |
| Organizacion | 1 a muchos | Cadena | |
| Cadena | 1 a muchos | Nodo | |
| Nodo | 1 a muchos | Arista (como origen) | |
| Nodo | 1 a muchos | Arista (como destino) | |
| Nodo | 1 a muchos | DesempenoSemanal | |
| Nodo | 1 a muchos | Evento | |
| Usuario | 1 a muchos | Escenario | |
| Cadena | 1 a muchos | Escenario | |
| Escenario | 1 a muchos | Evento | un evento pertenece a un solo escenario, no se reutiliza |
| Escenario | 1 a muchos | Resultado | una fila por corrida |

## Decisiones que dieron forma a este modelo (contexto para quien lo implemente)

- **Sin ninguna magnitud monetaria en ningún punto del sistema.** Arista no tiene campo de costo — se sacó
  explícitamente después de discutirlo, porque contradice la decisión de que k (costo de reconfigurar) se mide en
  semanas equivalentes, no en dinero.
- **La duración de una disrupción nunca es un dato de entrada.** No hay ningún campo "duración estimada" en ninguna
  entidad. Es la incógnita que el sistema resuelve, no algo que se carga.
- **El déficit no compensa semanas buenas con malas.** Por diseño, el campo `deficit` de DesempenoSemanal nunca es
  negativo.
- **k no se carga en ningún lado como valor único.** El sistema no le pide a nadie un costo de reconfiguración —
  barre el rango completo y guarda la correspondencia entera en `tabla_k`.

## Pendiente / fuera del alcance de este documento

- **C21** (línea base condicionada por región, modo de transporte y estacionalidad) puede agregar campos a Nodo o a
  DesempenoSemanal cuando se resuelva. No debería agregar entidades nuevas.
- **C29** (disrupciones concurrentes en varios nodos) **no** está cubierto: por requerimiento funcional, un Escenario
  afecta **un único Nodo** — puede acumularle varios Eventos, pero todos sobre ese mismo Nodo. El modelo lo soporta
  estructuralmente (cada Evento lleva su `nodo_id`), así que habilitar C29 sería relajar la validación, no migrar el
  schema. Ver "Un Escenario, un solo Nodo" más abajo.
- ~~**C36** (réplicas estocásticas, resultado con rango en vez de valor puntual)~~ — **resuelto**: `tabla_k` guarda
  `{k, umbral_mediana, umbral_min, umbral_max}` por cada k, y `Resultado` suma `replicas`, `semilla` y
  `semana_reconfiguracion` (ver la entidad más arriba). Como `tabla_k` es JSONB, el cambio de forma no requirió
  migrar nada. Si en algún momento se necesita indexar o hacer queries agregadas sobre los valores de k, ahí sí
  conviene normalizarlo a una tabla `resultado_k` (`resultado_id` FK, `k`, `umbral_mediana`, `umbral_min`,
  `umbral_max`). El número de réplicas de producción sigue sin confirmarse (la recomendación registrada es 200-300);
  el frontend mock corre 30 para no trabar la UI en la demo.
- La calibración del detector (**C20**) fue evaluada y se determinó que no agrega entidades ni atributos a este
  modelo — es un proceso de desarrollo que se resuelve una sola vez, antes de que el sistema esté en producción, y
  no se refleja en el modelo de datos.

## Reconciliación con TwinChain-DEV.md y TwinChain v2.dc.html

Este documento llegó después del mockup visual (`TwinChain v2.dc.html`) y del spec funcional (`TwinChain-DEV.md`), y
choca con varios de sus supuestos. Por decisión del usuario, **este modelo manda en lo estructural**. Diferencias
resueltas:

| Mockup / spec anterior | Modelo real | Resolución |
|---|---|---|
| 4 tipos de nodo (supplier/factory/warehouse/customer) | 5 tipos (agrega Vendedor = seller, Olist) | 5 tipos, valores del discriminador en español tal como los define este documento |
| Arista con costo, capacidad, modo de transporte | Arista solo con `tiempo_transito` | Sin costo/capacidad/modo en ningún lado — no inventar magnitudes monetarias |
| Perturbación con mecanismos fijos (`capacity_shock`, etc.), severidad, onset, **duración configurada por el usuario** | Evento con `tipo` (lista abierta), `magnitud`, `fecha_inicio` — sin duración de entrada | La duración es un resultado, no un input. No hay selector de "mecanismo" cerrado ni slider de duración |
| Dashboard con costo total, nivel de servicio %, TTR | Resultado con `tabla_k` (k ↔ umbral) sobre déficit semanal acumulado | Pantallas de resultado/comparación reconstruidas alrededor de déficit y tabla_k, no de costo/servicio/TTR |
| Alertas ML por umbral de probabilidad de backorder | No existe esa entidad en este modelo | No implementada en la versión mock del frontend — queda pendiente de definición cuando se aborde el microservicio ML (Fase 5/6) |

## Migración de motor: MongoDB → PostgreSQL

Este documento se escribió originalmente contra MongoDB; el usuario decidió pasar a PostgreSQL después. Traducción
de las decisiones específicas del motor (el modelo conceptual — entidades, atributos, relaciones — no cambió en
nada):

| MongoDB (original) | PostgreSQL (vigente) |
|---|---|
| `id: ObjectId` en cada entidad | `id: UUID` (`gen_random_uuid()` / `uuid_generate_v4()`) |
| FK = referencia por id entre colecciones, sin integridad forzada por el motor | FK real, con integridad referencial forzada por Postgres |
| Nodo: patrón de discriminadores (una colección, validador distinto según `tipo`) | Nodo: herencia de tabla única (una tabla `nodos`, columnas propias nullable según `tipo`) |
| `permisos`: array de string embebido en el documento | `permisos`: columna `text[]` nativa de Postgres |
| `tabla_k`: array de `{k, umbral}` embebido en el documento | `tabla_k`: columna `JSONB` (misma forma; ver nota de C36 arriba si en algún momento hace falta normalizarla) |
| Sin schema fijo — agregar un campo nuevo no requiere migración | Schema fijo — agregar un campo nuevo requiere una migración (el ORM elegido se encarga) |

No hay entidades nuevas ni cambios de cardinalidad por este cambio de motor — es puramente una traducción de tipos
e implementación.

Ver `CLAUDE.md` para el estado de avance del código frente a este modelo.
