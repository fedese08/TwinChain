# E90: qué corregir y agregar en "Tecnologías" (según el feedback del E50)

Fuentes: `Feedback_E50_SB16.pdf` (ítem **Tecnologías: No cumple**) y la sección 4.2 del documento E90 (Tablas 5 a 8).
Todo lo que se afirma abajo está verificado contra el código y los documentos del repositorio, salvo lo marcado
**[verificar]**. Los textos propuestos están en el tono del documento: tercera persona, voz impersonal, párrafos
cortos, sin primera persona.

## 1. Qué pidió el feedback y qué hay en el E90

El feedback marca seis observaciones. Resumen del estado:

| # | Observación del feedback | Estado en el E90 | Qué falta |
|---|---|---|---|
| 1 | Sin Load Testing del motor de simulación | Nada en el documento (0 menciones) | **Escribir**. La medición ya existe (`docs/rendimiento-motor.md` y `docs/rendimiento-motor-vercel.md`) |
| 2 | ML sin proceso de entrenamiento, features ni métricas; sin interpretabilidad (XAI) | Solo figura "scikit-learn" con "—" | **Escribir**. Los datos existen (bundle y `docs/modelo-ml.md`); la importancia de variables la calculé, SHAP no |
| 3 | Autenticación sin explicar cómo se protegen credenciales, acceso y sesiones; NextAuth con "—" | Una fila con guion | **Escribir** con lo que implementa la app |
| 4 | Sin cifrado en reposo ni normativa de secreto comercial; sin Ley 25.326 ni consentimiento | El **Marco normativo ya existe** (2.1, Ley 25.326 y 24.766), pero dice explícitamente que no describe cómo las cumple el sistema | **Enlazar**: falta el apartado que conecte la norma con las decisiones técnicas |
| 5 | El usuario no puede eliminar su cuenta y sus datos | La app **no lo implementa** (no hay endpoint) | **Decidir**: implementarlo (recomendado) o declararlo como limitación |
| 6 | Datos sintéticos sin explicar cómo se generan, proporción frente a reales, ni validación con datos reales | Solo RF009 y el cronograma | **Escribir** en 4.1 (Datasets) |

Además, las Tablas 5 a 8 tienen **12 celdas "Por qué se eligió" vacías ("—")**: Tailwind, Recharts, sonner,
lucide-react, NextAuth.js, Pandas, scikit-learn, joblib, Vercel, Render, GitHub Actions y Vitest. Un evaluador que
vio "—" en NextAuth y en scikit-learn lo usó como evidencia. Conviene llenarlas todas.

## 2. Inconsistencias entre el documento y la app que hay que resolver antes de entregar

Son cosas que un evaluador atento puede contrastar con la demo. No las arreglé; decidí dejarlas a tu criterio.

1. **NextAuth.js → Auth.js v5.** La app usa Auth.js v5 (el sucesor de NextAuth.js), con proveedor de credenciales y
   sesión JWT. El documento dice "NextAuth.js". Conviene nombrarlo como "Auth.js (antes NextAuth.js)".
2. **Neon no figura.** El PostgreSQL está alojado en Neon (región `sa-east-1`, São Paulo). Falta una fila.
3. **DataCo.** El documento (4.1) lo presenta como dataset de estrés, pero **no se usa en ninguna parte del código**.
   Si no se va a usar, hay que decirlo ("relevado, no incorporado en esta versión") o sacarlo.
4. **CUSUM sobre el residuo del modelo de ML (RF015, RF018 a RF020).** En la implementación, la línea base de cada nodo
   se estima del propio historial sintético (media recortada con intervalo del 90 %) y el CUSUM (estandarizado, umbral
   6,4, calibrado por Monte Carlo) corre sobre ese residuo. **El modelo de ML no alimenta a los nodos**: se consulta en
   la pantalla "Modelo de línea base" y no interviene en la detección. El E90 dice (RF015, RF018) que la línea base la da
   el modelo entrenado con Olist; hay que alinear el texto con esto o conectar el modelo (existe un camino ya
   construido, inactivo, que lo hace para el Vendedor).
