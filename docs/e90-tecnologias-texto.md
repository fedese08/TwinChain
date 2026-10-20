# E90: texto para completar y corregir "Datasets" y "Tecnologías"

Este archivo trae el texto listo para pegar en el documento E90, en el mismo tono (impersonal, explicativo, con
tablas "Elaboración propia"). Todo lo que se afirma está verificado contra el código, las mediciones del repositorio o las
fuentes citadas. Las cifras de las mediciones se pueden reproducir (se indica cómo).

**Cómo usarlo**

1. **4.1 Datasets:** reemplazar el párrafo de Olist y el de DataCo, y agregar el subapartado "Datos simulados".
2. **4.2 Tecnologías:** agregar la introducción que hoy falta, reemplazar las Tablas 5 a 8 (ya no quedan celdas con "—") y
   agregar cuatro subapartados al final: modelo de machine learning, detección de cambios, prueba de carga y seguridad.
3. **Anexo A y 4.3:** sumar el RF de eliminación de cuenta (sección 3 de este archivo).
4. **Bibliografía:** sumar las referencias de la sección 4.
5. **Numeración:** las tablas nuevas están marcadas como `Tabla N.a`, `N.b`, etc. Si el documento usa leyendas
   automáticas de Word, se renumeran solas; si no, hay que correrlas a mano (hoy la Tabla 9 es la de roles del equipo).

**Cuatro cosas que no coinciden con el documento actual y hay que decidir** (están en la sección 5): los roles
(Operador / Administrador frente a Administrador / Visualizador), el campo de Olist que se mide, el uso del CUSUM y los
nombres de las tecnologías.

---

## 1. Apartado 4.1 Datasets (reemplazos y agregado)

### 1.1 Párrafos de Olist y DataCo (reemplazan a los actuales)

> De la totalidad de los datasets relevados, solo los dos listados abajo cumplieron con las condiciones necesarias para
> ser considerados en el proyecto. En esta versión del sistema se utiliza uno de ellos, Olist; el otro quedó relevado y
> se describe más abajo.
>
> **Olist: Brazilian E-Commerce Public Dataset** (Olist y Sionek, 2018) es la fuente primaria de calibración. Contiene
> 99.441 órdenes reales de un marketplace entre septiembre de 2016 y octubre de 2018. Del conjunto se utilizan dos campos
> de la etapa que depende del vendedor: la fecha límite de despacho que cada vendedor se comprometió a cumplir
> (`shipping_limit_date`) y la fecha en que efectivamente entregó el pedido al transportista
> (`order_delivered_carrier_date`). Su diferencia, expresada en días, es el **margen de despacho** (`margin_days`): es
> positivo cuando el vendedor despachó antes de su compromiso y negativo cuando lo hizo tarde. Esa diferencia separa la
> demora atribuible al vendedor de la atribuible al transporte, que es el desempeño que el sistema monitorea. Con estos
> datos se entrenó y se evaluó el modelo de machine learning (apartado 4.2) y se fijaron el nivel y la dispersión de los
> datos simulados de cada nodo.
>
> **DataCo Smart Supply Chain** (Constante, Silva y Pereira, 2019) se relevó como dataset de estrés. Contiene 180.519
> registros de una cadena de suministro global entre enero de 2015 y enero de 2018. En esta versión **no se incorporó**:
> ninguna parte del sistema lo utiliza. Queda como fuente posible para una etapa posterior, por ejemplo para poner a
> prueba la detección de disrupciones sobre un episodio real de degradación.

### 1.2 Subapartado nuevo: Datos simulados

