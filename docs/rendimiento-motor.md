# Rendimiento del motor de simulación

> **Nota (octubre de 2026):** este documento mide el motor anterior (recorrido de caminos con poda por dominancia). El
> motor actual propaga con una recurrencia semanal (`docs/definiciones-motor.md`) y es mucho más liviano: con
> `scripts/bench-engine.ts --quick`, 300 nodos conectados todos con todos y 16 semanas tardan 0,25 s (antes 4,7 s), y
> una red en capas de 300 nodos con 52 semanas, 0,23 s. `MAX_SIMULATION_WORK` se recalibró a 1.000 M de unidades. Las
> cifras de abajo ya no valen para el código actual; quedan como registro del hallazgo y del arreglo.

Respuesta al pedido "Prueba de rendimiento del motor": hasta cuántos nodos corre el motor sin romperse y cuánto cuesta
una ejecución, para fijar el tope de nodos de Max y el costo de cada tier.

- **06/10/2026:** primera medición. Encontró el bug de rendimiento del Hallazgo 1.
- **07/10/2026:** el bug está arreglado y todo se volvió a medir. Los números de este documento son los de
  **después** del arreglo; los de antes quedan en "Historial: antes del arreglo".

Se mide con `scripts/bench-engine.ts` (`npx tsx scripts/bench-engine.ts`).

> **Actualización 12/10/2026:** la medición dentro de Vercel está en `docs/rendimiento-motor-vercel.md`. Dos
> correcciones a lo que dice este documento: el plan es **Hobby**, así que `maxDuration` quedó en **300 s** (no 800),
> y `MAX_SIMULATION_WORK` bajó a **50 M** unidades. Los números de este documento son de una Apple M4; en Vercel el
> motor es ~3,3× más lento.

## Resumen

1. **El arreglo del Hallazgo 1 está implementado y da el mismo resultado bit a bit.** Se verificó en 2000 redes
   aleatorias (ver "Cómo se verificó").
2. **El costo del motor ahora crece de forma lineal con N y ya no depende de la forma de la red.** Ejemplos:
   - La red más interconectada que permite el modelo, con 300 nodos, tarda 0,26 s. Antes, una de 26 nodos pasaba
     los 120 s.
   - Una red densa de 2000 nodos tarda 2,4 s (antes, 25 s).
3. **Desde el motor, N = 300 es un tope de Max holgado:** 0,36 s y 0,15 GB en el peor caso realista. El peor caso
   posible (300 nodos conectados todos con todos y 20 eventos) tarda 4,7 s. Las dos cifras quedan muy lejos del
   criterio de usar como máximo la mitad del límite de tiempo y el 70 % de la memoria.
4. **Las dos salvaguardas están puestas:**
   - `maxDuration = 800` en las dos rutas que corren el motor;
   - un control previo que rechaza con un mensaje claro (HTTP 422) una corrida que se estime demasiado cara, antes
     de correrla.
5. **La fila de `RESULTADO` pesa ~0,9 KB y no depende de N.** Sigue vigente el Hallazgo 3, por si se decide
   guardar las curvas por nodo.
6. **Los números son de una máquina local, no de Vercel.** Para fijar el tope con números de producción falta
   medir en el despliegue (ver "Qué falta").

## Los cuatro números para el cálculo de costo

Red densa (4 proveedores por nodo), horizonte de 52 semanas, 30 réplicas, evento que llega a toda la red. Es el
peor caso realista. Mediana de 5 repeticiones, todas OK.

| | N = 6 | N = 40 | N = 300 (propuesta de tope de Max) |
|---|---|---|---|
| CPU activa (s) | 0,027 | 0,081 | 0,423 |
| Memoria pico (GB) | 0,097 | 0,108 | 0,153 |
| Tiempo de instancia (s) | no medible local (ver abajo) | ídem | ídem |
| Fila RESULTADO (KB) | 0,85 | 0,87 | 0,89 |

