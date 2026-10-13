# Plan: scripts de simulación de datos para los nodos de la cadena

**Estado: implementado (fases 0 a 5). La referencia vigente es `docs/ingesta-sintetica.md`, que además lista las
desviaciones respecto de este plan (ventana de 28/24 semanas, CUSUM retrospectivo estandarizado, avance anclado al
nivel del nodo). El script 7, la inyección de incidentes, quedó sin hacer: ver `docs/pendientes.md`.**

Se entiende por "scripts de simulación de los nodos" lo que el spec (`TwinChain-DEV.md`, Fase 3) y la bitácora
(decisión 12, RF009) llaman *ingesta sintética*: los generadores que producen el desempeño semanal de cada nodo,
porque los sensores IoT reales son la arquitectura objetivo pero no existen para la demo.

## 1. Por qué hacen falta: qué pasa hoy

Lo que encontré en el código:

1. **Nada escribe `desempeno_semanal` salvo `scripts/seed.ts`,** y solo para los 14 nodos de la organización demo.
2. **Una cadena creada por un usuario nace sin datos.** No hay historial ni línea base. El motor de simulación
   saltea los nodos sin historial (`simulate.ts:383`), así que **una simulación sobre una cadena nueva no muestra
   nada**: cero nodos alcanzados y cero déficit. El inspector del nodo dice "Sin registros de desempeño" y el canvas
   no colorea nada.
3. **El generador actual está atado a los ids de los nodos demo** (`PERFORMANCE_PROFILE` con `node-sup-01`, etc.).
   No sirve para ningún nodo nuevo.
4. **La línea base se declara, no se estima.** Hoy es el parámetro `base` del perfil. El modelo exige otra cosa:
   RF017 dice que se estima a partir del propio historial del nodo, y que queda congelada.
5. **La verificación de estabilidad (C24, CUSUM) es de mentira.** `launchIngestionCheck` decide con
   `hashSeed(chainId) % 4`, o sea que a una de cada cuatro cadenas le inventa una alerta. Solo aparece en cadenas
   creadas en la sesión y no se guarda.
6. **No existe el "monitoreo vivo"** del Digital Twin (capa 1 del proyecto): el desempeño semanal no avanza.

## 2. Qué restricciones del modelo hay que respetar

Son decisiones ya cerradas; el plan las toma como reglas, no como opciones:

| Regla | Qué implica para los scripts |
|---|---|
| **RF017** | La línea base de un nodo sale **solo de su propio historial**: nada de región, categoría ni estacionalidad |
| Línea base **congelada** | Se estima una vez y no se recalcula con las semanas nuevas (si se moviera con la caída, la disrupción sostenida no se detectaría nunca) |
| **RF012** | Cada fila lleva `banda_inferior` y `banda_superior`: la incertidumbre de la línea base |
| `deficit = max(línea_base − valor_real, 0)` | Nunca negativo |
| Sin magnitud monetaria | Ningún dato de los scripts es dinero |
| Capacidades y stock **no son insumo** (RF027) | `capacidad_*` y `nivel_stock_actual` no pueden influir en el desempeño generado |
| Solo `Vendedor` tiene datos reales (Olist) | El resto de los tipos es conceptual; los perfiles se documentan como tales |
| `StabilityCheck` **no es una tabla** (decisión 14 / C4) | El veredicto del CUSUM no se guarda en una entidad nueva |
| Multi-tenant | Toda escritura filtra por la organización de la sesión y exige `chain:write` |
| El motor y `tabla_k` no se tocan | El plan no modifica `simulate.ts` ni la metodología pendiente |

## 3. Restricciones técnicas

- **Vercel no sostiene un proceso continuo.** Los "ticks de 1 segundo" del spec no pueden correr en el servidor:
  el monitoreo vivo tiene que ser **manejado por el cliente** (el navegador pide una semana nueva por segundo).
