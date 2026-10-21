# Alineación del E90 con la app

Criterio acordado: **el documento E90 manda**. Donde la app hace algo distinto de lo que el documento define, se ajusta la
app; el documento solo se toca para agregar lo que le falta (seguridad, prueba de carga, interpretabilidad, datos
simulados) o para corregir un dato que quedó impreciso. Estado al 21/10/2026. **Tanda 2 hecha** (filas 1 y 2: sensor por envío y CUSUM con calibración); falta lo demás.

Cada fila dice qué define el documento, qué hace la app hoy y qué hay que hacer en la app.

| # | El documento define | La app hoy | Qué hacer en la app | Tamaño |
|---|---|---|---|---|
| 1 | **[HECHO] Detección (RF018 a RF020, Flujo A, HU1, HU2).** Cada semana se compara el desempeño con la línea base fija y se obtiene el déficit y el **residuo con signo**. El residuo alimenta un **CUSUM**: mientras queda dentro del margen de la línea base no se acumula nada; cuando lo excede, suma; si el acumulado supera un **umbral calibrado**, se confirma la degradación sostenida y se **reinicia** el acumulado. El umbral se calibra **minimizando el costo operativo total en unidades de déficit acumulado**, sobre el modelo ya entrenado y en un paso separado del entrenamiento. La alerta dice **desde cuándo** y la **magnitud acumulada**, y el umbral es **configurable**. | La alerta semanal es una regla de banda (2 de 3 semanas por debajo = atención, 3 = crítico). El CUSUM que existe es retrospectivo y solo verifica la estabilidad del historial de entrenamiento. No hay alerta persistente con "desde cuándo" ni magnitud acumulada. No hay calibración por costo. | Implementar el CUSUM del Flujo A (con zona muerta dada por la banda, acumulación, confirmación y reinicio), derivado de las filas semanales; calibrar el umbral por costo en un paso aparte; mostrar la alerta con desde cuándo y magnitud; umbral configurable. | L |
| 2 | **[HECHO] Ingesta (RF009, RF010, RF011).** Se ingieren datos sintéticos **de forma continua, a nivel de envío individual**, simulando sensores IoT; se **agregan por semana** antes de cualquier análisis; la detección corre **una vez por semana al recibir el lote**. | El generador produce directamente el valor semanal del nodo y un volumen derivado; no hay envíos individuales ni paso de agregación. | Que el simulador de sensores emita envíos individuales (margen de cada envío), que la ingesta los agregue por semana (media y cantidad, que es justo lo que recibe el modelo) y que la detección corra sobre el lote semanal. | M |
| 3 | **Flujo B / RF026.** Un escenario tiene **al menos un evento sobre la red, como máximo uno por nodo**: pueden ser varios nodos. | Un escenario afecta un único nodo y admite varios eventos sobre ese nodo. El motor ya soporta varios nodos. | Permitir elegir varios nodos con un evento por nodo; validar "uno por nodo" en el formulario y en la API. | M |
| 4 | **Roles (casos de uso).** **Operador**: consulta la red, simula y ve resultados y alertas. **Administrador**: hereda lo del Operador y suma **gestionar usuarios y sus roles** y **modificar la estructura de la red**. | Roles Administrador (todo) y Visualizador (solo mira, no simula). No hay pantalla para gestionar usuarios ni roles. | Reemplazar Visualizador por Operador (consulta y simula, sin editar la red); crear la pantalla de usuarios y roles del Administrador. | M |
| 5 | **Arquitectura (4.4).** El motor de simulación corre **como job en segundo plano** dentro del monolito. | La simulación corre dentro del mismo pedido, de forma síncrona; la pantalla finge la espera. | Ejecutar la corrida en segundo plano (`after()` de Next.js): el pedido responde enseguida y la pantalla consulta hasta que el resultado esté guardado. | M |
| 6 | **HU5.** Por nodo, la serie histórica de desvíos y los **períodos marcados como degradación sostenida**; **comparar dos o más nodos** sobre el mismo período. | Hay un gráfico del desempeño por nodo. No marca períodos de degradación ni permite comparar nodos. | Marcar en el gráfico los períodos de degradación sostenida (sale del punto 1) y agregar la comparación de nodos. | M |
| 7 | **HU3.** Mostrar cómo evoluciona el **desvío acumulado y el estado de alerta** del nodo afectado a lo largo de los lotes simulados posteriores al evento. | El resultado muestra el déficit proyectado, pero no el desvío acumulado ni cuándo saltaría la alerta. | Aplicar el CUSUM del punto 1 a la serie proyectada y mostrar el acumulado y la semana en que se confirmaría (en el Detalle técnico). | M |
| 8 | **RF006.** Validar el desempeño del nodo **Vendedor contra datos reales del dataset Olist** (`seller_id`). | Ningún nodo usa datos reales. El camino con vendedores reales quedó inactivo. | Pendiente de decisión (ver abajo). | S a M |
| 9 | **Datasets.** Olist es la fuente de calibración (y el dataset debe traer episodios reales de degradación); DataCo es el dataset de estrés. | DataCo no se usa. | Pendiente de decisión (ver abajo). | M |

## Lo que ya coincide
RF001, RF003 a RF005, RF007, RF008, RF012 a RF017, RF021 a RF025, RF027 a RF031: tablas k con mediana y rango, réplicas,
escalón de reconfiguración, resultados sin sobrescribir, línea base congelada, déficit sin negativos y todo en unidades no
monetarias.

## Lo que el documento deja abierto (y la app no debería inventar)
- **RF019:** "minimizar el costo operativo total en unidades de déficit acumulado" no define el costo de una falsa alarma
  ni el de una detección tardía. Hay que fijar esa función de costo para calibrar.
- **HU2:** "desde cuándo se sostiene el desvío" no fija la regla; en el CUSUM sale natural: la semana en que empezó a
  acumularse.
- **RF006:** "validar contra datos reales" admite dos lecturas (ver decisión 8).

## Qué se agrega al documento (no cambia la app)
Prueba de carga, interpretabilidad del modelo (SHAP), seguridad y protección de datos, datos simulados, y la corrección del
campo de Olist que mide el modelo (margen de despacho, que es la parte de la demora atribuible al vendedor, como ya dice
el propio documento). Ya está redactado en `docs/e90-tecnologias-texto.md`; ese texto se va a ajustar a medida que la app
se alinee (por ejemplo, la sección de detección de cambios).