> **Datos simulados**
>
> Los datasets públicos describen a los vendedores de un marketplace, pero no existe una fuente abierta que describa el
> desempeño semanal de proveedores, fábricas, almacenes y clientes dentro de una misma red. Una instalación real
> resolvería esto con sensores IoT en cada nodo (RF009). Como este proyecto no cuenta con esa infraestructura, el
> historial de cada nodo lo genera un simulador de sensores. El simulador es solamente una fuente de datos: el modelo de
> machine learning recibe el historial del nodo y estima su línea base sin saber si proviene de un sensor real o del
> simulador.
>
> **Cómo se generan.** Cada nodo reporta, semana a semana, dos valores: su margen de despacho en días y su volumen de
> envíos. El margen sigue un proceso autorregresivo de primer orden alrededor del nivel propio del nodo, con una
> persistencia de 0,15 (la mediana observada en los vendedores de Olist es de 0,16) y semanas malas aisladas, con una
> probabilidad del 3 % y una profundidad de entre 1,5 y 3 desvíos. El ruido de cada semana se obtiene de un generador
> pseudoaleatorio sembrado con el identificador del nodo y la semana, de modo que la misma red produce siempre la misma
> serie y se puede continuar semanas después con el mismo proceso. Cada nodo nace con 28 semanas de historial.
>
> Cada tipo de nodo tiene un perfil propio, calibrado con la distribución observada en Olist (nivel mediano de 3,5 días,
> desvío semanal mediano de unos 2 días y alrededor de 2,5 envíos por semana). Los niveles se eligieron dentro del rango
> en que el modelo tiene datos de sobra (entre 2,8 y 4,2 días).
>
> | Tipo de nodo | Nivel normal (días) | Desvío semanal (días) | Envíos por semana |
> |---|---|---|---|
> | Proveedor | 3,0 a 3,8 | 1,5 a 2,0 | 2 a 6 |
> | Fábrica | 3,2 a 4,0 | 1,4 a 1,8 | 2 a 6 |
> | Almacén | 3,4 a 4,2 | 1,3 a 1,7 | 2 a 6 |
> | Vendedor | 2,8 a 4,2 | 1,5 a 2,4 | 1,5 a 5 |
> | Cliente | 3,6 a 4,2 | 1,3 a 1,6 | 2 a 6 |
>
> Tabla N.a. Perfiles de los nodos simulados, por tipo. Elaboración propia a partir de los datos de Olist.
>
> **Proporción frente a datos reales.** Los cinco tipos de nodo se alimentan exclusivamente con datos simulados: dentro
> de las series de los nodos la proporción de datos reales es nula. Los datos reales de Olist se usan para entrenar y
> evaluar el modelo y para fijar los perfiles de arriba. Solo el nodo Vendedor tiene un equivalente real en el dataset;
> los otros cuatro tipos son conceptuales y reciben la misma métrica por definición, sin posibilidad de contrastarse
> con Olist.
>
> **Riesgo de sobreajuste y cómo se acota.** Que el detector se pruebe sobre datos que el propio sistema genera puede
> dar una idea optimista de su desempeño. Para acotarlo, el umbral del CUSUM no se calibró con degradaciones inyectadas
> a medida, sino con simulaciones de Monte Carlo de series estables, fijando la tasa de falsas alarmas (apartado
> sobre detección de cambios). Además, dos resultados se midieron sobre datos reales: el error del modelo de línea base,
> evaluado sobre 292 vendedores de Olist que el modelo nunca vio, y la regla de alerta por banda semanal, que sobre 81
> vendedores reales no vistos marcó atención en el 3,3 % de las ventanas de tres semanas y estado crítico en el 0,59 %.
>
> **Lo que no está demostrado.** La capacidad del sistema para detectar una degradación real de un proveedor, una
> fábrica, un almacén o un cliente no se validó, porque los datos de Olist no traen degradaciones etiquetadas y los
> nodos simulados no tienen incidentes inyectados. Se declara como limitación del trabajo y como línea futura: poner a
> prueba la detección con datos de sensores reales o con un episodio de degradación documentado.

---

## 2. Apartado 4.2 Tecnologías

### 2.1 Introducción (hoy el apartado empieza directamente con las tablas)

> El sistema se compone de tres piezas: un monolito web construido con Next.js, que contiene la interfaz, el servidor y el
> motor de simulación y corre en Vercel; una base de datos relacional PostgreSQL alojada en Neon; y un microservicio en
> Python con el modelo de machine learning, que corre en Render. Cuatro criterios guiaron la elección de cada
> tecnología. El primero fue reducir la cantidad de infraestructura a mantener, porque el equipo es de dos personas. El
> segundo, detectar errores lo antes posible: el modelo de datos tiene relaciones no triviales entre nodos, aristas,
> escenarios y resultados, y el tipado estático y las pruebas automáticas los detectan antes de la ejecución. El
> tercero, que todo funcione sobre planes gratuitos o de bajo costo, coherente con un prototipo académico. El cuarto,
> separar solamente lo que lo justifica: el modelo de machine learning vive en un servicio aparte porque el ecosistema
> de Python para esa tarea es mucho más sólido que el de JavaScript, y el motor de simulación, en cambio, se mantiene
> dentro del monolito porque no necesita ese ecosistema y así se evita un segundo servicio.

### 2.2 Tablas 5 a 8 (reemplazan a las actuales; no queda ninguna celda con "—")

**Frontend**

| Tecnología | Para qué se usa | Por qué se eligió |
|---|---|---|
| Next.js 15 (App Router) + React 19 | Framework de interfaz y enrutamiento de la aplicación web | Permite un monolito con frontend y backend en el mismo proyecto (API routes), sin necesidad de levantar un servidor Express aparte: reduce la superficie de infraestructura a mantener durante el desarrollo. |
| TypeScript | Tipado estático de todo el código de la aplicación | El modelo de datos tiene relaciones no triviales (nodos, aristas, escenarios, resultados); el tipado estricto detecta en tiempo de compilación errores que en JavaScript recién aparecen en ejecución. |
| Tailwind CSS v4 | Estilos de la interfaz | Define los estilos junto a cada componente y mantiene una única paleta y una única escala tipográfica en toda la aplicación, sin hojas de estilo globales que crezcan sin orden. |
| shadcn/ui | Sistema de componentes de UI | Componentes accesibles y no acoplados a una librería de estilos propia, que se copian al repositorio y se pueden modificar: facilita mantener consistencia visual sin escribir cada componente desde cero. |
| @xyflow/react | Canvas interactivo para representar la red de cadena de suministro (nodos y aristas) | Es la pieza central de la interfaz: el usuario necesita ver y manipular la red como grafo, no como tabla. React Flow es la librería de referencia para este tipo de canvas en el ecosistema React. |
| Recharts v3 | Gráficos de la aplicación | Librería de gráficos declarativa para React, suficiente para las series semanales con banda de incertidumbre y las curvas de proyección por nodo, sin sumar un motor de gráficos externo. |
| Zustand | Manejo de estado en el cliente | Alternativa liviana a Redux. La aplicación mantiene una copia de trabajo de la cadena que se modifica al instante y se sincroniza con el servidor, con reversión si este rechaza el cambio; Zustand lo permite con poco código. |
| react-hook-form + Zod + @hookform/resolvers | Formularios y su validación, tanto en cliente como en servidor | Zod permite definir un único esquema de validación reutilizable entre frontend y backend, evitando duplicar reglas de validación en dos lugares distintos. |
| sonner | Notificaciones (toasts) de la interfaz | Avisa al usuario cuando el servidor rechazó un cambio que ya se había mostrado como aplicado, para que sepa que se revirtió. |
| lucide-react | Iconos | Conjunto de iconos coherente y liviano; se importan de a uno, sin cargar la librería completa. |

