# La duración de la disrupción no se supone: el déficit se sostiene hasta reconfigurar

Registro de decisión. Explica por qué la proyección semanal deja un nodo en déficit **indefinidamente** en vez de
hacerlo volver solo a la línea base, y por qué el comportamiento anterior estaba mal.

## Qué hacía antes

El motor mock (`src/lib/mock/simulate.ts`) tenía una constante `RECOVERY_SPAN_WEEKS = 6` y aplicaba una rampa de
recuperación lineal a cada evento:

```ts
const recovery = Math.max(0, 1 - weeksSinceOnset / RECOVERY_SPAN_WEEKS);
worstDrop = Math.max(worstDrop, event.magnitude * recovery);
```

Efecto: un corte de −45% en la semana 1 caía a −37% en la 2, a −30% en la 3… y en la semana 7 el nodo estaba de
nuevo en su línea base, sin que nadie hiciera nada. La disrupción se curaba sola.

## Por qué está mal

**1. Es una duración de entrada disfrazada de supuesto del motor.** La decisión estructural del proyecto es
explícita — de `docs/modelo-datos.md`:

> **La duración de una disrupción nunca es un dato de entrada.** No hay ningún campo "duración estimada" en ninguna
> entidad. Es la incógnita que el sistema resuelve, no algo que se carga.

Que la duración no esté en el formulario no alcanza si el motor la trae hardcodeada. `RECOVERY_SPAN_WEEKS = 6`
afirmaba que *toda* disrupción, de cualquier tipo y magnitud, en cualquier nodo, dura seis semanas. Es exactamente
la suposición que el modelo prohíbe, movida del formulario al código donde se ve menos.

**2. Vuelve trivial la pregunta que el sistema existe para responder.** Todo el aparato de `tabla_k` — barrer el
costo de reconfigurar k y devolver el umbral a partir del cual conviene reconfigurar — presupone que el déficit
*continúa* mientras no se actúe. Si el nodo se recupera solo en seis semanas, la respuesta correcta a cualquier
disrupción es "esperá, se arregla", el umbral pierde sentido y la recomendación del sistema es siempre la misma.
El resultado que producía era coherente internamente pero respondía una pregunta que nadie hizo.

**3. Contradice el único mecanismo de salida que el modelo reconoce.** RF022 / C23 definieron que la vuelta a la
normalidad ocurre por **reconfiguración**, y que esa transición es un escalón — con evidencia de entrevista
(Gustavo Gaspar: firmado el convenio, el proveedor alternativo opera al día siguiente). Si además existía una
recuperación espontánea gradual, el sistema tenía dos mecanismos de salida: uno documentado y defendido, y otro
inventado por el motor. El segundo además le robaba efecto al primero: la mitad de la mejora que mostraba una
reconfiguración era en realidad la rampa que ya venía corriendo por debajo.

**4. No tiene respaldo.** Ni las entrevistas ni los datasets ni ninguna decisión registrada sostienen una
recuperación lineal de seis semanas. Era un valor de relleno para que el gráfico del mock no quedara plano.

## Qué hace ahora

Una vez que el evento llega al nodo (después del onset, que en los nodos aguas abajo se retrasa según
`tiempo_transito`), la caída se mantiene en su magnitud completa hasta el fin del horizonte de proyección. El
déficit se acumula semana a semana y **no se corrige solo**.

Lo único que lo termina es aplicar la reconfiguración: en esa semana el déficit cae a cero de un salto (RF022), y
ese escalón se propaga aguas abajo con el retraso de tránsito de cada arista.

## Qué cambia en lo que se ve

- **Proyección semanal:** el nodo afectado queda en rojo hasta el final del horizonte, o hasta el escalón de
  reconfiguración. Ya no hay una curva que sube sola.
- **Déficit acumulado y `tabla_k`:** los valores son más altos, porque ahora el déficit se integra sobre todo el
  horizonte en vez de apagarse en la semana 6. Los umbrales se corren en consecuencia — no son comparables con los
  de corridas viejas.
- **El horizonte de proyección (H) pasa a importar de verdad.** Antes, cualquier H mayor a ~6 semanas daba el mismo
  déficit acumulado, porque el resto eran ceros. Ahora H define hasta dónde se acumula, que es justamente el rol que
  el modelo de datos le asigna: *"necesaria para que 'no existe umbral' tenga sentido como resultado acotado"*.
- **La reconfiguración se lee con claridad:** toda la diferencia entre reconfigurar y no reconfigurar es atribuible
  a la decisión, no a una recuperación de fondo.

## Qué NO cambia

La magnitud del evento, la propagación aguas abajo y su decaimiento por salto (RF027), las réplicas estocásticas
(RF023) y la forma del resultado como mediana + rango (RF029) quedan igual. Esto tocó únicamente cómo evoluciona la
caída en el tiempo dentro de un nodo ya alcanzado.

## Nota de alcance

`src/lib/mock/simulate.ts` sigue siendo un placeholder: el cálculo del déficit y del umbral no es la propuesta
metodológica de la tesis. Pero esta decisión no es del mock — **el motor real (Fase 4) tiene que respetarla igual**.
Si en algún momento aparece evidencia de que ciertos tipos de disrupción sí se resuelven sin intervención, eso no se
implementa como una constante global: sería un resultado del modelo, con su respaldo, y habría que registrarlo como
decisión nueva contra este documento.
