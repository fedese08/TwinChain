# Pendientes: correcciones y mejoras para más adelante

Registro vivo de lo que se detectó y se dejó para después. **Regla:** cuando aparezca algo para corregir o mejorar
que no se resuelva en el momento, se agrega acá con contexto suficiente para retomarlo en frío. Al resolver un
ítem, se borra de la lista y queda en el historial de git.

Convenciones: **[metodología]** = decisión de la tesis, no se toca sin el visto bueno de quien la defiende.
**[bug]** = comportamiento incorrecto conocido. **[deuda]** = funciona pero conviene cambiarlo. **[falta]** =
funcionalidad que todavía no existe.

## Metodología del motor (no parchear por cuenta propia)

- **[metodología] `tabla_k` / `computeReplicaThresholds` tiene la fórmula invertida.** El umbral baja cuando k sube
  ("cuanto más caro reconfigurar, más conviene"), y el "no existe umbral" de los k altos se dispara porque el umbral
  se hace muy chico, no porque el costo sea inalcanzable. Marcado con ⚠️ en `src/lib/domain/simulate.ts`. Por eso la
  recomendación de la pantalla NO sale de `tabla_k` sino de comparar la pérdida evitable contra k. Definir bien el
  umbral es parte de la tesis.
- **[metodología] `MIN_PROPAGATED_MAGNITUDE = 3` corta la dispersión con magnitudes bajas.** Cada salto multiplica por
  0.45–0.65 *antes* de comparar contra el piso, así que un evento de ~1–4 % nunca sale del nodo de origen. Detectado
  en una demo (1 % no se dispersaba). Mientras no se recalibre, usar ≥ 15–20 % en las demos. Marcado con ⚠️ en
  `simulate.ts`.
- **[metodología] Número de réplicas.** El mock corre 30; la recomendación registrada para producción es 200–300
  (sin confirmar). Ver también "Simulación síncrona" más abajo.
- **[falta] Alertas ML y Sugerencias** del spec original no tienen entidad en el modelo de datos real. Quedan para
  cuando se aborde el microservicio ML (Fases 5/6) y se definan contra el modelo real.

## Correctitud de datos