Tabla 5. Tecnologías seleccionadas para el desarrollo del frontend. Elaboración propia.

**Backend y base de datos**

| Tecnología | Para qué se usa | Por qué se eligió |
|---|---|---|
| Next.js API Routes | Backend de la aplicación | Reemplaza a Express: al ser parte del mismo framework que el frontend, evita mantener dos servidores y dos configuraciones de despliegue separadas para el monolito. |
| PostgreSQL | Base de datos relacional principal | El modelo de datos es un grafo con relaciones bien definidas entre entidades; un esquema relacional con claves foráneas explícitas modela esas relaciones de forma más directa que un esquema de documentos. |
| Neon | Alojamiento gestionado de PostgreSQL, en la región São Paulo | Ofrece PostgreSQL estándar con un plan gratuito suficiente para el prototipo y conexiones por pooler, adecuadas para funciones serverless. Se ubica en la misma región que las funciones de Vercel. Se evaluó Supabase y se descartó, porque el sistema no usa lo que esa plataforma suma sobre PostgreSQL (autenticación, seguridad por filas, almacenamiento de archivos y tiempo real). |
| Drizzle ORM | Capa de acceso a la base de datos y migraciones | Menor latencia de arranque en funciones serverless (Vercel) y correspondencia más directa con el esquema SQL definido; las migraciones quedan versionadas como archivos SQL en el repositorio. |
| Auth.js v5 (antes NextAuth.js) | Autenticación con credenciales y sesión firmada | Resuelve la autenticación dentro del mismo monolito, sin delegar las credenciales de los usuarios a un servicio externo. Cómo se protegen las credenciales, las sesiones y el acceso se detalla en el apartado de seguridad. |
| bcryptjs | Hash de las contraseñas de los usuarios | Implementación en JavaScript puro de bcrypt, una función de hash diseñada para contraseñas (con sal incorporada y costo ajustable, Provos y Mazières, 1999); no requiere compilar módulos nativos en Vercel. |

Tabla 6. Tecnologías seleccionadas para el desarrollo del backend. Elaboración propia.

**Modelo de machine learning**

| Tecnología | Para qué se usa | Por qué se eligió |
|---|---|---|
| Python | Lenguaje del microservicio de machine learning, separado del monolito | El ecosistema de librerías de machine learning de Python es mucho más sólido que el ecosistema de Node/JavaScript. |
| FastAPI + Uvicorn | Framework y servidor del microservicio de machine learning | Expone el modelo como servicio HTTP independiente, consumido por el monolito Next.js sin acoplar el modelo al resto de la aplicación. Valida las entradas del servicio con Pydantic y documenta la API de forma automática. |
| scikit-learn | Entrenamiento e inferencia del modelo de línea base | Incluye regresión por árboles de gradiente con pérdida de cuantiles (`GradientBoostingRegressor`), que da el valor esperado y los extremos de la banda de incertidumbre con un modelo pequeño, sin una infraestructura de entrenamiento más pesada (Pedregosa et al., 2011). |
| Pandas | Procesamiento y limpieza de los datos de calibración (Olist) | Alcanza para agregar los pedidos por vendedor y por semana, descartar valores atípicos y armar las ventanas de actividad. Solo se usa en el entrenamiento: el servicio no lo carga, para arrancar rápido y usar poca memoria. |
| joblib | Serialización del modelo entrenado | Guarda en un único archivo (bundle) los tres modelos de cuantiles, los parámetros de calibración y las métricas de evaluación. El servicio publica la huella SHA-256 del archivo y una prueba automática falla si el archivo cambia. |
| SHAP | Explicación de cuánto aporta cada variable a la línea base estimada | Calcula valores exactos para modelos basados en árboles (Lundberg et al., 2020), lo que permite explicar el modelo sin aproximaciones. Se usa en el análisis de interpretabilidad, no en el servicio. |

Tabla 7. Tecnologías seleccionadas para el desarrollo del modelo de machine learning. Elaboración propia.

**Infraestructura y calidad**

