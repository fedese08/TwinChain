# Definiciones del motor de simulación

Respuestas de la tesis a las seis definiciones pendientes del motor, y cómo quedaron implementadas.
Fuente de las definiciones: texto del autor (octubre de 2026). Implementación: `src/lib/domain/simulate.ts`
(motor), `src/lib/domain/detection.ts` (entradas desde una alerta) y `src/lib/domain/k-table.ts` (constantes).
Pruebas: `src/lib/domain/simulate.test.ts` y `detection.test.ts`.

## Notación

```
s_r      semana de la decisión de reconfigurar
           simulación manual: la fecha de inicio del evento
           simulación desde una alerta: la semana siguiente a la detección
t        semanas transcurridas desde s_r (t = 1, 2, …, H)
H        horizonte de proyección, en semanas desde s_r (lo define el usuario, RF025)
i, j, o  nodos; o = nodo afectado (origen)
n_i      nivel normal del nodo i en la réplica (sorteado dentro de su banda, punto 5)
r_i(s)   desempeño del nodo i en la semana s bajo el escenario: observado en las pasadas, simulado en las futuras
d_i(s) = max(0, n_i − r_i(s)) / n_i     déficit del nodo i (RF013), como proporción de su nivel normal, entre 0 y 1
D_A(s) = Σ_i d_i(s)                     déficit total de la red si se mantiene la estructura (peso 1 por nodo)
D_B(s) = Σ_i d_i(s)                     déficit total de la red si se reconfigura en s_r (punto 4)
d0                                      déficit semanal del nodo afectado en régimen degradado (proporción)
k                                       costo de reconfigurar, en "semanas de operar como ahora"
K      = k · d0                         costo de reconfigurar, en unidades de déficit
```

## 1. Cómo se calcula el umbral

Pérdida evitable acumulada tras t semanas desde la decisión:

```
E(t) = Σ_{u=0..t−1} [ D_A(s_r + u) − D_B(s_r + u) ]
N(k) = min { t ∈ [1, H] : E(t) ≥ k · d0 }      "no cruza" si no existe tal t
k_max = E(H) / d0                               por encima de k_max no hay cruce
```

- N(k) no disminuye cuando k aumenta; k = 0 → N = 1; k > k_max → "no cruza" (nunca un número, ni 0 ni H).
- Por cada fracción de propagación `c` y cada réplica `j` hay una trayectoria E^{c,j}(t). Por cada `c` y cada `k` se
  reporta la mediana sobre `j` y el rango entre los percentiles 10 y 90. Las réplicas sin cruce se ordenan como +∞; si
  la mediana es +∞ se informa "no cruza" junto con el % de réplicas que sí cruzan.
- La tabla de resultados y la pantalla de recomendación usan la misma función (`thresholdAtK` / `shareWorthwhile`).

## 2. Semana mala equivalente

- Una semana mala es una semana con el nodo afectado en su nivel degradado actual. El costo de reconfigurar es
  `K = k · d0`.
- Entre nodos se suma el déficit de todos, incluido el propagado, con el mismo peso. Como el déficit es proporción del
  nivel normal de cada nodo, la suma no depende del volumen de cada nodo. No se pondera por tipo de nodo (simplificación
  declarada).

## 3. Propagación

```
d_j(s) = min( 1,  max( e_j(s),  max_{i→j} c · d_i(s − τ_ij) ) )
```

`τ_ij` es el tránsito de la arista i→j y `e_j(s)` el déficit propio de j por el evento (0 si no tiene).

- La fracción `c` se barre sobre un rango (RF027), es un supuesto sin calibrar y el umbral se reporta para cada valor.
- Un nodo que recibe déficit por varios caminos cuenta el mayor. Tope en 1. **Sin piso de propagación.**
- Los eventos no se apilan.

## 4. Reconfiguración

Escalón (RF022): desde `s_r` el nodo afectado rinde su nivel normal, `e_o(s) = 0` para `s ≥ s_r`. D_B se calcula con
la misma fórmula del punto 3. No hay pérdida de arranque ni rampa; el costo entra solo en `K`. El tránsito no agrega
espera al cambio: el déficit emitido por `o` antes de `s_r` sigue llegando aguas abajo, por eso D_B puede ser mayor que
0 aunque `d_o(s) = 0`.

## 5. Réplicas e incertidumbre

Cada réplica sortea el nivel normal `n_i^j` dentro de la banda de la línea base (RF023); queda fijo en el horizonte y es
el mismo para mantener y para reconfigurar. El rango reportado es p10–p90 (no mínimo–máximo, que crece con R).

Número de réplicas R: la menor R tal que, para los k reportados, `|mediana_R − mediana_{R/2}| ≤ 1 semana` y lo mismo
para p10 y p90. Hoy 30 por fracción para desarrollo y tests; el valor de producción (200–300) sigue sin confirmar.

Banda de incertidumbre: si la cobertura sobre semanas normales no vistas supera claramente el nivel nominal, se
recalibra el ancho en un paso posterior al entrenamiento (RF020) sin reescribir los registros (RF014); si es cercana, se
acepta y se declara. Reportar la cobertura antes de decidir.

## 6. Simulación desde la disrupción detectada

```
nodo         = o, el nodo alertado
inicio t0    = el "desde cuándo" que informa la alerta (HU2)
d0           = (1/m) · Σ_{s=t0..t_det} d_o(s)       con m = t_det − t0 + 1 semanas observadas, y n_o de cada réplica
s_r          = t_det + 1
horizonte H  = input del usuario
```

