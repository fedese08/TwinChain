# Arreglo del bug de rendimiento del motor (Hallazgo 1): hecho

Respuesta al pedido "Arreglo pendiente: bug de rendimiento en el motor (Hallazgo 1)". Implementado y verificado el
07/10/2026. El detalle completo, con todas las tablas, está en `docs/rendimiento-motor.md`.

## Resumen

- **El arreglo está hecho y el resultado del motor es idéntico bit a bit al de antes.** Se verificó en 2000 redes
  aleatorias, con 0 diferencias.
- **El costo del motor ahora crece de forma lineal con la cantidad de nodos** y ya no depende de cuán interconectada
  esté la red:
  - La red de 26 nodos que antes pasaba los 120 s ahora tarda 0,02 s.
  - El peor caso posible con 300 nodos tarda 4,7 s.
- **Las dos salvaguardas también están puestas:** `maxDuration` y un control previo que rechaza las corridas
  demasiado caras.
- **Para el tope de Max:** desde el motor, 300 nodos queda muy holgado. Falta confirmarlo con una medición en Vercel
  y que el tope de nodos de la API deje de ser fijo (ver "Qué falta").

## Lo que se implementó

### 1. Poda de caminos dominados en el BFS

En `spreadEvents` (`src/lib/domain/simulate.ts`), una llegada a un nodo se descarta si al mismo nodo ya llegó otra,
del mismo evento, que cumple las tres condiciones:

- llegó antes o al mismo tiempo,
- con magnitud mayor o igual, y
- en la misma cantidad de saltos o menos.

La poda se hace por evento de origen: el retraso mínimo de cada nodo, que usa el escalón de reconfiguración, se
mide contra la fecha de su propio evento, y así tampoco cambia.

**Una diferencia con lo que planteaba el pedido.** El pedido proponía "dejar de expandir un nodo una vez que ya fue
alcanzado". Eso **no da el mismo resultado**: el BFS procesa por cantidad de saltos y no por fecha de llegada, así
que la primera llegada a un nodo puede ser la más tardía o la más débil. Se probó con un registro de visitados plano
y el resultado cambió en **135 de 600** redes aleatorias. Por eso se implementó la poda por dominancia, que corta lo
mismo cuando no importa pero conserva las llegadas que sí cambian el resultado.

**Sobre RF026.** Esa referencia no figura en ningún documento del repositorio, así que no se pudo contrastar contra
la fuente.

### 2. Verificación: resultado idéntico bit a bit

Se agregó `scripts/verify-engine-equivalence.ts`. El script corre el motor actual y una versión anterior extraída
de git sobre las mismas redes, con la misma semilla. Después compara la salida completa: `tabla_k`, déficit total y
las curvas de cada nodo, semana a semana.

| Prueba | Casos | Diferencias |
|---|---|---|
| Poda por dominancia (lo implementado) | 2000 | **0** |
| Registro de visitados plano (lo que proponía el pedido) | 600 | **135** |

- **Redes cubiertas:** en capas, densas, completas, estrella, línea y aleatorias con ciclos.
- **Variaciones:**
  - 1 a 3 eventos por escenario;
  - magnitudes al borde del piso del 3 %;
  - nodos sin historial;
  - horizontes de 1 a 52 semanas;
  - corridas con y sin reconfiguración.

La segunda fila confirma además que el verificador detecta cambios de verdad. Para volver a correrlo:

```bash
npx tsx scripts/verify-engine-equivalence.ts 2000
```

### 3. Salvaguarda: `maxDuration`

Se fijó `export const maxDuration = 800` en las dos rutas que corren el motor:

- `POST /api/escenarios`
- `POST /api/escenarios/[id]/corridas`

800 s es el máximo del plan Pro de Vercel. Si el proyecto se despliega en un plan con un máximo menor, hay que
bajar este valor.

### 4. Salvaguarda: control previo antes de correr

Se descartó validar solo el grado de salida o la cantidad de caminos, porque no reflejan el costo real: también
pesan la cantidad de eventos y el horizonte. En su lugar:

- **`estimateSimulationWork`** (en `simulate.ts`) estima el trabajo de la corrida **sin correrla**. Propaga una sola
  vez con la fracción de propagación máxima, que es el peor caso entre réplicas, y lo escala por las réplicas, las
  aristas recorridas y las semanas del horizonte.
- **`runScenarioOnChain`** (en `src/lib/simulation/run-scenario.ts`) rechaza la corrida si el estimado supera
  `MAX_SIMULATION_WORK` (100 M unidades).
- **Las rutas responden HTTP 422** con este mensaje, que la app muestra como aviso, y revierten el escenario:

  > Esta simulación es demasiado grande para correrla: la red está muy interconectada para la cantidad de eventos y
  > el horizonte elegidos. Probá con menos eventos o un horizonte más corto.