| Tecnología | Para qué se usa | Por qué se eligió |
|---|---|---|
| Vercel | Despliegue del monolito Next.js | Despliega desde el repositorio sin administrar servidores y sirve todo por HTTPS. Las funciones se fijaron en la región São Paulo, junto a la base de datos, lo que redujo la espera por simulación de 3,3 s a 0,1 s. El plan gratuito limita cada función a 300 s, tope que el motor de simulación respeta con amplio margen. |
| Render | Despliegue del microservicio de machine learning | Ejecuta el microservicio como servicio web a partir del contenedor y genera la clave de API en el despliegue. El plan gratuito lo duerme tras unos 15 minutos sin uso, por lo que el primer pedido puede tardar hasta un minuto: el sistema espera 10 s y, si el modelo no responde, usa una línea base provisoria marcada como tal. |
| Docker | Contenedor del microservicio de machine learning | Empaqueta solo lo que usa el servicio (código, variables de entorno y el modelo), sin el entrenamiento ni las pruebas, y fija las versiones exactas de las librerías: el modelo es un archivo serializado que solo se garantiza que cargue con la versión de scikit-learn con la que se entrenó. |
| GitHub Actions | Integración continua | Ejecuta en cada cambio el linter, la verificación de tipos, las pruebas automáticas de los dos componentes y la consistencia de las migraciones, para detectar regresiones antes del despliegue. |
| Vitest | Pruebas automáticas del monolito | Cubre el motor de simulación (contra una enumeración de caminos independiente), la generación de datos simulados, el monitoreo y el cliente del modelo; incluye pruebas estadísticas que verifican la tasa de falsas alarmas. Son 122 pruebas. |
| pytest | Pruebas automáticas del microservicio | Son 22 pruebas, entre ellas la que verifica que el cálculo de variables del entrenamiento y el de la inferencia den exactamente lo mismo y la que verifica la integridad del archivo del modelo. |

Tabla 8. Tecnologías seleccionadas para el deploy y control de calidad. Elaboración propia.

### 2.3 Subapartado nuevo: Modelo de machine learning