5. **Job en segundo plano.** El documento (4.4) dice que el motor corre "como job en segundo plano dentro del
   monolito". Hoy la simulación es **síncrona** dentro de la función (30 réplicas tardan milisegundos); el job real
   está pendiente (C36).
6. **Render.** El documento dice que el microservicio "corre en Render", pero todavía no está desplegado. Si la demo
   del E90 va a mostrar infraestructura real, conviene desplegarlo antes (también mejora el ítem "Demo: Cumple parcial").

## 3. Textos propuestos

### 3.1. Para 4.2 Tecnologías: completar las celdas vacías

| Tecnología | Por qué se eligió (propuesta) |
|---|---|
| Tailwind CSS v4 | Permite definir los estilos junto al componente y mantener una paleta y una escala tipográfica únicas en toda la interfaz, sin hojas de estilo globales que crezcan de forma desordenada. |
| Recharts v3 | Es una librería de gráficos declarativa pensada para React, suficiente para las series semanales con banda de incertidumbre y las curvas de proyección por nodo que muestra el sistema, sin sumar un motor de gráficos externo. |
| sonner | Notifica en la interfaz si el servidor rechazó un cambio que ya se había mostrado como aplicado, para que el usuario sepa que la acción se revirtió. |
| lucide-react | Provee un conjunto de iconos consistente y liviano, importados de a uno, sin cargar la librería completa. |
| Auth.js (antes NextAuth.js) | Resuelve la autenticación dentro del mismo monolito, con sesiones firmadas, sin delegar las credenciales de los usuarios a un servicio externo. El detalle de cómo se protegen está en 4.2.x (Seguridad). |
| Pandas | Alcanza para construir la tabla semanal por vendedor a partir de los registros de órdenes de Olist (agregación, filtrado de valores atípicos y ventanas de actividad). Solo se usa en el entrenamiento, no en el servicio. |
| scikit-learn | Incluye regresión por cuantiles con árboles de gradiente (`GradientBoostingRegressor`), que da el valor esperado y la banda de incertidumbre con un modelo pequeño, sin una infraestructura de entrenamiento más pesada. |
| joblib | Guarda el modelo entrenado y sus parámetros de calibración en un único archivo (bundle) versionado, con su huella SHA-256 que el servicio verifica. |
| Vercel | Despliega el monolito desde el repositorio sin administrar servidores. Las funciones se fijaron en la región São Paulo (`gru1`), junto a la base de datos, lo que bajó la espera por simulación de 3,3 s a 0,1 s (ver 4.2.x, Prueba de carga). |
| Render | Aloja el microservicio de Python como un servicio web propio (con contenedor), lo que evita forzar a Vercel a ejecutar el entorno de Python. |
| GitHub Actions | Ejecuta en cada cambio la verificación de tipos, el linter y las pruebas automáticas de los dos componentes (monolito y microservicio), para detectar regresiones antes del despliegue. |
| Vitest | Pruebas automáticas del motor de simulación, de la generación de datos sintéticos y del monitoreo; incluye pruebas estadísticas de calibración de falsas alarmas. |

Filas a **agregar**: **Neon** (PostgreSQL gestionado, región São Paulo, conexión cifrada obligatoria); **bcryptjs**
(hash de contraseñas); **pytest** (pruebas del microservicio: 22, incluida la paridad de variables entre entrenamiento
e inferencia); **Docker** (contenedor del microservicio) **[verificar que se construya antes de nombrarlo como probado:
el Dockerfile existe pero no se probó con `docker build`]**.

### 3.2. Nuevo apartado: Prueba de carga del motor de simulación