- **[bug] Las curvas del resultado se recalculan con la cadena ACTUAL, no con la del momento de la corrida.** La
  pantalla de resultado vuelve a correr el motor con la semilla guardada sobre los nodos, aristas y desempeño que hay
  hoy. Si después de simular se edita un tiempo de tránsito, se agrega/borra un nodo o cambia el desempeño, las curvas
  mostradas dejan de coincidir con la `tabla_k` guardada, y RF030 ("conservar la corrida sin poder repetirla no
  alcanza") se rompe en la práctica. Opciones: guardar un snapshot de las entradas junto a cada corrida, o guardar
  las proyecciones por nodo en el resultado. Hoy solo se protege borrar un nodo usado por una simulación.
- **[deuda] Fechas y zona horaria.** `startOfWeek` (lo usa el motor) trabaja en hora local y `toIsoDate` corta el ISO
  en UTC; en zonas al este de UTC la semana puede correrse un día. `formatWeekLabel` ya se corrigió (mostraba el
  lunes como domingo al oeste de UTC) y la ingesta usa aritmética de semanas en UTC (`synthetic/weeks.ts`); falta
  unificar el resto — tocar el motor exige verificarlo con `scripts/verify-engine-equivalence.ts`.
- **[deuda] Etiqueta de un nodo nuevo.** El canvas arma el código con las 3 primeras letras del tipo en español
  (`PRO-01`, `ALM-01`, `FAB-01`) en vez de `SUP-01`. Los nodos de la demo y de las plantillas usan `SUP`. Ver
  `handleAddNode` en `src/components/canvas/chain-canvas.tsx`.
- **[deuda] Sin restricción de duplicados de etiqueta** dentro de una cadena (la base no la exige).

## Rendimiento del motor (ver `docs/rendimiento-motor.md`)

- **[falta] El tope de nodos por cadena es fijo (50)** y no depende del plan. Si Max va a ser 150 o 300, hace falta
  una entidad de plan o suscripción que hoy no existe en el modelo. Desde el motor, 300 es holgado (0,36 s).
- **[deuda] Medir la base con una cadena grande.** La carga de base se midió con la cadena demo (10 nodos); con
  150–300 nodos las lecturas traen ~4.800 filas de desempeño y ese costo se estimó, no se midió.
- **[deuda] Límites del despliegue en Hobby:** `maxDuration = 300` (máximo de Hobby; un valor mayor hace fallar el
  build) y `MAX_SIMULATION_WORK` en 50 M unidades. El proyecto no sale al mercado: el costo de los tiers está
  simulado con tarifas de Pro en `docs/rendimiento-motor-vercel.md`. Si se pasara a Pro, ambos límites se relajan.
- **[deuda] `estimateSimulationWork` es conservador:** no distingue redes baratas de caras por unidad (varía ~10×
  entre topologías), así que rechazaría una red de 300 nodos todos con todos y 20 eventos que en la práctica tarda
  16 s. Hoy no se dispara con el tope de 50 nodos; refinarlo con el grado de las aristas si llega a molestar.

## Backend y arquitectura

- **[deuda] Simulación síncrona.** `POST /api/escenarios` y `/corridas` corren el motor dentro del request. Con 30
  réplicas son milisegundos; con 200–300 (o cadenas de 50 nodos) hay que pasarlo a un job real (`after()` de Next o
  una cola) y hacer polling/SSE del resultado. El cliente ya tiene `pendingRuns` pensado para eso (C36).
- **[deuda] El snapshot carga TODO lo de la organización en cada carga completa** (con el monitoreo vivo, hasta 156 semanas por nodo) (`src/lib/data/snapshot.ts`:
  cadenas, nodos, aristas, desempeño, escenarios, eventos, corridas con su `tabla_k`). Está bien para una tesis; con
  muchos datos hay que paginar o cargar por cadena.
- **[deuda] El store del cliente es una copia de trabajo sin sincronización entre pestañas ni tiempo real.** Dos
  pestañas o dos usuarios editando la misma cadena se pisan sin aviso (gana la última escritura). Si algo falla a
  mitad de la cola, el rollback es por acción, no transaccional.
- **[deuda] Ids generados por el cliente** (nodos, aristas, escenarios, eventos): el servidor los acepta tal cual.
  Un id repetido devuelve 409, no hay riesgo de fuga, pero conviene revisarlo si algún día se abre la API.
- **[falta] Tests de integración.** Vitest ya está instalado y cubre las funciones puras (ingesta sintética, estado
  operativo, calibración del CUSUM). Falta lo que toca la base y la API: las pruebas de integración que se hicieron a mano (aislamiento entre organizaciones, permisos, cadenas privadas, cascadas, reproducibilidad
  por semilla) se descartaron después de correrlas: convertirlas en una suite permanente y sumarla al CI (hoy el CI
  solo hace lint + typecheck + `drizzle-kit check`). Prioridad: aislamiento multi-tenant y determinismo del motor.
- **[deuda] El `.env.local` de desarrollo apunta a la rama `production` de Neon.** Cualquier prueba local que
  escriba (crear escenarios, correr simulaciones, el seed) toca la base real. Crear una rama `dev` en Neon y usarla
  en `.env.local`; dejar `production` solo para el despliegue.
- **[hecho, a vigilar] Despliegue en Vercel** (`twinchain.vercel.app`, plan Hobby). Las funciones corren en `gru1`
  (`vercel.json`), junto a la base de Neon (`sa-east-1`): en `iad1` cada consulta cruzaba el continente (~230 ms) y
  una simulación sumaba 3,3 s de espera. **Si se cambia de región de Neon o de plan, revisar `vercel.json`.**
  Pendiente de despliegue: `AUTH_URL` si se agrega un dominio propio.
- **[deuda] `.gitattributes`.** Git avisa en cada commit que LF se reemplazará por CRLF (Windows). Fijar la
  normalización de fin de línea para no ensuciar diffs.
- **[deuda] `npm audit`** reportó vulnerabilidades al instalar dependencias; revisar cuáles son de desarrollo.
- **[deuda] Dependencia sin uso:** `dagre` (+ `@types/dagre`): el auto-layout del canvas no está implementado.
  Sacarla o implementar el layout. (`next-themes` sí se usa, en `components/ui/sonner.tsx`.)
- **[deuda] `docs/modelo-datos.md` no documenta** las columnas `app:` que se agregaron (visibilidad y creador de la
  cadena, etiqueta y posición del nodo, nombre del escenario, `creado_en`) ni la tabla `invitaciones`. Hoy solo están
  comentadas en `src/lib/db/schema.ts`.

## Autenticación y organizaciones

- **[falta] Login con Google** (Auth.js): está cableado el lugar (`AUTH_GOOGLE_ID/SECRET` en `.env.example`) pero no
  el proveedor. Al sumarlo, `usuarios.contrasena` ya es nullable. Ojo con el vínculo de cuentas por email.
- **[falta] Envío de emails** (invitaciones) con un proveedor tipo Resend: hoy el administrador copia el link.
- **[falta] Verificación de email al registrarse.** Por eso aceptar una invitación exige token **y** email
  coincidente; con verificación se podría relajar.
- **[falta] Límite de intentos / anti fuerza bruta** en login y registro.
- **[falta] Gestión de miembros:** quitar a alguien de la organización, cambiar su rol, renombrar la organización,
  transferir la administración, borrar la cuenta. Hoy solo se puede invitar y revocar invitaciones.
- **[falta] Recuperación de contraseña.**
- **[deuda] Roles.** Solo existen Administrador y Visualizador. Los permisos son una lista abierta de strings
  (`organization:manage`, `chain:read/write`, `scenario:read/run`); definir los roles reales cuando haga falta.

## Producto y UI

- **[deuda] El Visualizador ve el canvas en modo `display`**, que no abre el inspector del nodo: no puede consultar
  los atributos ni el desempeño semanal. Falta un modo de solo lectura que sí los muestre.
- **[metodología] Unidades del Vendedor: decisión pendiente, bloquea conectar el ML al pipeline.** El modelo de datos
  define `valor_real` del Vendedor en días (Olist) y el modelo de ML trabaja en días, pero la app usa 0–100 para todos
  los tipos (generador, gráficos y la agregación del motor, que divide por 100). Tres opciones en
  `docs/modelo-ml.md` §5 (recomendada: Vendedor en días con motor sobre déficit relativo, lo que cambia la definición
  de "semana mala equivalente"). Mientras tanto el Vendedor usa el perfil sintético provisorio (nivel 88–92, σ 8–11).
- **[falta] Desplegar `twinchain-ml` en Render** (Blueprint con `render.yaml`) y cargar `ML_SERVICE_URL` y
  `ML_API_KEY` en Vercel; hasta entonces `/modelo` en producción dice "servicio no configurado". El plan gratuito se
  duerme: el primer pedido tarda hasta un minuto.
- **[deuda] El Dockerfile de `twinchain-ml` no se probó** (no había Docker corriendo). El servicio sí se probó con
  `uvicorn` y la suite completa.
- **[metodología] Cobertura temporal del modelo.** La banda del promedio cubre 65,8 % (promete 80 %) en la validación
  temporal; recalibrar el CQR con partición temporal y/o reentrenar con todos los datos. No hay política de
  reentrenamiento (el bundle se entrenó con el 60 % de una partición aleatoria).
- **[falta] La banda semanal del modelo no tiene dónde guardarse:** `desempeno_semanal` solo tiene
  `banda_inferior/superior` (la del promedio). Si se quieren alertas semanales con ella, dos columnas nuevas.
- **[deuda] `TwinChain-DEV.md` describe un clasificador de backorder** (§6 y Fase 5); el modelo real es una regresión
  de línea base. Marcado como desactualizado con una nota; reescribir esas secciones y el diagrama C4.
- **[deuda] Licencia de los datos:** Olist es CC BY-NC-SA 4.0 (uso no comercial). Bien para la tesis; chocaría con una
  salida al mercado real.
- **[metodología] Provisorios de la ingesta, a revisar con quien defiende la tesis:** (1) el estimador de línea base
  (media recortada + intervalo de confianza del 90 %) reemplaza al ML de la Fase 5; (2) el CUSUM retrospectivo
  estandarizado y su umbral 6,4 (0,16 % de falsas alarmas por nodo con 24 semanas); (3) los umbrales de estado de
  nodo (atención 2 σ, crítico 3,4 σ del déficit medio de 3 semanas); (4) la ventana de entrenamiento de 24 semanas.
- **[deuda] Producción no tiene el historial nuevo.** Las cadenas ya creadas en Neon sin desempeño siguen vacías
  hasta correr `npx tsx scripts/backfill-history.ts --apply` contra esa base (primero sin `--apply`, que solo
  cuenta). No se corrió: escribe en producción.
- **[falta] Inyección de incidentes en el monitoreo vivo** (script 7 del plan). El monitoreo avanza sin eventos: los
  nodos solo se mueven por ruido, así que nunca se ve un nodo "crítico". Está sin hacer porque la serie se ancla al
  nivel del nodo (para que no derive) y un incidente sostenido exigiría que el ancla lo reconozca a partir de los
  datos: hay que extender `continueSeries` y recalibrar.
- **[deuda] El reinicio del monitoreo con nodos agregados tarde.** "Reiniciar" deja a cada nodo con sus primeras 28
  semanas; un nodo agregado después de avanzar termina en una semana posterior a la de los demás. Casi no se nota,
  pero la línea de tiempo queda desalineada hasta que se vuelve a avanzar.
- **[deuda] Fechas simuladas.** Cada avance es una semana más y pasa de la fecha de hoy. La pantalla lo rotula como
  "semana simulada", pero el formulario de escenarios sugiere la fecha real.
- **[falta] Plantillas y nodos (`/biblioteca`)** es una página de referencia estática.
- **[deuda] Landing:** los precios y planes son de relleno, sin backend de pagos ni límites reales asociados.
- **[falta] Eliminar/editar cadena:** se puede eliminar, pero no renombrarla ni cambiar su visibilidad
  (compartida/privada) después de crearla.
- **[deuda] En el sandbox de verificación** el panel del navegador no pinta los gráficos de Recharts ni algunas
  aristas de React Flow (`ResizeObserver` no dispara). Confirmar el aspecto visual en un navegador real.
- **[acción] Aplicar la migración `0001` a Neon** (`npm run db:migrate` con `DIRECT_URL` de producción): agrega
  `vendedor_olist_id`, `fuente_linea_base` y las bandas semanales. Hasta entonces el código nuevo falla en producción.
- **[deuda] Cadenas viejas:** sus nodos Vendedor siguen con datos sintéticos en %; solo las cadenas/nodos nuevos usan
  vendedores reales en días.
- **[deuda] Re-baseline:** pasar un nodo de `provisoria` a `ml` recalcula la línea base pero no rehace el historial ya
  guardado más allá de banda y déficit; una vez hecho no se repite.
- **[falta] Desplegar `twinchain-ml` en Render** y cargar `ML_SERVICE_URL`/`ML_API_KEY` en Vercel. El Dockerfile no se
  probó con `docker build`.
- **[decisión] Atraso no representado:** el motor trunca en 0; un margen negativo del Vendedor no suma pérdida.
- **[decisión tomada] Todos los nodos son sensores simulados; el modelo estima su línea base.** Ver `docs/modelo-ml.md`
  sección 8. `REAL_VENDEDORES_ENABLED = false`: el camino de vendedor REAL de Olist queda inactivo (`lib/domain/vendedor`,
  parte de `ingestion/vendedor-setup.ts`). Si se confirma que no se reactiva, conviene borrarlo. Las cadenas de Neon con
  Vendedores reales creadas antes siguen funcionando.
- **[acción] Aplicar la migración `0002` a Neon** (`npm run db:migrate`): relaja `nodos_datos_reales_completos` para que la
  fuente de la línea base valga para cualquier nodo. Sin ella, crear una cadena falla en producción.
- **[deuda] Cadenas viejas en 0–100.** Los nodos sin `fuente_linea_base` (creados antes) siguen en 0–100, con el
  estimador estadístico provisorio. Se pueden convivir en una cadena con nodos en días (el adaptador del motor los
  trata por separado). No hay backfill que los pase a días.
- **[problema] Sesgo del modelo y detección débil de la banda semanal.** Ver `docs/modelo-ml.md` sección 8, "Problemas
  encontrados". Decisión pendiente: reentrenar con partición temporal (Fase D) o recalibrar las bandas, o aceptarlo y
  declararlo en el E90.
- **[deuda] El volumen de la Fase I no se guarda** (se regenera al actualizar la línea base). Columna `items_semana`
  pendiente si se quiere que la ingesta sea fiel a un sensor real.