> **Modelo de machine learning: entrenamiento, evaluación e interpretabilidad**
>
> **Qué estima el modelo.** El modelo no predice una ruptura de stock ni una disrupción: estima la **línea base** de un
> nodo, es decir, el margen de despacho que tendría en condiciones normales, junto con una banda de incertidumbre. La
> detección de una degradación se hace después, comparando el desempeño real de la semana con esa línea base. Esta
> separación importa para la interpretabilidad: el único componente que no es una regla explícita es la estimación de
> la línea base.
>
> **Armado del conjunto de entrenamiento.** Se parte de los pedidos de Olist y de sus ítems, que dan 110.187 ítems
> despachados de 1.460 vendedores con historial utilizable. Para cada vendedor se agrega el margen de despacho por
> semana con actividad y se descartan los valores atípicos (más de 60 días en valor absoluto). Siguiendo la lógica de las
> dos fases del control estadístico de procesos (apartado 2.1.5), las **primeras cuatro semanas con actividad** de cada
> vendedor son su fase I y de ellas se calculan las variables de entrada. El valor que el modelo aprende a estimar es el
> promedio del margen en las semanas siguientes (fase II). Se exigen al menos cuatro semanas en la fase I y dos en la
> fase II. Los vendedores se reparten al azar, con semilla fija, en tres conjuntos: 60 % para entrenar, 20 % para
> calibrar la banda y 20 % (292 vendedores) para evaluar.
>
> **Variables de entrada.** Son siete, todas calculadas con el historial propio del vendedor (RF017): la media, el desvío,
> el mínimo y el máximo del margen en la fase I, el promedio de ítems por semana, el total de ítems y la cantidad de
> semanas de la fase I. No se usan variables de contexto externas, como región, categoría o estacionalidad.
>
> **Algoritmo.** Se entrenan tres modelos `GradientBoostingRegressor` de scikit-learn con pérdida de cuantiles (Koenker y
> Bassett, 1978; Friedman, 2001), uno para el cuantil 0,1, otro para el 0,5 y otro para el 0,9, cada uno con 150 árboles de
> profundidad 3, tasa de aprendizaje de 0,05 y submuestreo de 0,8. La mediana es la línea base. Los cuantiles extremos
> pueden quedar demasiado angostos, así que la banda se corrige con regresión conformal de cuantiles (Romano et al.,
> 2019): sobre el conjunto de calibración se mide cuánto hay que ensanchar los cuantiles para que la cobertura real se
> acerque al 80 % prometido. Se calibran dos bandas: la **banda del promedio**, que acota la línea base misma y alimenta
> las réplicas de la simulación, y la **banda semanal**, que acota el valor de una semana individual y se usa para
> alertar. El ensanchamiento es de 0,30 días en la primera y de 1,38 días en la segunda.
>
> **Evaluación.** Las cifras se calcularon sobre los 292 vendedores de evaluación y se reprodujeron de forma
> independiente a partir del archivo del modelo.
>
> | Métrica | Valor |
> |---|---|
> | Error medio absoluto de la línea base | 1,36 días |
> | Error del método ingenuo (media de la fase I) | 1,83 días |
> | Mejora respecto del método ingenuo | 26 % |
> | Cobertura de la banda del promedio (objetivo 80 %) | 79,1 % |
> | Cobertura de la banda semanal (objetivo 80 %) | 79,8 % |
>
> Tabla N.b. Métricas del modelo de línea base sobre vendedores no vistos. Elaboración propia.
>
> Conviene aclarar tres límites de estas cifras. Primero, al repetir la evaluación en diez particiones, el modelo (error
> de 1,26 días) mejora al método ingenuo (1,82), pero apenas a una regresión lineal (1,28) y a una constante (1,33): casi
> toda su ventaja proviene de acercar las estimaciones al centro de la distribución, y por eso predice entre 2,4 y 4,2 días
> cuando los niveles reales van de 0,5 a 5,5. Segundo, al validar por fecha en lugar de al azar, la cobertura de la banda
> del promedio baja del 79,1 % al 65,8 %, lo que indica que subestima la incertidumbre en vendedores nuevos. Tercero,
> como la banda semanal mide alrededor de 2,8 días a cada lado de una línea base de unos 3 días, solo detecta
> degradaciones severas. Sobre 600 nodos simulados, donde la línea base verdadera se conoce, el modelo tiene un error de
> 0,51 días frente a 0,80 del método ingenuo y subestima el nivel en 0,45 días en promedio.
>
> **Interpretabilidad.** Para explicar por qué el modelo estima una línea base determinada se calcularon valores SHAP
> (Lundberg y Lee, 2017) sobre el modelo de la mediana, con las primeras cuatro semanas de 181 vendedores reales. El
> valor SHAP de una variable indica cuántos días suma o resta a la estimación de un vendedor respecto del promedio de
> 3,30 días.
>
> | Variable | Aporte medio absoluto (días) | Parte del total | Efecto |
> |---|---|---|---|
> | Media del margen en la fase I | 0,273 | 44,3 % | Más margen previo, mayor línea base |
> | Máximo del margen en la fase I | 0,189 | 30,7 % | Más margen previo, mayor línea base |
> | Mínimo del margen en la fase I | 0,081 | 13,1 % | Más margen previo, mayor línea base |
> | Desvío del margen en la fase I | 0,038 | 6,1 % | Casi nulo |
> | Total de ítems de la fase I | 0,019 | 3,0 % | Más volumen, línea base algo menor |
> | Promedio de ítems por semana | 0,017 | 2,7 % | Más volumen, línea base algo menor |
> | Cantidad de semanas de la fase I | 0,000 | 0,0 % | Constante (siempre cuatro) |
>
> Tabla N.c. Importancia de las variables según valores SHAP, sobre el modelo de la mediana. Elaboración propia.
>
> El modelo se apoya casi por completo en el nivel del propio margen del vendedor: la media y el máximo explican el 75 %
> de la estimación, y el volumen de ventas, menos del 6 %. Esto responde a lo que necesita un gerente de logística. La
> línea base de un proveedor es la que es porque sus primeras semanas tuvieron ese margen, y no por variables que el
> sistema no ve. A nivel individual, por ejemplo, el primer vendedor de la muestra recibe una estimación de 2,61 días,
> 0,69 días por debajo del promedio: la media de su fase I resta 0,21, su máximo resta 0,35 y su mínimo resta 0,13. Por
> último, la decisión de pasar un nodo a atención o a estado crítico no la toma el modelo sino una regla explícita —
> dos o tres de las últimas tres semanas por debajo de la banda semanal—, de modo que el sistema siempre puede mostrar
> qué semanas, y contra qué valor, dispararon la alerta.

### 2.4 Subapartado nuevo: Detección de cambios (variante implementada)

> **Detección de cambios: la variante implementada**
>
> El marco teórico presenta el CUSUM en su forma tabular (Montgomery, 2013), que acumula desvíos respecto de un valor de
> referencia y exige conocer, o estimar de forma confiable, el desvío estándar del proceso. Al ponerlo a prueba sobre
> historiales estables de 16 semanas, la forma tabular dio entre un 40 % y un 70 % de falsas alarmas, en lugar del 0,2 %
> que se buscaba: con tan pocos puntos el desvío estimado es muy ruidoso, y las series tienen autocorrelación, que
> inflaba el estadístico un 36 %. Una cadena de 50 nodos hace 50 pruebas a la vez, por lo que con esa tasa casi toda cadena
> saldría en alerta sin motivo.
>
> Por eso se implementó una variante retrospectiva y estandarizada. Para cada punto de corte posible de la ventana, se
> compara el nivel de las semanas anteriores con el de las posteriores, y se toma el corte más marcado. El desvío se
> estima con la variación *dentro* de cada tramo, de modo que el propio cambio de nivel no lo infla ni enmascara lo que
> se quiere detectar. Si el estadístico supera 6,4 desvíos, se considera que el nodo cambió de nivel y el corte señala
> la semana. El umbral se calibró con simulaciones de Monte Carlo sobre 20.000 series estables de los cinco tipos de nodo y
> una ventana de 24 semanas, hasta alcanzar una tasa de falsas alarmas de 0,16 % por nodo. Con ese umbral, una caída de
> cuatro desvíos a mitad de la ventana se detecta en el 97 % de los casos; las subas se detectan mal (13 %), porque la
> escala está acotada.
>
> En el sistema esta variante cumple un papel distinto del monitoreo semanal. El CUSUM verifica, sobre las primeras 24
> semanas de cada nodo, que el historial en el que se congeló la línea base fue estable: si hubo un cambio de nivel, esa
> línea base nace mala y el sistema lo informa antes de que se confíe en ella. La alerta semana a semana, en cambio, la
> da la regla de la banda semanal del modelo descripta en el apartado anterior.