> Con el fin de verificar que el motor de simulación no bloquea el backend, se midió su consumo de tiempo de CPU y de
> memoria sobre redes sintéticas de tamaño creciente, primero en una máquina local (Apple M4) y luego dentro de la
> infraestructura de producción (Vercel, plan Hobby). Cada caso se repitió cinco veces con 30 réplicas, y se
> midió desde adentro de la función con `process.cpuUsage()` y `process.memoryUsage()`.
>
> El costo del motor crece de forma lineal con la cantidad de nodos y deja de depender de la forma de la red. En la
> máquina local, la red más interconectada que admite el modelo, con 300 nodos, tarda 0,26 s, y una red densa de 2.000
> nodos tarda 2,4 s. En Vercel, el motor resultó entre 3 y 3,5 veces más lento: con 300 nodos tarda entre 0,4 y 1,3 s
> según la topología y usa 0,27 GB, y el peor caso posible del modelo (300 nodos conectados todos con todos y 20
> eventos) tarda 16 s, contra el límite de 300 s que impone el plan.
>
> La medición mostró además que el tiempo de espera lo ponía la distancia a la base de datos y no el cálculo: con las
> funciones en Washington y la base en São Paulo, cada simulación esperaba 3,3 s por consultas, contra 0,01 s de motor.
> Al fijar las funciones en la región São Paulo, la espera bajó a 0,1 s.
>
> Se incorporaron dos salvaguardas: un límite de duración de 300 s por función y un control previo que estima el trabajo
> de la corrida y la rechaza con un mensaje claro (HTTP 422) si supera 50 millones de unidades, antes de ejecutarla.
> Además, el arreglo de rendimiento del algoritmo de propagación se verificó contra la versión anterior en 2.000 redes
> aleatorias, con resultados idénticos bit a bit.
>
> **Alcance y limitaciones.** La prueba mide una ejecución por vez sobre una instancia en caliente; **no** mide
> usuarios concurrentes. En la plataforma serverless cada solicitud se atiende en su propia instancia, por lo que una
> simulación no bloquea a las demás, pero esa propiedad no se verificó empíricamente. Tampoco se probaron miles de
> nodos en una misma cadena: el modelo limita cada cadena a 50 nodos en la versión actual.

Fuente de las cifras: `docs/rendimiento-motor.md` y `docs/rendimiento-motor-vercel.md`.
**Si querés cerrar la observación de forma completa, falta una prueba de concurrencia** (por ejemplo, 20 a 50
simulaciones simultáneas contra producción con una herramienta como `k6` o `autocannon`). Puedo prepararla.

### 3.3. Nuevo apartado: Modelo de machine learning (entrenamiento, variables, métricas e interpretabilidad)