- **Memoria:** es casi toda el piso fijo de Node (~90 MB). El cálculo en sí agrega entre 1 y 40 MB.
- **Tiempo de instancia:** es como mínimo el tiempo del motor, más las consultas a Neon (6 a 8 idas y vueltas por
  corrida), la autenticación y el arranque en frío. Solo se puede medir en Vercel.
- **El tope de 300 sale del motor.** Antes de fijarlo conviene revisar dos cosas que crecen con N y no son el
  motor:
  - el canvas de React Flow con 300 nodos en el navegador;
  - el snapshot que el layout carga entero en cada página (ver `pendientes.md`).

## Resultados completos (después del arreglo)

### Red densa, horizonte 52: lo que pide la prueba y más arriba

| N | Corridas OK | Tiempo mediana (s) | Tiempo peor (s) | CPU (s) | RSS pico (MB) | Fila RESULTADO (KB) | Resultado |
|---|---|---|---|---|---|---|---|
| 6 | 5/5 | 0,016 | 0,016 | 0,027 | 97 | 0,85 | OK |
| 40 | 5/5 | 0,059 | 0,086 | 0,081 | 108 | 0,87 | OK |
| 150 | 5/5 | 0,189 | 0,192 | 0,233 | 129 | 0,88 | OK |
| 300 | 5/5 | 0,362 | 0,394 | 0,423 | 153 | 0,89 | OK |
| 600 | 5/5 | 0,706 | 0,738 | 0,791 | 175 | 0,90 | OK |
| 1000 | 5/5 | 1,179 | 1,187 | 1,297 | 208 | 0,91 | OK |
| 2000 | 5/5 | 2,367 | 2,443 | 2,523 | 287 | 0,92 | OK |

No hay punto de quiebre hasta N = 2000. Al ritmo de ~1,2 ms por nodo, el límite de 800 s quedaría en el orden de
cientos de miles de nodos.

### Red en capas (2 proveedores por nodo)

| N | H = 16: tiempo (s) | H = 16: RSS (MB) | H = 52: tiempo (s) | H = 52: RSS (MB) |
|---|---|---|---|---|
| 6 | 0,010 | 97 | 0,016 | 95 |
| 40 | 0,025 | 97 | 0,057 | 108 |
| 150 | 0,070 | 108 | 0,190 | 130 |
| 300 | 0,130 | 130 | 0,360 | 147 |
| 600 | 0,252 | 142 | 0,701 | 173 |
| 1000 | 0,409 | 157 | 1,173 | 204 |
| 2000 | 0,817 | 202 | 2,341 | 278 |

### La red que antes colgaba el motor

Cada nodo apunta a todos los posteriores, horizonte de 16 semanas, 3 repeticiones:

| N | Antes (s) | Después (s) | RSS después (MB) |
|---|---|---|---|
| 14 | 0,314 | 0,015 | 97 |
| 18 | 1,575 | 0,017 | 96 |
| 22 | 26,706 | 0,019 | 96 |
| 24 | 70,139 | — | — |
| 26 | **timeout (> 120 s)** | 0,022 | 95 |
| 50 | **timeout (> 120 s)** | 0,036 | 100 |
| 100 | — | 0,067 | 118 |
| 150 | — | 0,111 | 136 |
| 300 | — | 0,264 | 201 |

### El peor caso posible que hoy admite el modelo

Medido aparte, con una sola corrida:

| Red | Aristas | Eventos | H | Tiempo (s) |
|---|---|---|---|---|
| 300 nodos, cada uno conectado con todos los demás en ambos sentidos (con ciclos) | 89.700 | 1 | 52 | 0,60 |
| ídem | 89.700 | 20 (el máximo que acepta la API) | 52 | 4,69 |

## Qué se cambió

### El arreglo (Hallazgo 1)