- **El plan Hobby limita las funciones a 300 s,** y SSE de larga duración no encaja. Se descarta SSE.
- **La base (Neon) está en São Paulo y las funciones también (`gru1`):** cada consulta tarda unos 10 ms, así que
  un tick por segundo es viable.
- **`.env.local` apunta a la rama `production` de Neon.** Desarrollar esto escribe cadenas y filas de desempeño,
  así que hay que resolverlo antes de empezar (ver "Prerrequisitos").

## 4. Diseño: los scripts

Todo el núcleo se escribe como **funciones puras** (sin base de datos), en `src/lib/domain/synthetic/`. Así se
prueban solas y las usan por igual el seed, la API y los scripts de mantenimiento. La base solo entra en la capa de
ingesta.

### Script 1: perfiles por tipo de nodo (`node-profiles.ts`)

Define cómo "se comporta" cada tipo. Cada nodo toma su personalidad dentro de un rango de su tipo, sorteado con una
semilla derivada del propio id del nodo (`hashSeed(nodeId)`): **reproducible y sin ids escritos a mano**.

| Tipo | Nivel medio (%) | Volatilidad (σ) | Fuente |
|---|---|---|---|
| Proveedor | 90–94 | 6–8 | conceptual |
| Fabrica | 91–95 | 5–7 | conceptual |
| Almacen | 93–96 | 4–6 | conceptual |
| **Vendedor** | 88–92 | 8–11 | **a calibrar con Olist** |
| Cliente | 96–97 | 3–4 | conceptual |

Los rangos salen de los valores que ya usaba el seed, para que la demo se vea igual. Además cada perfil lleva una
persistencia semanal baja (0,3) y una probabilidad chica de "semana mala" (caída brusca aislada).

### Script 2: generador de serie (`generate-series.ts`)

`generateSeries({ nodeId, nodeType, weeks, endWeek })` devuelve los `valor_real` semanales:

- proceso AR(1) alrededor del nivel del nodo, más ruido, más semanas malas ocasionales, recortado a [0, 100];
- **determinístico**: la misma semilla da la misma serie;
- opción `levelShift { week, size }`: desplaza el nivel desde una semana. Existe para poder **demostrar la alerta
  del CUSUM** con datos creíbles (sin ella el CUSUM nunca encontraría nada en datos estacionarios).

### Script 3: estimador de línea base (`estimate-baseline.ts`)

`estimateBaseline(history)` devuelve `{ baseline, lower, upper }` usando **únicamente** el historial del nodo:

- línea base = media recortada de la ventana de entrenamiento (para que una semana mala no la contamine);
- banda = intervalo de confianza del 90 % de esa media (`±t·s/√n`), es decir la incertidumbre de la estimación,
  que es lo que RF012 pide que barran las réplicas;
- es **el reemplazo provisorio del microservicio de ML** (Fase 5): la firma queda estable y el ML real se
  enchufa después sin tocar a los demás.

`buildRows(...)` arma las filas completas aplicando la línea base congelada a toda la serie y calculando el déficit
(nunca negativo).

### Script 4: detector de estabilidad CUSUM real (`cusum.ts`)

`detectStability(series)` implementa un CUSUM de dos colas sobre la serie estandarizada con la ventana de
entrenamiento. Devuelve si hay alarma y la **semana estimada del cambio**.

- **Un solo código, dos usos:** lo corre la ingesta al cargar una cadena (decisión 14) y lo recalcula el snapshot
  al abrir la app. Como es una función pura de los datos, **no hace falta una tabla**: el veredicto se deriva.
  Eso además arregla que hoy solo aparezca en cadenas de la sesión.
- **Veredicto por cadena:** `estable` o `alerta`, con la semana del primer cambio y cuántos nodos alertaron.
- **Calibración, no a ojo:** los umbrales (`k`, `h`) se fijan con una simulación de Monte Carlo en los tests.
  Objetivo: falsas alarmas ≤ 0,2 % por serie de nodo. Hace falta ser tan estricto porque una cadena de 50 nodos hace
  50 pruebas a la vez; con 5 % por nodo, casi toda cadena grande saldría "en alerta" sin motivo.