> **Qué estima el modelo.** El modelo no predice una ruptura de stock: estima la **línea base** de desempeño de un
> vendedor, es decir, cuánto margen de despacho tendría en condiciones normales, junto con una banda de incertidumbre.
> La detección de una degradación se hace después, comparando el desempeño real con esa línea base.
>
> **Variable objetivo.** Se usa `margin_days` = fecha límite de despacho − fecha real de entrega al transportista, en
> días. Un valor positivo indica que el vendedor despachó antes de su compromiso; uno negativo, que despachó tarde.
>
> **Armado del conjunto de entrenamiento.** A partir de los pedidos y los ítems de Olist, se agrega el margen por
> vendedor y por semana con actividad. Se descartan los valores atípicos (más de 60 días en valor absoluto). Por cada
> vendedor, las **primeras 4 semanas activas** (Fase I) generan las variables de entrada, y el promedio de las semanas
> siguientes (Fase II) es el valor a estimar. Se exigen al menos 4 semanas en Fase I y 2 en Fase II.
>
> **Algoritmo.** Tres modelos `GradientBoostingRegressor` de scikit-learn con pérdida de cuantiles (0,1; 0,5 y 0,9), con
> 150 árboles de profundidad 3, tasa de aprendizaje 0,05 y submuestreo 0,8. La mediana es la línea base. La banda se
> calibra con regresión conformal de cuantiles (CQR), que ajusta los cuantiles para que la cobertura real se acerque al
> 80 % prometido; se calibran dos bandas: la del **promedio** (línea base) y la **semanal** (para alertar).
>
> **Variables de entrada (7).** Media, desvío, mínimo y máximo del margen en la Fase I, ítems promedio por semana,
> ítems totales y cantidad de semanas de la Fase I. No se usan variables de contexto externas (región, categoría,
> estacionalidad), en línea con RF017.
>
> **Métricas** (partición de prueba de 292 vendedores no vistos; reproducidas de forma independiente desde el modelo
> guardado):
>
> | Métrica | Valor |
> |---|---|
> | Error medio absoluto de la línea base | 1,36 días |
> | Error del método ingenuo (media de la Fase I) | 1,83 días (el modelo lo mejora un 26 %) |
> | Cobertura de la banda del promedio (objetivo 80 %) | 79,1 % |
> | Cobertura de la banda semanal (objetivo 80 %) | 79,8 % |
>
> **Validación temporal.** Al validar por fecha en lugar de al azar, la cobertura de la banda del promedio baja a
> 65,8 % y las semanas por debajo de la banda semanal suben de 7,7 % a 14,4 %. Esto indica que la banda del promedio
> subestima la incertidumbre para vendedores nuevos y se declara como limitación.
>
> **Interpretabilidad.** La importancia de variables del modelo mediano (reducción de impureza) es:
> media de Fase I 0,30; máximo 0,27; mínimo 0,18; desvío 0,18; ítems por semana 0,04; ítems totales 0,03; cantidad de
> semanas 0,00. El modelo se apoya casi por completo en el nivel y la dispersión del propio margen del vendedor, y no en
> su volumen de ventas. Esto permite explicar a un gerente de logística por qué la línea base de un proveedor es la que
> es: depende de cómo despachó en sus primeras cuatro semanas, no de variables que el sistema no ve.
>
> **Comparación con otros modelos.** En 10 particiones, el modelo (error 1,26) supera al ingenuo (1,82) y apenas a una
> regresión lineal (1,28) y a una constante (1,33). La ganancia viene sobre todo de encoger las estimaciones hacia el
> centro. La banda semanal mide ±2,8 días alrededor de una línea base de ~3 días, por lo que **solo detecta
> degradaciones severas**.

**Qué es honesto y qué no.**
- La importancia de variables que figura arriba **la calculé yo ahora** desde el bundle (`feature_importances_`). Es
  importancia por impureza; **no es SHAP**. SHAP (`TreeExplainer`) sí se puede aplicar a estos modelos y es una tarea
  de pocas horas; recomiendo hacerla para poder citar la palabra "SHAP" que pidió el feedback, con un gráfico por
  vendedor. Puedo ejecutarla.
- El feedback habla de "ruptura de stock". El modelo **no** es eso. Conviene aclararlo explícitamente (primer párrafo)
  para neutralizar la observación.
- Los números salen de `docs/modelo-ml.md` (sección 2 y hallazgos 4 y 5). Si preferís no mostrar la comparación con
  el modelo lineal, se puede omitir, pero es el tipo de cosa que un evaluador pregunta.

### 3.4. Nuevo apartado: Seguridad y protección de datos