`spreadEvents` en `src/lib/domain/simulate.ts` propaga cada evento con un BFS. Antes encolaba una entrada por cada
camino que llegaba a un nodo. Ahora **descarta las llegadas dominadas**: una llegada se descarta si al mismo nodo
ya llegó otra, del mismo evento, que cumple las tres condiciones:

- llegó antes o al mismo tiempo,
- con magnitud mayor o igual, y
- en la misma cantidad de saltos o menos.

Una llegada dominada no cambia nada:

- **en el nodo**, porque el motor se queda con la caída máxima ya vigente;
- **aguas abajo**, porque todo lo que propague está dominado de la misma forma, incluidos los cortes por piso de
  magnitud y por tope de saltos;
- **en el retraso mínimo de cada nodo**, que es lo que usa el escalón de reconfiguración.

La poda se hace **por evento de origen**, porque ese retraso se mide contra la fecha de cada evento.

**Por qué no alcanza con "no volver a expandir un nodo ya alcanzado".** El BFS procesa por cantidad de saltos, no
por fecha de llegada. La primera llegada a un nodo puede ser la más tardía o la más débil. Se probó: un registro de
visitados plano cambia el resultado en **135 de 600** redes aleatorias. La poda por dominancia, en **0 de 2000**.

### Cómo se verificó que el resultado no cambió

`scripts/verify-engine-equivalence.ts` corre el motor actual y una versión anterior extraída de git
(`--ref=<commit>`, por defecto `HEAD`) sobre las mismas redes aleatorias y con la misma semilla. Después compara
la salida completa (`tabla_k`, déficit total y las curvas de cada nodo) bit a bit.

- **Redes cubiertas:** en capas, densas, completas, estrella, línea y aleatorias con ciclos.
- **Variaciones:** 1 a 3 eventos por escenario, magnitudes al borde del piso del 3 %, nodos sin historial,
  tránsitos que redondean distinto, horizontes de 1 a 52 semanas, y corridas con y sin reconfiguración.
- **Resultado:** 2000 casos, 0 diferencias.

Conviene volver a correrlo ante cualquier cambio de rendimiento del motor.

### Las salvaguardas

1. **`maxDuration = 800`** en `POST /api/escenarios` y `POST /api/escenarios/[id]/corridas`. 800 s es el máximo del
   plan Pro de Vercel; si el proyecto queda en un plan con un máximo menor, hay que bajarlo.
2. **Control previo de trabajo.**
   - `estimateSimulationWork` (en `simulate.ts`) propaga una sola vez con la fracción máxima del rango, que es el
     peor caso entre réplicas, y estima el costo de la corrida sin correrla.
   - `runScenarioOnChain` rechaza la corrida si el estimado supera `MAX_SIMULATION_WORK` (100 M unidades, en
     `src/lib/simulation/run-scenario.ts`).
   - Las rutas responden **422** con el mensaje: *"Esta simulación es demasiado grande para correrla: la red está
     muy interconectada para la cantidad de eventos y el horizonte elegidos. Probá con menos eventos o un horizonte
     más corto."* La app lo muestra como aviso y revierte el escenario.
   - **Calibración:** localmente cada unidad cuesta entre 74 y 730 ns según la topología. 100 M unidades son como
     mucho ~75 s en esa máquina y ~220 s con una CPU hasta 3 veces más lenta: por debajo de la mitad de 800 s.
   - **Hoy no se dispara:** con los límites actuales (50 nodos, 20 eventos, 52 semanas, 30 réplicas) el peor caso
     es ~3 M unidades. Protege para cuando suba el tope de nodos por plan o las réplicas (200–300, C36): una red de
     500 nodos todos con todos y 20 eventos (165 M) se rechaza.
   - **Probado de punta a punta** contra las dos rutas reales, bajando el tope temporalmente: las dos respondieron
     422 y no se escribió nada en la base.

## Cómo se midió

- **Qué se mide:** solo `runScenarioSimulation`, el cálculo puro. No incluye leer la cadena de la base, escribir el
  resultado, autenticación ni el arranque en frío.