### 2.5 Subapartado nuevo: Prueba de carga del motor de simulación

> **Prueba de carga del motor de simulación**
>
> Para verificar que el motor no bloquea el backend se midió su consumo de tiempo de procesador y de memoria sobre redes
> sintéticas de tamaño creciente, con el evento de mayor magnitud en el nodo raíz, de modo que alcance a todos los nodos.
> Cada caso se ejecutó cinco veces (tres en la red de todos con todos), en un proceso aparte, con 30 réplicas por cada una de las tres fracciones de
> propagación y un tiempo máximo de 120 s por corrida. Las mediciones se hicieron en una máquina local (Apple M4, 10
> núcleos, 16 GB) y se reproducen con `scripts/bench-engine.ts`.
>
> La propagación del déficit por la red se calcula como una recurrencia semana a semana, por lo que su costo crece de
> forma lineal con la cantidad de nodos y aristas y no depende de la cantidad de caminos posibles. La primera medición
> (6 de octubre de 2026) había encontrado el problema contrario: con el algoritmo original, una red de 26 nodos muy
> conectados superaba los 120 s, porque el costo crecía con la cantidad de caminos. Se rediseñó la propagación y se
> verificó que el resultado no cambiara.
>
> | Red | Nodos | Horizonte (semanas) | Tiempo (s) | Memoria pico (MB) |
> |---|---|---|---|---|
> | En capas (2 padres por nodo) | 300 | 52 | 0,24 | 207 |
> | En capas (2 padres por nodo) | 1.000 | 52 | 0,76 | 383 |
> | En capas (2 padres por nodo) | 2.000 | 52 | 1,62 | 585 |
> | Densa (4 padres por nodo) | 2.000 | 52 | 1,63 | 588 |
> | Todos con todos (peor caso) | 300 | 16 | 0,25 | 159 |
>
> Tabla N.d. Tiempo y memoria del motor de simulación según el tamaño de la red (mediana de las corridas). Elaboración propia.
>
> Aun la red de 2.000 nodos tarda menos de dos segundos y usa menos de 600 MB, mientras que los planes del sistema
> admiten hasta 100 nodos por organización. En la medición dentro de Vercel (plan gratuito) el motor resultó 3,3 veces
> más lento que en la máquina local; aplicando ese factor, el caso más grande de la tabla rondaría los 5,4 s, contra el
> límite de 300 s por función. Esa estimación se hizo con el factor medido sobre una versión anterior del motor y no se
> volvió a medir en producción.
>
> La misma medición mostró que el tiempo de espera de una simulación no lo ponía el cálculo sino la distancia a la base de
> datos: con las funciones en Washington y la base en São Paulo, cada simulación esperaba 3,3 s por sus consultas, contra
> 0,01 s del motor. Al fijar las funciones en la región São Paulo la espera bajó a 0,1 s.
>
> Se incorporaron dos salvaguardas. Un límite de 300 s por función, que es el máximo del plan gratuito, y un control previo
> que estima el trabajo de la corrida (réplicas × fracciones × semanas × tamaño de la red alcanzada) y la rechaza con un
> mensaje claro, antes de ejecutarla, si supera 1.000 millones de unidades, es decir, alrededor de 1,3 s en la máquina de
> prueba.
>
> **Alcance y limitaciones.** Las pruebas miden una ejecución por vez sobre una instancia en caliente y no usuarios
> concurrentes. En una plataforma serverless cada solicitud se atiende en su propia instancia, de modo que una simulación
> no debería bloquear a las demás, pero esa propiedad no se verificó de forma empírica. Tampoco se midió el comportamiento
> de la base de datos ante muchas escrituras simultáneas.

### 2.6 Subapartado nuevo: Seguridad y protección de datos

