# Consulta sobre el motor de simulación

Estado del código al 22/10/2026. Todo se resuelve en `src/lib/domain/simulate.ts`. Solo se reporta lo que hay; no se cambió nada.

## Punto 1 — Varios déficits que llegan a un mismo nodo

**Qué hace el código:** se toma el **mayor**, con tope de 1. Cada nodo recibe `max(golpe propio, c · déficit de cada nodo de entrada, con el retraso de tránsito de esa arista)` y el resultado se recorta a 1. No se suman, ni por varios caminos ni desde varios nodos. La fracción `c` es la misma para todas las aristas de una réplica y se barre en {0,45; 0,55; 0,65}.

**Archivo y función:** `src/lib/domain/simulate.ts:147`, `propagate` (el máximo en 156-159, el tope en 160).

**Difiere del diseño de referencia:** no.

## Punto 2 — Qué sortea cada réplica

**Qué hace el código:** cada réplica sortea **un solo número** `u ~ Uniforme[0, 1]` y lo aplica a todos los nodos. El nivel normal de cada nodo es `lowerBand_i + u · (upperBand_i − lowerBand_i)`, con la banda de su línea base (media de las últimas 4 semanas).

- Se sortea una vez por réplica, no una por nodo ni una por semana, y queda fijo en todo el horizonte.
- "Mantener" (A), "reconfigurar al decidir" (B) y la corrida que se muestra salen de la misma réplica, así que **comparten el mismo sorteo** (`level`).
- Cada fracción de propagación `c` tiene sus propias réplicas independientes.

**Archivo y función:** `src/lib/domain/simulate.ts:420-421` (sorteo, dentro de `runScenarioSimulation`). Mantener y reconfigurar usan el mismo `level` en 425 y 441-452.

**Difiere del diseño de referencia:** **sí**, en una cosa. El diseño pide un valor por nodo y por réplica; el código sortea un único `u` por réplica, común a todos los nodos (está declarado en `docs/definiciones-motor.md`, "Diferencias con lo escrito", punto 1).

Consecuencia: en una simulación manual no cambia el resultado, porque el déficit es una proporción del nivel normal y el nivel se cancela. Solo pesa en la simulación desde una alerta, donde el déficit observado se mide contra el nivel sorteado (líneas 427-428).

## Punto 3 — Magnitud del evento y cálculo del déficit

**Qué hace el código:** la magnitud es una **caída proporcional** del nivel normal, en % (1 a 100), no un nivel absoluto. El déficit propio del nodo es `min(1, magnitud / 100)`.

El déficit del motor está **normalizado entre 0 y 1** (proporción del nivel normal). Las unidades absolutas aparecen solo al mostrar: la proyección multiplica por el nivel sorteado (`deficit = level · share`).

En la simulación desde una alerta, el déficit observado de una semana es `min(1, max(0, normal − desempeño) / normal)`, que es la fórmula de referencia.

**Archivo y función:**
- `src/lib/domain/simulate.ts:388`: magnitud → déficit propio.
- `src/lib/domain/simulate.ts:428`: déficit observado normalizado.
- `src/lib/domain/simulate.ts:495-496`: paso a unidades absolutas, solo para mostrar.

**Difiere del diseño de referencia:** no. En una simulación manual el déficit no se calcula como `nivel normal − desempeño` sino directamente como `magnitud / 100`; da lo mismo porque el desempeño simulado es `n · (1 − magnitud / 100)`.

## Nota

`classifySeverity` (líneas 190-197) usa umbrales en unidades absolutas (8 y 2) para colorear los nodos en pantalla. No interviene en el cálculo del umbral N(k).