- **Detección:** un salto de ≥ 1,5 σ tiene que alarmar en un máximo de 6 semanas, también verificado en los tests.

### Script 5: pipeline de ingesta (`src/lib/ingestion/ingest-history.ts`)

Es el contenedor "Pipeline de ingesta" de la arquitectura C4. `ingestChainHistory(tx, chainId, options)`:

1. detecta los nodos de la cadena **sin historial**;
2. por cada uno: genera la serie, estima la línea base y arma las filas;
3. corre el CUSUM y arma el veredicto;
4. inserta en lotes (límite de parámetros de Postgres) y respeta el índice único `(nodo_id, semana)`;
5. devuelve las filas y el veredicto.

Se invoca desde:

- **`POST /api/cadenas`:** dentro de la **misma transacción**. O queda la cadena con historial, o no queda nada.
  La respuesta suma `weeklyPerformance` y `stability`, y el store los incorpora sin recargar.
- **`POST /api/cadenas/[id]/nodos`:** al agregar un nodo suelto, le genera su serie.
- **`scripts/backfill-history.ts`:** para las cadenas ya existentes que quedaron sin datos.

Todo sigue el patrón de las demás rutas: `requireApiMember("chain:write")`, acceso con `findVisibleChain`, esquema
Zod, y nunca una organización tomada del body.

### Script 6: avance semanal, el "monitoreo vivo" (`advance-week.ts`)

Es lo que hace que el Digital Twin se mueva. `POST /api/cadenas/[id]/avance` con `{ weeks }` (máximo 8):

- toma el estado de la última fila de cada nodo y **continúa su proceso** (la AR(1) sigue donde quedó);
- **copia la línea base y la banda congeladas**: no se recalculan;
- calcula el déficit de cada semana nueva y la inserta, con `onConflictDoNothing` para que un doble clic no duplique;
- devuelve las filas nuevas para que el cliente actualice el canvas.

En el cliente: un control **▶ Tiempo real** en la pantalla de la cadena, con pausa, velocidad (1 semana por
segundo por defecto, como dice el spec) y "reiniciar". El canvas ya sabe colorear por el último déficit
(`latestDeficitByNode`), así que los nodos cambian de color solos mientras avanza.

### Script 7 (opcional): inyección de incidente

Un parámetro del avance que hunde la serie real de un nodo desde cierta semana. Sirve para mostrar en una demo "el
monitoreo detecta una disrupción real y de ahí armo la simulación". **Recomiendo dejarlo afuera** salvo que lo
necesiten para la defensa: no está pedido y suma superficie.

## 5. Plan de ejecución

Cada fase termina en algo que corre y se prueba antes de pasar a la siguiente.

| Fase | Contenido | Tamaño | Verificación |
|---|---|---|---|
| **0. Prerrequisitos** | Rama `dev` de Neon para `.env.local`; instalar Vitest; confirmar decisiones de la sección 7 | S | `npm run test` corre |
| **1. Núcleo puro** | Scripts 1 a 4 en `domain/synthetic/` con sus tests | M | Tests: determinismo, límites [0,100], déficit ≥ 0, banda contiene la línea base, **la línea base no cambia si cambian otros nodos o las capacidades (RF017)**, Monte Carlo del CUSUM |
| **2. Ingesta** | Script 5; enganchar `POST /api/cadenas` y `POST nodos`; el store incorpora los datos; `backfill-history.ts`; el seed pasa a usar el generador | M | Crear cadena desde plantilla: tiene historial, canvas y gráfico poblados, una simulación da resultados no vacíos; falla simulada = no queda nada; aislamiento entre organizaciones |
| **3. C24 real** | Reemplazar `launchIngestionCheck`; veredicto derivado en el snapshot; insignia en `/cadenas` y en la pantalla de la cadena para todas las cadenas; **rehacer la insignia "estable"** (hoy es `promedio de déficit < 2`) | S–M | Cadena estacionaria: estable. Con `levelShift`: alerta con la semana correcta |
| **4. Monitoreo vivo** | Script 6; control ▶ Tiempo real; ventana de las últimas N semanas en el snapshot | M | 20 avances seguidos: sin duplicados, línea base idéntica, los nodos cambian de color, un doble clic no rompe |
| **5. Cierre** | Documentación (`CLAUDE.md`, `pendientes.md`, `modelo-datos.md`), pruebas de punta a punta en el navegador, medición de la ingesta con 50 nodos | S | Los checks de arriba pasan; `tsc` y `eslint` limpios |