> **Seguridad y protección de datos**
>
> El sistema maneja dos clases de información sensible, descriptas en el marco normativo (apartado 2.1.6): los datos de
> las personas que lo usan y la información comercial de las organizaciones, como la estructura de su red y el desempeño
> de cada nodo. Las medidas que siguen son las técnicas adoptadas para protegerlas.
>
> **Credenciales.** Las contraseñas no se guardan nunca en texto plano: se almacena únicamente su hash bcrypt, con factor
> de costo 12 y sal propia de cada contraseña. Como bcrypt ignora lo que excede los 72 caracteres, ese es el máximo
> permitido. Cuando el correo ingresado no existe, de todos modos se ejecuta una comparación contra un hash
> descartable, para que el tiempo de respuesta no revele qué cuentas existen.
>
> **Sesiones.** La sesión es un token firmado (JWT) que vence a los 14 días y guarda únicamente la identidad del usuario.
> Su organización y su rol se leen de la base de datos en cada solicitud, de modo que un cambio de rol o la baja de una
> cuenta tiene efecto inmediato, sin esperar a que venza la sesión.
>
> **Control de acceso.** Cada consulta de negocio se filtra por la organización de la sesión y nunca por un identificador
> recibido en el cuerpo o en la dirección de la solicitud: ese filtro es el que aísla los datos de una organización de los
> de las demás. Un recurso de otra organización responde como inexistente (404) y no como prohibido, para no confirmar
> que existe. Las acciones se autorizan por permiso: el rol Administrador puede editar la red, correr simulaciones y
> administrar la organización, y el Visualizador solo puede consultar. Todas las entradas se validan en el servidor con
> esquemas de Zod, y las consultas a la base se ejecutan con parámetros, lo que impide la inyección de SQL.
>
> **Invitaciones.** El acceso de una persona a una organización se otorga con un enlace con token de un solo uso, que vence a los siete días. De ese
> token solo se guarda su hash SHA-256, y aceptarlo exige además que el correo de la cuenta coincida con el de la
> invitación.
>
> **Comunicación entre componentes.** Todo el tráfico del navegador viaja por HTTPS: Vercel provee certificados
> automáticos, redirige el tráfico HTTP y admite las versiones 1.2 y 1.3 de TLS (Vercel, s. f.). La conexión con la base
> de datos exige TLS (`sslmode=require`) y Neon, según su documentación, exige conexiones cifradas con TLS (Neon, s. f.).
> El monolito se autentica ante el microservicio de machine learning con una clave de API en una cabecera, que el servicio
> compara en tiempo constante; Render sirve el microservicio con certificado TLS administrado (Render, s. f.).
>
> **Cifrado en reposo y secretos.** Los datos guardados en Neon están cifrados en reposo con AES-256, según su
> documentación de seguridad (Neon, s. f.). El sistema no agrega una capa propia de cifrado por campo. Las claves y
> cadenas de conexión no están en el repositorio: se cargan como variables de entorno en Vercel y en Render, y los
> archivos locales con secretos están excluidos del control de versiones.
>
> **Relación con las leyes citadas.** Respecto de la Ley 25.326, las medidas anteriores son las técnicas y organizativas
> de seguridad y confidencialidad que exige el artículo 9. Respecto de la Ley 24.766, el aislamiento de los datos de cada
> organización por el control de acceso descripto es la medida razonable para mantener su reserva (artículo 1). Para el
> derecho de supresión que recoge el artículo 6, el sistema permite que cada persona elimine su cuenta y los datos
> personales asociados: se le pide la contraseña, y qué más se borra depende de la organización. Si la persona es la única
> integrante, se elimina también la organización con sus cadenas y simulaciones; si hay más integrantes, se eliminan sus
> cadenas privadas y lo que pertenece a la organización pasa a otra persona administradora; y la única administradora de
> una organización con más integrantes no puede eliminar su cuenta mientras estos sigan, porque nadie más podría
> administrarla.
>
> **Datos de las entrevistas.** A los entrevistados se les informó, antes de cada entrevista, que la información se usaba
> con fines académicos. Esa información se dio de forma verbal y no quedó registrada de manera formal, por lo que no
> hay constancia de consentimiento informado en los términos del artículo 5 de la Ley 25.326. Se declara como una
> limitación del relevamiento.
>
> **Limitaciones declaradas.** El sistema es un prototipo académico y no se garantiza el cumplimiento formal de la Ley
> 25.326, por ejemplo la inscripción del archivo de datos. No se verifica el correo al registrarse, no hay doble factor de
> autenticación, no se limita la cantidad de intentos de inicio de sesión ni se conserva un registro de auditoría de
> accesos. Tampoco hay todavía una pantalla para cambiar los roles de los integrantes de una organización.

---

## 3. Requerimiento nuevo (Anexo A y apartado 4.3)

> **RF032.** El sistema debe permitir que un usuario elimine su cuenta y los datos personales asociados, previa
> confirmación con su contraseña.

Se ubica en el módulo de usuarios y organizaciones (donde están RF001 y RF002). Para el diagrama de casos de uso: un caso
nuevo "Eliminar cuenta", asociado a los dos actores. **El número RF032 es provisorio**: el documento llega a RF031, así
que se asignó el siguiente, pero hay que revisarlo contra el Anexo A.

**Requerimientos no funcionales (opcional).** El feedback del E50 observó que no hay requerimientos no funcionales. Las
mediciones de arriba permiten redactar algunos medibles:

| Categoría | Requerimiento |
|---|---|
| Desempeño | Una simulación sobre una red de hasta 100 nodos y 52 semanas debe completarse en menos de 5 s en el entorno de producción. |
| Desempeño | El sistema debe rechazar, antes de ejecutarla, una simulación cuyo costo estimado exceda el límite del servidor, con un mensaje claro. |
| Seguridad | Las contraseñas deben almacenarse como hash bcrypt con factor de costo no inferior a 12. |
| Seguridad | Una organización no debe poder consultar ni modificar datos de otra: toda consulta debe filtrarse por la organización de la sesión. |
| Seguridad | Toda comunicación entre el navegador, el monolito, la base de datos y el microservicio debe viajar cifrada. |
| Disponibilidad | Si el modelo de machine learning no responde en 10 s, el sistema debe continuar operando con una línea base provisoria marcada como tal. |
| Privacidad | Cada usuario debe poder eliminar su cuenta y sus datos personales (RF032). |