Las m semanas observadas son pasado: no entran en E(t) ni en el umbral. Persistencia total desde el inicio del desvío =
m + N(k). La línea base y la banda no cambian (RF014, RF017). Nada de esto modifica el registro de la operación real.

---

# Cómo quedó implementado

| Punto | Implementación |
|---|---|
| 1 Umbral | `crossingWeek(E, K)` y `thresholdAtK(curves, k, c)`. El motor guarda E(t) y d0 de cada réplica (`replicaCurves`), así que N(k) se calcula para cualquier k, no solo 1 a 10. La tabla guardada trae `K_MAX = 10` costos por cada fracción: 30 filas. |
| 2 Peso | `D(s) = Σ d_i(s)` sobre los nodos con historial. Los nodos en días llegan por `adaptForEngine` (línea base = 100); con el déficit normalizado esa escala se cancela. |
| 3 Propagación | Recurrencia semanal en vez de recorrido de caminos: `propagate()`. Sin piso de magnitud ni tope de saltos; termina con ciclos porque todo tránsito tarda ≥ 1 semana (`transitLagWeeks` = `max(1, round(días/7))`). |
| 4 Escalón | `reconfigure(from)` pone en 0 el golpe propio desde `s_r + w`. Con `w = 0` y sin semanas observadas D_B es cero y no se propaga. |
| 5 Réplicas | `PROPAGATION_FRACTIONS = [0.45, 0.55, 0.65]`; `replications` réplicas por fracción. Rango p10–p90. |
| 6 Alerta | `deriveAlertScenario` (nodo, t0, s_r, m, d0 puntual) y `observedForScenario` + `options.observed`/`decisionWeek` del motor. `escenarios.semana_decision` guarda s_r. Botón "Simular cómo sigue" en el inspector del nodo. |

## Diferencias con lo escrito

Estas son las diferencias entre las definiciones y lo que hace el motor. Las dos primeras responden a los "puntos a
confirmar contra la implementación" y NO se cambiaron:

1. **Qué sortea cada réplica.** Una sola posición `u ∈ [0, 1]` por réplica, uniforme, aplicada a TODOS los nodos
   (`n_i = banda_inferior_i + u · (banda_superior_i − banda_inferior_i)`), fija en todo el horizonte y compartida por
   mantener y reconfigurar (A y B se calculan dentro de la misma réplica). La recomendación del texto era un sorteo
   independiente por nodo; no se cambió. El motor anterior ya sorteaba una posición por réplica común a todos los nodos,
   pero mantener y reconfigurar eran corridas separadas con sorteos distintos.
2. **Magnitud del evento.** Es una **caída proporcional** del nivel normal: `r = n · (1 − magnitud/100)`, así que
   `e_o = magnitud/100`. Igual que antes.
3. **Consecuencia de 1 y 2:** con magnitud proporcional el nivel normal se cancela en el déficit
   (`d = (n − r)/n = magnitud/100`). En una **simulación manual el sorteo de la banda no mueve ningún resultado**: las
   réplicas de una misma fracción dan exactamente lo mismo y el rango p10–p90 de N(k) sale sin dispersión; la única
   variación entre réplicas es la fracción `c`, que se reporta por separado. El sorteo solo pesa en la simulación desde
   una alerta, donde el déficit observado se mide contra el `n` sorteado.
4. **Un evento por simulación.** Por decisión del usuario (23/10/2026) un escenario tiene un solo evento sobre un solo
   nodo, y la API y el formulario rechazan más de uno. (El E90, Flujo B / RF026, decía "al menos un evento, como máximo
   uno por nodo"; hay que alinear ese texto del documento.) El motor es más general que la entrada: acepta varios
   eventos y nodos, no apila los eventos de un mismo nodo (cuenta el mayor de los ya iniciados) y con varios nodos
   afectados "reconfigurar" devuelve a todos a su nivel normal.
5. **Semanas observadas.** El texto usa lo observado de todos los nodos antes de `s_r`. Se usa lo observado del nodo
   afectado (su déficit semana a semana y d0); lo que ya estaba en camino hacia el resto de la red se propaga desde ahí
   con la recurrencia, no se lee de las filas de los demás nodos.
6. **"Desde cuándo" (t0).** HU2 no fija la regla. Provisoria: primera semana de la racha de semanas por debajo de la
   línea base que termina en la última semana registrada, siempre incluyendo las últimas 3 y mirando como máximo 12 atrás.
7. **Tránsito en semanas.** Se redondea a la semana más cercana con un mínimo de una (la regla que ya tenía el motor).
8. **Fecha de la semana.** La aritmética de semanas es en UTC (`synthetic/weeks.ts`). El motor anterior usaba hora
   local y, en el navegador de una zona al oeste de UTC, movía una semana las fechas que caen en lunes.
9. **Cobertura del punto 5 (pendiente de decisión del autor):** ver abajo.

## Cobertura de las bandas (punto 5)

Medida con `scripts/measure-sensor-model.ts` (600 nodos simulados, semanas 5 a 28 que el modelo no vio, series estables):

| Banda | Cobertura de los valores semanales | Nominal |
|---|---|---|
| Del promedio (`banda_inferior/superior`), la que sortean las réplicas | **61,7 %** | 80 % |
| Semanal (`banda_semanal_*`), la que usa la alerta | **85,9 %** | 80 % |

La banda del promedio es un intervalo para la media, no para un valor semanal: queda por debajo del nominal, así que no
está sobredimensionada y no corresponde ensancharla ni achicarla. La semanal supera el nominal en 6 puntos (en Olist real
cubría 79,8 %). Con el criterio del texto ("claramente por encima → recalibrar; cercana → aceptar y declarar"), el
resultado actual es **aceptar y declarar**; la decisión final es del autor.