El script 7 (incidentes) queda como Fase 6 opcional.

## 6. Riesgos y cosas que ya sé que van a pasar

1. **La insignia "estable" se rompe si no se toca.** Hoy marca estable si el déficit promedio de todas las filas es
   menor a 2. Con una línea base estimada, el déficit natural de una semana ruidosa ronda el 40 % de σ, así que casi
   toda cadena saldría "inestable". La Fase 3 la redefine sobre las últimas semanas contra la banda.
2. **Cambiar el seed no cambia lo ya guardado.** Las `tabla_k` de los escenarios demo salieron del historial viejo.
   Por eso **no voy a re-sembrar** la organización demo de producción: borraría los escenarios que ya existen.
   El nuevo generador aplica a cadenas nuevas y al backfill. Esto está ligado al bug ya registrado en
   `pendientes.md` de que las curvas se recalculan con la cadena actual.
3. **El tiempo simulado puede pasar de hoy.** Si cada tick es una semana, tras unos avances las fechas quedan en el
   futuro respecto del calendario real. Propongo mostrarlas como "fecha simulada" y dejarlo así.
4. **Crece la tabla.** Cada avance suma una fila por nodo. El snapshot hoy carga todo; en la Fase 4 se limita a las
   últimas 52 semanas por nodo.
5. **Dos piezas son decisiones de metodología,** como lo fueron `tabla_k` y el piso de propagación: el estimador de la
   línea base y los parámetros del CUSUM. Las implemento con valores estándar, marcadas como provisorias, y no las
   doy por validadas. Quedan registradas en `pendientes.md` para que Facu las revise.

## 7. Decisiones que necesito de vos

Si no decís nada, uso lo que figura como **predeterminado**.

1. **Alcance.** Predeterminado: **fases 0 a 5** (todo menos incidentes). Si preferís algo más acotado, el mínimo
   que arregla el problema de fondo (cadenas nuevas sin datos) es **fases 0, 1 y 2**.
2. **Rama de desarrollo en Neon.** Es una tarea de dos minutos tuya: crear una rama `dev` en Neon y pasarme la
   cadena de conexión para `.env.local`. Predeterminado: **sí**. Si no, trabajo con una organización de prueba y la
   borro al final, pero eso toca la base real.
3. **Calibración de `Vendedor` con Olist.** El Preliminar E50 §4.1 caracteriza el dataset. Si me pasás la media y la
   dispersión de la tasa de entregas a tiempo por vendedor, calibro ese perfil con datos reales. Predeterminado:
   **uso el rango actual (88–92, σ 8–11) y lo marco "a calibrar"**.
4. **Duración del historial.** Predeterminado: **20 semanas**, de las cuales 16 entrenan la línea base y el CUSUM.
   Hoy son 16 en total.
5. **Cambio estructural a pedido.** Predeterminado: **sí**, un interruptor en el formulario de nueva cadena
   ("historial con un cambio de nivel") para poder mostrar la alerta del CUSUM en la defensa. Sin él, todas las
   cadenas salen "estables".
6. **Fechas del monitoreo vivo.** Predeterminado: **semanas simuladas que pueden pasar de hoy.**