Tabla N.e. Requerimientos no funcionales medibles. Elaboración propia.

---

## 4. Referencias para sumar a la bibliografía

Las que corresponden a documentación de proveedores se consultaron el 20 de octubre de 2026. Las referencias académicas
son las de las obras originales; **verificá páginas y DOI antes de entregar**, porque las escribí de memoria.

- FRIEDMAN, J. H. Greedy function approximation: a gradient boosting machine. *The Annals of Statistics*. 2001, vol. 29, no. 5, pp. 1189-1232.
- KOENKER, R. y BASSETT, G. Regression quantiles. *Econometrica*. 1978, vol. 46, no. 1, pp. 33-50.
- LUNDBERG, S. M. y LEE, S.-I. A unified approach to interpreting model predictions. *Advances in Neural Information Processing Systems*. 2017, vol. 30.
- LUNDBERG, S. M. et al. From local explanations to global understanding with explainable AI for trees. *Nature Machine Intelligence*. 2020, vol. 2, pp. 56-67.
- PEDREGOSA, F. et al. Scikit-learn: Machine Learning in Python. *Journal of Machine Learning Research*. 2011, vol. 12, pp. 2825-2830.
- PROVOS, N. y MAZIÈRES, D. A future-adaptable password scheme. *Proceedings of the USENIX Annual Technical Conference*. 1999.
- ROMANO, Y., PATTERSON, E. y CANDÈS, E. J. Conformalized quantile regression. *Advances in Neural Information Processing Systems*. 2019, vol. 32.
- NEON. *Security overview*. s. f. Disponible en: https://neon.com/docs/security Fecha de consulta: 20 de octubre de 2026.
- RENDER. *Fully managed TLS certificates*. s. f. Disponible en: https://render.com/docs/ssl Fecha de consulta: 20 de octubre de 2026.
- VERCEL. *Encryption*. s. f. Disponible en: https://vercel.com/docs/encryption Fecha de consulta: 20 de octubre de 2026.

---

## 5. Lo que no coincide con el documento actual (hay que decidir)

1. **Roles.** El E90 (apartado de casos de uso) describe dos roles, **Operador** (consulta y simula) y **Administrador**
   (además gestiona usuarios, roles y la estructura de la red). El sistema implementa **Administrador** (edita la red,
   simula y administra) y **Visualizador** (solo consulta); el Operador no existe, y todavía no hay pantalla para
   gestionar roles. El texto de seguridad describe lo implementado. Hay que alinear el documento o el código.
2. **Qué campo de Olist se mide.** El E90 dice que el residuo es la diferencia entre la fecha estimada y la real de
   *entrega* al cliente. El modelo y los datos simulados usan el margen de *despacho* (fecha límite de despacho contra
   entrega al transportista). El texto de 4.1 ya está corregido; falta revisar los demás lugares donde el documento dice
   "fecha estimada vs. real de entrega" (por ejemplo, la observación de campo, apartado 3.3).
3. **CUSUM sobre el residuo del modelo (RF018 a RF020).** Los RF describen un CUSUM sobre el residuo del modelo. En el
   sistema el CUSUM verifica la estabilidad del historial de entrenamiento, y la alerta semanal usa la banda del modelo
   (apartado 2.4). Conviene reescribir RF018 o agregar un RF para la regla de la banda semanal.
4. **Nombres.** NextAuth.js pasó a ser Auth.js v5; Neon no figuraba; Pandas se usa solo en el entrenamiento. Ya están
   corregidos en las tablas.
5. **Cifrado en reposo de Neon.** La afirmación de AES-256 sale de la documentación de seguridad de Neon, encontrada por
   búsqueda web. Abrí https://neon.com/docs/security y confirmá la frase antes de entregar, porque un resultado de
   búsqueda mostraba un texto distinto en otro dominio de Neon.
6. **Render y Docker.** El texto da por hecho que el microservicio corre en Render y desde un contenedor. Confirmalo
   antes de entregar (y sacá la captura del servicio en estado "Live" para la demo).

## 6. Cómo reproducir las cifras

| Cifra | Cómo |
|---|---|
| Métricas del modelo, cobertura, validación temporal | `docs/modelo-ml.md` (secciones 2 y 4); se recalculan desde el archivo del modelo |
| Valores SHAP | Se calcularon con `shap.TreeExplainer` sobre `quantile_models[0.5]` del archivo del modelo, con las primeras cuatro semanas de los 181 vendedores de `src/data/olist-vendedores.json` |
| Modelo sobre nodos simulados (0,51 / 0,80 / −0,45 días; cobertura de bandas) | `scripts/measure-sensor-model.ts` con el servicio de ML levantado |
| Tiempos y memoria del motor | `scripts/bench-engine.ts` |
| Falsas alarmas del CUSUM | `docs/ingesta-sintetica.md` (sección 4) |
