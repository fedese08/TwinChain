# Rendimiento del motor medido en Vercel

Segunda parte de la prueba de rendimiento (la primera, en una máquina local, está en `docs/rendimiento-motor.md`).
Acá se mide **dentro de Vercel**, en el entorno de producción de `twinchain.vercel.app`. Medido el 12/10/2026.

## Resumen

1. **El motor corre unas 3 a 3,5 veces más lento en Vercel que en una Apple M4**, y el cálculo escala igual que
   en local. Con 300 nodos tarda entre 0,4 y 1,3 s según la forma de la red. El peor caso posible que admite el
   modelo (300 nodos todos con todos y 20 eventos) tarda 16 s, contra 300 s de límite.
2. **El tiempo que se factura casi no lo pone el motor: lo pone la distancia a la base.** Las funciones corrían en
   Washington (`iad1`) y la base de Neon está en São Paulo. Cada consulta tardaba ~230 ms y una simulación hace 7:
   **3,3 s de espera por simulación, contra 0,01 s de motor** en una cadena de 10 nodos.
3. **Pasar las funciones a São Paulo (`gru1`) lo bajó de 3,3 s a 0,1 s.** Es una línea en un `vercel.json` y ya
   está aplicada en producción. Sin eso, el tiempo de instancia de todos los tiers estaba inflado ~3 s.
4. **Con el plan Hobby, el máximo de una función es 300 s, no 800.** El primer deploy con `maxDuration = 800` falló
   en el build. Quedó en 300, y el tope de trabajo del control previo se recalibró con los datos de Vercel.
5. **Desde el motor, N = 300 es un tope de Max holgado:** 1,3 s en el peor caso realista y 0,27 GB, contra un
   criterio de 150 s y el 70 % de la memoria.
6. **La ruta de benchmark ya está borrada de producción.** No quedó nada guardado en la base.

## Entorno medido

| | |
|---|---|
| Plan de Vercel | **Hobby** (el build rechazó `maxDuration` mayor a 300) |
| Runtime | Node v24.21.0, 2 CPUs visibles por instancia |
| Región por defecto | `iad1` (Washington) |
| Región después del cambio | `gru1` (São Paulo), igual que la base de Neon (`sa-east-1`) |
| Reutilización de instancias | Sí: una misma instancia atendió decenas de requests seguidos |

## Cómo se midió

Se desplegó una ruta temporal, `/api/bench-motor`, protegida por un token del que el repositorio solo guardaba
el hash. Medía desde adentro de la función con `process.cpuUsage()`, `process.memoryUsage()` y `performance.now()`.
La ruta se borró al terminar.

- **Motor:** las mismas redes sintéticas del banco local (`scripts/bench-engine.ts`), generadas en memoria. El
  evento sale de la raíz y alcanza todos los nodos. 30 réplicas, **5 repeticiones** por caso, todas en la misma
  instancia en caliente, salvo la primera de cada tanda.
- **Base:** reproduce lo que hace `POST /api/escenarios` sobre una cadena real (la demo, 10 nodos): las mismas
  lecturas, el motor, y las tres escrituras (escenario, eventos y resultado) dentro de **una transacción que se
  revierte**. 8 repeticiones por región, y se descarta la primera para medir en caliente. En todas las corridas
  la comprobación posterior dio **0 filas sobrantes**.
- **Regiones:** la prueba de base se hizo en `iad1` y de nuevo en `gru1`. El motor se midió en las dos.

### Lo que esta medición no cubre

- **La base se midió con una cadena de 10 nodos,** no con una de 300. Crear una cadena de 300 nodos habría
  llenado la base de producción de datos de prueba. Con 300 nodos las lecturas traen ~4.800 filas de desempeño
  semanal; el costo extra no se midió y lo estimo en unas pocas decenas de milisegundos desde `gru1`.
- **No tengo acceso al panel de Vercel.** Los tiempos y el CPU son los que mide la propia función. Lo que Vercel
  factura (CPU activa y memoria aprovisionada por el tiempo de vida de la instancia) puede diferir un poco; se
  puede contrastar en *Observability → Functions*.
- **La memoria es RSS del proceso, y es acumulativa.** Node no devuelve memoria al sistema operativo entre
  requests, así que dentro de una instancia reutilizada el pico solo crece. Las cifras por N de abajo son el pico
  de esa instancia al terminar el caso, no el aporte exacto de cada uno.

## Resultados del motor