> **Autenticación y contraseñas.** La autenticación usa Auth.js con proveedor de credenciales. Las contraseñas se
> guardan como hash bcrypt con factor de costo 12; nunca en texto plano. Cuando el correo ingresado no existe, igual se
> ejecuta una comparación contra un hash descartable, para que el tiempo de respuesta no revele qué cuentas existen.
>
> **Sesiones.** La sesión se firma como token (JWT) y guarda **solo la identidad** del usuario. Su organización y su
> rol se leen de la base de datos en cada solicitud, de modo que un cambio de rol o la baja de un usuario tiene efecto
> inmediato, sin esperar a que venza la sesión.
>
> **Control de acceso.** Cada consulta de negocio se filtra por la organización de la sesión, nunca por un
> identificador recibido en el cuerpo o la dirección de la solicitud. Un recurso de otra organización responde como
> inexistente (404), no como prohibido, para no confirmar que existe. Las acciones se autorizan por permiso: por
> ejemplo, editar la red exige `chain:write` y correr una simulación exige `scenario:run`, de modo que el rol
> Visualizador solo puede consultar. Las entradas se validan en el servidor con esquemas Zod.
>
> **Invitaciones.** El acceso de un empleado a una organización se otorga por un enlace con token. De ese token solo se
> guarda su hash SHA-256, y aceptarlo exige que el correo de la cuenta coincida con el invitado.
>
> **Datos en tránsito y en reposo.** Todo el tráfico del navegador viaja por HTTPS (Vercel). La conexión a la base exige
> TLS (`sslmode=require`) y el monolito se autentica ante el microservicio de machine learning con una clave de API en
> una cabecera. El cifrado en reposo lo provee el servicio de base de datos gestionada (Neon) **[verificar el texto
> exacto en la documentación de Neon y citarlo; no está documentado en el repositorio]**; el sistema no agrega una
> capa propia de cifrado de campos.
>
> **Relación con el marco normativo.** Respecto de la Ley 25.326, art. 9 (seguridad y confidencialidad), las medidas
> anteriores son las técnicas adoptadas; respecto de la Ley 24.766, los datos de cada organización quedan aislados de
> las demás por el control de acceso descripto, que es la "medida razonable" para mantenerlos reservados.
>
> **Limitaciones declaradas.** Todavía no se verifica el correo al registrarse, no hay doble factor de autenticación
> y no se conserva un registro de auditoría de accesos. No se garantiza el cumplimiento formal de la Ley 25.326 (por
> ejemplo, la inscripción del archivo de datos): el alcance es el de un prototipo académico.

Todo lo anterior está verificado en `src/auth.ts`, `src/lib/auth/session.ts`, `src/lib/data/access.ts` y las rutas de
`src/app/api/`, **salvo** el cifrado en reposo de Neon y el HTTPS de Vercel (ambos son atributos del proveedor, no del
repositorio).