- **Aislamiento:** cada corrida va en un proceso aparte, para medir la memoria pico sin arrastre. Tiene un timeout
  de 120 s, así que una corrida que se cuelga queda registrada como `timeout` en vez de colgar la prueba.
- **Peor caso:** evento de magnitud 100 % sobre el nodo raíz, en redes armadas para que la propagación llegue a
  todos los nodos (la columna "Nodos alcanzados" del script lo confirma en cada fila).
- **Réplicas:** 30, el valor actual.
- **Horizonte:** 16 semanas (típico) y 52 (el máximo del formulario).
- **Máquina:** Apple M4, Node 22.14.
- **Columnas:**
  - **CPU:** segundos de CPU activa (usuario + sistema). El motor es de un solo hilo y no espera nada, así que
    CPU ≈ tiempo.
  - **RSS pico:** incluye los ~90 MB fijos de Node.

## Otros hallazgos (siguen abiertos)

### 2. El tope de 50 nodos de la API no cierra con los tiers

`MAX_NODES_PER_CHAIN = 50` (`src/lib/domain/types.ts`) se aplica en `POST /api/cadenas/[id]/nodos`. Para que Max
tenga 150 o 300, ese tope tiene que depender del plan de la organización. Hoy no existe ninguna entidad de plan o
suscripción en el modelo de datos.

### 3. La fila de `RESULTADO` no escala con N… todavía

Hoy la fila guarda solo `tabla_k` (10 filas), la semilla, las réplicas y la semana de reconfiguración: ~0,9 KB
fijos.

`pendientes.md` registra que las curvas se recalculan con la cadena *actual* y no con la de la corrida. Si eso se
resuelve guardando las curvas por nodo en el resultado, la fila pasa a pesar ~16 KB por nodo con H = 52: 2,4 MB
con N = 150 y 4,9 MB con N = 300, por corrida. La alternativa más liviana es guardar una copia de las *entradas* de
la corrida; hay que medirla antes de elegir.

### 4. El motor es puramente de CPU

En Vercel, la CPU activa de la simulación va a ser básicamente el tiempo del motor. El tiempo de instancia sin CPU
(que igual se cobra en memoria) va a venir de las consultas a Neon que rodean la corrida.

La pantalla de resultado también vuelve a correr el motor en el navegador (dos veces por visita). Después del
arreglo eso cuesta décimas de segundo incluso con 300 nodos.

## Qué falta para cerrar la prueba como se pidió

- **Medir en Vercel** cuando la app esté desplegada: CPU activa, memoria y duración desde el panel de
  Observability, corriendo `POST /api/escenarios` sobre cadenas sembradas de 6, 40 y 300 nodos. La CPU de Vercel
  suele ser más lenta por núcleo que un M4; cuánto, es lo que hay que medir.
- **Hacer que el tope de nodos dependa del plan** (Hallazgo 2).

## Historial: antes del arreglo (06/10/2026)

Mismo método, motor sin poda.

**Red densa, H = 52:**

| N | 6 | 40 | 150 | 300 | 600 | 1000 | 2000 |
|---|---|---|---|---|---|---|---|
| Tiempo (s) | 0,017 | 0,277 | 1,065 | 2,123 | 4,276 | 8,561 | 25,222 |

**Red completa, H = 16:**

| N | 6 | 10 | 14 | 18 | 20 | 22 | 24 | 26 | 50 |
|---|---|---|---|---|---|---|---|---|---|
| Tiempo (s) | 0,014 | 0,053 | 0,314 | 1,575 | 6,214 | 26,706 | 70,139 | timeout | timeout |

**Causa:** el BFS no podaba y encolaba una entrada por cada camino. Con el tope de 6 saltos, en una red muy
conectada la cantidad de caminos crecía de forma combinatoria. Cada 2 nodos más, el tiempo se multiplicaba por 3
o 4, y el límite de 800 s caía alrededor de N ≈ 28–30, con la API permitiendo 50.