**Calibración.** Localmente, cada unidad cuesta entre 74 y 730 ns según la topología. 100 M unidades equivalen a
unos 75 s como máximo en esa máquina, y a unos 220 s si la CPU de Vercel fuera hasta 3 veces más lenta. Eso queda
por debajo de la mitad de los 800 s, que es el margen que pide el criterio del tope de Max.

**Cuándo se dispara:**

| Caso | Trabajo estimado | Resultado |
|---|---|---|
| 50 nodos todos con todos, 20 eventos, 52 semanas (el peor caso con los límites de hoy) | 3,0 M | corre |
| 300 nodos todos con todos, 20 eventos, 52 semanas | 63,2 M | corre (4,7 s medidos) |
| 500 nodos todos con todos, 20 eventos, 52 semanas | 165,3 M | **rechaza (422)** |

Con los límites de hoy (50 nodos, 20 eventos, 52 semanas, 30 réplicas) el control nunca se dispara. Protege para
cuando suba el tope de nodos por plan o las réplicas pasen a 200–300 (C36).

**Probado de punta a punta.** Se bajó el tope temporalmente y se llamó a las dos rutas reales con sesión iniciada.
Las dos respondieron 422 y no se escribió nada en la base: 4 escenarios y 5 corridas antes y después. El tope se
restauró al terminar.

## Lo que pedían de vuelta: números para recalcular el tope de Max

### Antes y después del arreglo

| Red | Antes | Después |
|---|---|---|
| 24 nodos, cada uno conectado a todos los siguientes | 70 s | 0,02 s |
| 26 nodos, ídem | timeout (> 120 s) | 0,022 s |
| 50 nodos, ídem (hoy permitida por la API) | timeout (> 120 s) | 0,036 s |
| 300 nodos, ídem | — | 0,26 s |
| 300 nodos, red densa, 52 semanas | 2,1 s | 0,36 s |
| 2000 nodos, red densa, 52 semanas | 25 s | 2,4 s |
| 300 nodos todos conectados con todos en ambos sentidos, 20 eventos, 52 semanas (el peor caso posible) | — | 4,7 s |

### Los cuatro números para el costo de cada tier

Medidos con el motor arreglado, sobre una red densa (4 proveedores por nodo), horizonte de 52 semanas y 30 réplicas.
Es el peor caso realista. Mediana de 5 repeticiones, todas OK.

| | N = 6 | N = 40 | N = 300 (propuesta de tope de Max) |
|---|---|---|---|
| CPU activa (s) | 0,027 | 0,081 | 0,423 |
| Memoria pico (GB) | 0,097 | 0,108 | 0,153 |
| Tiempo de instancia (s) | requiere Vercel | requiere Vercel | requiere Vercel |
| Fila en `RESULTADO` (KB) | 0,85 | 0,87 | 0,89 |

- **Memoria:** es casi toda el piso fijo de Node (~90 MB).
- **Tiempo de instancia:** es como mínimo el tiempo del motor, más las consultas a Neon, la autenticación y el
  arranque en frío.
- **Margen para Max:** con N = 300, el peor caso realista usa menos del 0,1 % del límite de 800 s, y el peor caso
  posible menos del 1 %.

## Qué falta para fijar el tope de Max

1. **Medir en Vercel** una vez desplegado. Los números de arriba son de una Apple M4, y la CPU de Vercel suele ser
   más lenta por núcleo. Esa medición también da el tiempo de instancia. Con esos datos conviene revisar
   `MAX_SIMULATION_WORK`.
2. **Hacer que el tope de nodos dependa del plan.** Hoy la API acepta como máximo 50 nodos por cadena para todas las
   organizaciones (`MAX_NODES_PER_CHAIN`), y el modelo de datos no tiene ninguna entidad de plan o suscripción.
3. **Revisar lo que crece con N fuera del motor** antes de cerrar en 300:
   - el canvas con 300 nodos en el navegador;
   - el snapshot que la app carga entero en cada página.

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/domain/simulate.ts` | Poda por dominancia en `spreadEvents`, cola con índice en vez de `shift()`, y `estimateSimulationWork` |
| `src/lib/simulation/run-scenario.ts` | `MAX_SIMULATION_WORK`, `SimulationTooLargeError` y el control previo |
| `src/app/api/escenarios/route.ts` | `maxDuration = 800` y respuesta 422 |
| `src/app/api/escenarios/[scenarioId]/corridas/route.ts` | `maxDuration = 800` y respuesta 422 |
| `scripts/verify-engine-equivalence.ts` | Nuevo: verificador de equivalencia contra cualquier versión de git |
| `scripts/bench-engine.ts` | Banco de pruebas, extendido a redes grandes |
| `docs/rendimiento-motor.md` | Informe actualizado con los números después del arreglo |
| `docs/pendientes.md`, `CLAUDE.md` | Lo resuelto se borró; se documentaron la poda y la verificación |