**Eliminación de cuenta (observación 5).** Hoy no existe. Dos caminos:
- **Recomendado: implementarlo.** `DELETE /api/cuenta` que borre al usuario (y, si es el único administrador, bloquee o
  traspase la organización), más un botón en la pantalla de organización, un RF nuevo en el Anexo A ("El sistema debe
  permitir que un usuario elimine su cuenta y los datos personales asociados") y una línea en el caso de uso. Respalda
  el derecho de supresión del art. 6 de la Ley 25.326. Es una tarea chica (medio día) y cierra la observación de
  verdad. Puedo hacerla.
- **Alternativa: declararlo** como limitación del prototipo. Es válido, pero el evaluador lo marcó como falta.

### 3.5. Para 4.1 Datasets: datos sintéticos

> Además de los datasets públicos, el sistema genera datos sintéticos de desempeño para los nodos que no tienen una
> fuente real. Se hace por dos razones: los datasets disponibles solo describen vendedores, y la verificación del
> sistema necesita historiales largos y comparables entre todos los tipos de nodo.
>
> **Cómo se generan.** Cada nodo recibe un perfil según su tipo (nivel y dispersión propios). La serie semanal sigue un
> proceso autorregresivo de primer orden (AR(1)) con ruido determinístico por nodo y semana, de modo que el mismo nodo
> produce siempre la misma serie. El historial es de 28 semanas; las primeras 24 son la ventana de entrenamiento y las
> últimas 4 quedan para evaluar. La línea base se estima solamente a partir del historial del propio nodo (RF017) y
> queda congelada.
>
> **Proporción frente a datos reales.** Los cinco tipos de nodo (Proveedor, Fábrica, Almacén, Vendedor y Cliente) se
> alimentan **exclusivamente con datos sintéticos**: la proporción de datos reales dentro de las series de los nodos es
> cero. Los datos reales de Olist cumplen otro papel: sirven para **entrenar y evaluar el modelo de machine learning**
> de línea base y para fijar el nivel y la dispersión del perfil del nodo Vendedor, que es el único tipo que tiene un
> equivalente real en el dataset. Los otros cuatro perfiles son conceptuales y no se pueden contrastar con Olist.
>
> **Riesgo de sobreajuste y cómo se acota.** El umbral del CUSUM (6,4) no se calibró con degradaciones inyectadas, sino
> con simulaciones de Monte Carlo de series **estables**, fijando la tasa de falsas alarmas (0,16 % por nodo con 24
> semanas). Por eso no hay una degradación sintética de la que el detector pueda "aprender" la forma. Aun así, el
> detector se calibró y se probó únicamente con la distribución sintética, de modo que su desempeño sobre datos
> reales no está demostrado.
>
> **Lo que no está demostrado.** La capacidad del CUSUM para **detectar** una degradación real no se validó con datos
> reales: los nodos sintéticos no tienen incidentes inyectados (el monitoreo vivo los avanza solo con ruido), y los
> datos de Olist no traen degradaciones etiquetadas. Lo único medido contra datos reales es el modelo de línea base
> (error medio 1,36 días frente a 1,83 del método ingenuo, en 292 vendedores no vistos). Se declara como limitación y
> como trabajo futuro: inyectar incidentes en la serie sintética y contrastarlos con episodios reales de Olist.

Fuente: `docs/ingesta-sintetica.md` y `docs/modelo-ml.md`. **Ojo con la última parte:** si el E90 afirma que el CUSUM
detecta degradaciones reales (RF018), esa afirmación hoy no tiene respaldo en datos reales.

### 3.6. Cierre del marco normativo (enlaza con la observación 4)

El Marco normativo del E90 termina diciendo "No es un análisis jurídico ni describe cómo las cumple el sistema". Eso es
exactamente lo que el feedback pide que se agregue. Propuesta: mantener esa frase en 2.1 y agregar al final de 4.2 un
párrafo de remisión: "El modo en que el sistema aplica los artículos 4, 5, 6 y 9 de la Ley 25.326 y el artículo 1 de la
Ley 24.766 se describe en el apartado de Seguridad y protección de datos." Para los entrevistados, agregar una frase
sobre el consentimiento informado y la finalidad **[verificar si se firmó consentimiento; el documento solo habla de un
acuerdo de confidencialidad en la observación de campo]**.

## 4. Orden sugerido para el documento

1. Completar las 12 celdas y agregar las 4 filas (3.1). Es lo más rápido y de mayor efecto visible.
2. Escribir 3.3 (ML) y 3.2 (carga): están respaldados por datos que ya existen.
3. Escribir 3.4 (seguridad) y resolver la eliminación de cuenta.
4. Escribir 3.5 (datos sintéticos) y resolver el punto DataCo.
5. Alinear las inconsistencias de la sección 2 de este archivo.

## 5. Qué puedo hacer yo en el repositorio para sostener lo que se escribe

| Tarea | Tamaño | Sostiene |
|---|---|---|
| Endpoint y botón de eliminación de cuenta (+ RF) | S | Observación 5 |
| SHAP (`TreeExplainer`) sobre el modelo mediano, con gráfico y tabla | S | Observación 2 |
| Prueba de concurrencia contra producción (`k6`/`autocannon`) | S a M | Observación 1 |
| Desplegar `twinchain-ml` en Render (necesita tu cuenta) | S | Inconsistencia 6 y "Demo" |
| Inyección de incidentes en el monitoreo vivo, para validar el CUSUM | M | Observación de datos sintéticos |