Medianas de 5 repeticiones. Idénticas en las dos regiones salvo ruido (el motor no hace red); se muestra `gru1`.
El tiempo de instancia con base está más abajo.

### Redes realistas

| Red | N | H (sem) | Motor, mediana (s) | Motor, peor (s) | CPU (s) | RSS pico (MB) | Fila RESULTADO (KB) |
|---|---|---|---|---|---|---|---|
| Densa (4 proveedores por nodo) | 6 | 52 | 0,025 | 0,068 | 0,027 | 107 | 0,84 |
| Densa | 40 | 52 | 0,191 | 0,206 | 0,205 | 161 | 0,87 |
| Densa | 150 | 52 | 0,622 | 0,692 | 0,630 | 251 | 0,88 |
| Densa | **300** | 52 | **1,268** | 1,289 | **1,291** | **266** | 0,89 |
| En capas (2 proveedores por nodo) | 300 | 16 | 0,417 | 0,475 | 0,420 | 268 | 0,86 |

### Las redes que antes colgaban el motor

| Red | N | H (sem) | Eventos | Motor, mediana (s) | RSS pico (MB) |
|---|---|---|---|---|---|
| Cada nodo apunta a todos los posteriores | 26 | 16 | 1 | 0,035 | 268 |
| ídem | 50 | 16 | 1 | 0,072 | 268 |
| Todos con todos en ambos sentidos (con ciclos) | 300 | 52 | 1 | 1,840 | 309 |
| ídem (**el peor caso posible** que admite el modelo) | 300 | 52 | 20 | **16,2** | 359 |

La red de 26 nodos que antes pasaba los 120 s hoy tarda 35 ms en Vercel.

### Comparación con la medición local

| Caso | Apple M4 | Vercel (`gru1`) | Factor |
|---|---|---|---|
| Densa, N = 6 | 0,016 s | 0,025 s | 1,6× |
| Densa, N = 40 | 0,059 s | 0,191 s | 3,2× |
| Densa, N = 300 | 0,362 s | 1,268 s | 3,5× |
| Todos con todos, N = 300, 20 eventos | 4,7 s | 16,2 s | 3,5× |

## Tiempo de instancia: el efecto de la región

Una simulación completa hace 7 pasos contra la base. Medianas en caliente, en segundos, sobre la cadena demo:

| Paso | `iad1` (Washington) | `gru1` (São Paulo) |
|---|---|---|
| 1. Usuario de la sesión (incluye abrir la conexión) | 1,157 | 0,047 |
| 2. Acceso a la cadena | 0,231 | 0,006 |
| 3. Leer nodos | 0,230 | 0,007 |
| 4. Verificar el nodo afectado | 0,229 | 0,007 |
| 5. Leer aristas y desempeño | 0,572 | 0,016 |
| 6. Motor | 0,007 | 0,011 |
| 7. Transacción de escritura (revertida) | 0,919 | 0,026 |
| **Tiempo dentro de la función** | **3,575** | **0,122** |
| Tiempo medido desde el cliente (incluye red hasta Vercel) | 3,789 | 0,314 |

- **Cada consulta costaba ~230 ms en `iad1`** (la ida y vuelta Washington ↔ São Paulo), contra 6 a 16 ms en
  `gru1`. El paso 1 vale 1,1 s porque abre una conexión nueva y eso son varias idas y vueltas más.
- **Es tiempo muerto facturado:** la función espera sin usar CPU (0,05 s de CPU en ambas), pero la instancia sigue
  viva y se cobra su memoria. Por eso 3 s de espera pesan más en el costo que 1,3 s de cálculo.
- **El cambio es una línea:** `vercel.json` con `"regions": ["gru1"]`. En el plan Hobby se puede elegir una sola
  región, y es suficiente.

### Arranque en frío

La primera invocación de una instancia nueva tardó **~0,7 s más** que una en caliente (0,87 s contra 0,11–0,18 s
medido desde el cliente). Ocurre al desplegar, tras un rato sin tráfico y al escalar a una instancia nueva.

## Los cuatro números por tier

Configuración medida y desplegada: `gru1`, 30 réplicas, red densa de 52 semanas (el peor caso realista), un
evento. **Tiempo de instancia** = 0,11 s de base y autenticación (medidos) + el tiempo del motor. No incluye el
arranque en frío.

| | N = 6 | N = 40 | N = 300 (propuesta de tope de Max) |
|---|---|---|---|
| CPU activa (s) | 0,06 | 0,24 | 1,32 |
| Memoria pico (GB) | 0,11 | 0,16 | 0,27 |
| Tiempo de instancia (s) | 0,14 | 0,30 | 1,38 |
| Fila RESULTADO (KB) | 0,84 | 0,87 | 0,89 |

- **CPU activa** = CPU del motor (medida) + 0,03 s del resto de la petición (medido sobre la cadena demo).
- **Si las funciones siguen en `iad1`**, sumar ~3,3 s al tiempo de instancia de todos los tiers: 3,5 s / 3,6 s /
  4,7 s. Es la razón para dejar `gru1`.
- **Con arranque en frío**, sumar ~0,7 s en esa invocación.
- **El peor caso posible con 300 nodos** (todos con todos y 20 eventos): 17 s de CPU, 0,36 GB y ~17 s de
  instancia.
- **Memoria configurada de la función: no la pude verificar.** Está en *Settings → Functions* del proyecto. En
  Hobby, por lo que sé, es de 2 GB y 1 vCPU, pero hay que confirmarlo en el panel antes de calcular el 70 %.
  Con 2 GB, el peor caso medido (0,36 GB) usa el 18 %.

## El tope de Max

**Con los números de Vercel, 300 nodos cumple el criterio con mucho margen:**

| Criterio | Límite | Peor caso realista (N = 300) | Peor caso posible (N = 300, 20 eventos) |
|---|---|---|---|
| Tiempo: la mitad del máximo de la función | 150 s | 1,3 s | 16,2 s |
| Memoria: 70 % de lo configurado (si son 2 GB) | 1,4 GB | 0,27 GB | 0,36 GB |

Desde el motor, el tope podría ser bastante mayor. Antes de fijar 300 conviene revisar lo que crece con N y no es
el motor:

- el canvas de React Flow con 300 nodos en el navegador;
- el snapshot que el layout carga entero en cada página (ver `pendientes.md`);
- que el límite de nodos de la API (`MAX_NODES_PER_CHAIN = 50`) pase a depender del plan.

## Cambios que salieron de esta medición

| Cambio | Motivo |
|---|---|
| `maxDuration = 300` en las dos rutas de simulación (antes 800) | El plan Hobby no admite más; con 800 el build de Vercel falla |
| `MAX_SIMULATION_WORK` de 100 M a **50 M** unidades | Seguir por debajo de la mitad del nuevo límite (ver abajo) |
| `vercel.json` con `"regions": ["gru1"]` | Bajar el tiempo de espera a la base de 3,3 s a 0,1 s |
| Ruta `/api/bench-motor` borrada | Era temporal |

### Calibración del control previo con datos de Vercel

El control previo rechaza (HTTP 422) una corrida cuyo trabajo estimado supere `MAX_SIMULATION_WORK`. Con lo medido:

- El costo por unidad de trabajo varía unas 10 veces según la forma de la red: 0,26 µs en la red todos con todos
  (16,2 s para 63,2 M unidades) y 2,5 µs en la densa de 300 nodos (1,27 s para 0,5 M).
- Con el costo más alto, **50 M unidades son ~125 s: debajo de los 150 s** (la mitad de 300 s). Con el tope anterior
  de 100 M, el peor caso habría rondado los 250 s.
- **Consecuencia:** el control es conservador. La red de 300 nodos todos con todos y 20 eventos (63,2 M) **se
  rechazaría aunque en la práctica tarda 16 s**, porque el estimador no distingue entre redes baratas y caras por
  unidad. Con los límites actuales de la API (50 nodos) nunca se dispara, así que hoy no afecta a nadie. Si en
  algún momento molesta, el estimador puede refinarse con el grado de las aristas.

## Qué falta

1. **Contrastar con el panel de Vercel** (*Observability → Functions*): CPU activa, memoria y duración facturadas
   de estas pruebas. No tengo acceso a esa vista.
2. **Confirmar la memoria configurada** de las funciones (*Settings → Functions*).
3. **Medir la base con una cadena grande** cuando exista una de 150 a 300 nodos, para cerrar los 4.800 filas de
   desempeño que acá se estimaron.
4. **Que el tope de nodos dependa del plan** (hoy fijo en 50).
5. **Tener en cuenta que el plan Hobby de Vercel es para uso no comercial.** Si TwinChain va a cobrar tiers
   (Freemium, Pro, Max), el despliegue va a necesitar el plan Pro de Vercel; ahí `maxDuration` sube a 800 s y la
   calibración de arriba se puede relajar.
