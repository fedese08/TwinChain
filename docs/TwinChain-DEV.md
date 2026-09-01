# TwinChain — Instrucciones de Desarrollo para Claude Code

**Monitoreo y Simulación de Disrupciones en Cadenas de Suministro**

Este documento es la fuente de verdad para el desarrollo. Léelo completo antes de escribir la primera línea de código. Los recursos adjuntos (HTML exportado de Claude Design + estructura del modelo de datos) complementan este documento — no lo reemplazan.

---

## 1. Contexto del proyecto

TwinChain es una plataforma web que combina dos capas de análisis sobre cadenas de suministro modeladas en un canvas infinito:

1. **Monitoreo tipo Digital Twin**: cada cadena mantiene un estado "vivo" alimentado por datos sintéticos (simulando sensores IoT). Un microservicio de Machine Learning predice continuamente la probabilidad de quiebre de stock (backorder) por nodo, generando alertas tempranas.
2. **Simulación hipotética de perturbaciones**: sobre un fork de cualquier cadena, el usuario inserta eventos disruptivos (cierre de nodo, retraso, pico de demanda) y un motor determinístico de ticks calcula la propagación del impacto (ripple effect), sin afectar el monitoreo en tiempo real.

Es un Trabajo Final de Ingeniería. La prioridad no es "feature completo", es **un sistema end-to-end funcional y demostrable**, con el motor de simulación y el modelo de ML como piezas defendibles ante un tribunal académico.

---

## 2. Cómo trabajar en este proyecto (leer antes de codear)

- **No asumas decisiones de arquitectura no documentadas.** Si algo no está definido en este documento ni en los recursos adjuntos, preguntá antes de implementar una solución propia.
- **Desarrollo incremental, módulo por módulo.** No intentes generar la aplicación completa en una sola pasada. Seguí el orden de fases de la sección 7. Al terminar cada módulo, entregá algo que corra y se pueda probar antes de avanzar al siguiente.
- **Cada módulo entregado debe ser demostrable.** No avances a la fase siguiente si la anterior no compila, no corre, o no tiene al menos un flujo feliz probado manualmente.
- **Priorizá simplicidad sobre elegancia prematura.** Es una tesis con tiempo acotado, no un producto comercial. Preferí la solución directa y correcta sobre la abstracción "por si escala".
- **No inventes requerimientos.** Si te parece que falta una funcionalidad razonable, señalalo como propuesta, no la implementes sin confirmación.

---

## 3. Stack tecnológico (usar exactamente este, sin sustituciones)

### Frontend
- **Next.js 15** (App Router)
- **React 19**
- **@xyflow/react (React Flow 12)** — canvas infinito de nodos/aristas
- **dagre** — auto-layout del grafo
- **Tailwind CSS v4 + shadcn/ui** — sistema de componentes
- **Recharts v3** — gráficos del dashboard
- **Zustand** — estado del canvas y resultados de simulación
- **TanStack Query v5** — estado del servidor
- **react-hook-form + Zod** — formularios y validación

### Backend
- **Next.js API Routes / Server Actions** — sin Express separado
- **PostgreSQL + Drizzle ORM** — originalmente se había definido MongoDB + Mongoose; cambiado por decisión del
  usuario, ver la nota de migración en `docs/modelo-datos.md`
- **NextAuth.js (Auth.js) v5** — Google OAuth + credentials

### Microservicio ML (separado del monolito)
- **Python 3.12+ / FastAPI**
- **scikit-learn / XGBoost**
- **pandas, joblib**
- Se comunica con el backend Next.js vía REST (`POST /score`)

### DevOps
- Deploy app: **Vercel**
- Deploy microservicio ML: **Railway** o **Render**
- DB: **PostgreSQL en Neon** (free tier, serverless, integra directo con Vercel) — provisorio, a confirmar
- CI: **GitHub Actions** (lint + type-check)
- Tests del motor de simulación: **Vitest**

### Explícitamente descartado — no introducir sin autorización
Express.js, Redux, Socket.io, GraphQL, Docker Compose completo, Kubernetes, **Prisma** (con Postgres ahora es una
alternativa real de ORM — sigue descartado por ahora en favor de Drizzle, pero a diferencia de la época de Mongo ya
no es una incompatibilidad técnica, es una preferencia; se puede reabrir la discusión si hace falta).

---

## 4. Convenciones de código (regla estricta, sin excepciones)

- **Nomenclatura técnica en INGLÉS**: nombres de variables, funciones, clases, archivos, tablas y columnas de PostgreSQL, tipos.
- **Comentarios y documentación en ESPAÑOL**: todo comentario dentro del código, docstrings, mensajes de commit.
- **Comentar solo lo que no es obvio**: la lógica de negocio compleja o una decisión poco ortodoxa. No comentar lo que el código ya expresa por sí mismo (no explicar qué hace un `if` trivial).
- **TypeScript estricto** en todo el frontend/backend Next.js (`strict: true` en `tsconfig.json`). Nada de `any` sin justificación explícita en comentario.
- **SOLID, DRY, KISS.** Código modular y mantenible.
- **Un schema Zod por entidad**, reutilizado tanto en validación de formularios (cliente) como en Server Actions/API Routes (servidor). No dupliques la definición de forma de los datos.
- **Nombres descriptivos**, sin abreviaturas crípticas (`node` no `nd`, `perturbation` no `pert`).

### Ejemplo del estilo esperado

```typescript
// Calcula la propagación de un shock de capacidad hacia los nodos downstream.
// Se usa `remainingCapacity` en lugar de recalcular en cada iteración porque
// el motor corre este cálculo por cada tick — evitar trabajo redundante importa.
function propagateCapacityShock(node: SupplyChainNode, remainingCapacity: number): PropagationResult {
  // ...
}
```

---

## 5. Estructura de carpetas sugerida

```
twinchain/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # Rutas de autenticación
│   │   ├── (dashboard)/        # Rutas protegidas de la app
│   │   ├── api/                # API Routes
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                 # shadcn/ui (no tocar manualmente salvo necesidad)
│   │   ├── canvas/              # Nodos custom, edges custom, toolbar
│   │   ├── dashboard/            # Gráficos, KPIs
│   │   └── shared/
│   ├── lib/
│   │   ├── db/                  # Conexión Drizzle, schema y queries
│   │   ├── simulation/           # Motor de simulación determinístico
│   │   ├── ml-client/            # Cliente HTTP hacia el microservicio ML
│   │   ├── heuristics/            # Lógica de sugerencias
│   │   └── validators/            # Schemas Zod compartidos
│   ├── hooks/                    # Custom hooks React
│   ├── stores/                    # Zustand stores
│   └── types/                      # Tipos TypeScript compartidos
├── tests/
│   └── simulation/                 # Tests del motor (Vitest)
└── twinchain-ml/                    # Microservicio Python (repo o carpeta separada)
    ├── api.py
    ├── model_training.ipynb
    ├── requirements.txt
    └── Procfile
```

---

## 6. Requerimientos funcionales (resumen operativo)

*(Documento completo de referencia: `TwinChain_ERF.md`, ya generado — usalo como fuente de detalle si algo acá queda ambiguo)*

### Organizaciones y usuarios
- Multi-tenant: las cadenas pertenecen a la organización, no al usuario.
- Un usuario puede pertenecer a varias organizaciones.
- Solo el líder de la organización invita miembros.
- Todos los usuarios de una organización tienen el mismo nivel de permiso.

### Cadenas
- Privadas o compartidas dentro de la organización.
- Sin versionado ni edición colaborativa simultánea.
- Límite de 50 nodos por cadena.
- 3 plantillas predefinidas: lineal (5 nodos), bifurcada (10 nodos), compleja (20+ nodos).

### Editor de canvas
- 4 tipos de nodo: `supplier`, `factory`, `warehouse`, `customer`.
- Creación por drag & drop; conexión de aristas arrastrando entre extremos.
- Reglas de conexión válidas entre tipos (detalle en el modelo de datos adjunto).
- Aristas con propiedades propias: costo, lead time, capacidad, modo de transporte.
- Un nodo debe desconectarse antes de poder eliminarse.

### Digital Twin (monitoreo en tiempo real)
- Estado vivo por cadena, scripts sintéticos corriendo dentro del backend de Next.js.
- Velocidad acelerada: 1 tick = 1 segundo.
- Actualización en vivo hacia el cliente vía Server-Sent Events.

### Perturbaciones y simulación
- Mecanismos MVP demo: `capacity_shock`, `demand_shock`, `leadtime_shock`. MVP completo suma `cost_shock`, `yield_shock`.
- Cada perturbación define severidad, `onset` (semanas o meses) y `duration`.
- Una perturbación por simulación en la primera versión.
- Insertar una perturbación crea un **fork**; la cadena viva no se altera.
- Animación progresiva en el canvas mostrando la propagación (color distintivo, ej. rojo).
- Lógica de propagación configurable por nodo (absorción de buffer, política de distribución, participación en cascada).

### Machine Learning
- Modelo supervisado de clasificación binaria (backorder sí/no), entrenado sobre dataset público (ver `TwinChain_ML_Dataset_Analysis.md` y `TwinChain_ML_Training_Guide.md`).
- Corre en microservicio Python/FastAPI separado.
- Scoring en cada tick del monitoreo en tiempo real. No se aplica sobre simulaciones hipotéticas del motor determinístico.

### Alertas
- Generadas automáticamente cuando `probability > umbral` desde el modelo ML.
- Identifican nodo, probabilidad, momento de detección.
- Sin exportación ni notificaciones externas.

### Sugerencias
- Generadas por heurísticas de grafo (no ML): rutas alternativas, proveedores alternativos, incremento de buffer.
- El usuario elige: simular la sugerencia (nuevo escenario) o aplicarla a la cadena real.

### Escenarios y dashboard
- Escenario = fork + pila de eventos.
- Comparación de múltiples escenarios sin límite fijo.
- "Aplicar escenario" reemplaza el estado de la cadena base.
- Dashboard: nivel de servicio, costo total, lead time, utilización por nodo, nodos afectados, TTR.
- Sin exportación.

---

## 7. Recursos que se adjuntan junto a este documento

1. **HTML exportado de Claude Design** — wireframe de referencia visual de las 6 pantallas principales (colección de cadenas, canvas de inyección de perturbación, canvas modo escenario, dashboard de impacto, resumen ejecutivo, comparación de escenarios). Usalo como guía de UX/UI, no como especificación pixel-perfect — priorizá funcionalidad correcta sobre fidelidad visual exacta en el MVP.
2. **Estructura del modelo de datos** — schema de nodos, aristas, cadenas, escenarios y perturbaciones. Es la fuente de verdad para el schema de Drizzle y los tipos TypeScript compartidos. Si el modelo de datos entra en conflicto con algo de este documento, el modelo de datos tiene prioridad en lo estructural; este documento tiene prioridad en lo funcional.

---

## 8. Orden de desarrollo — ir por fases, no saltear

No avances a una fase sin que la anterior tenga al menos un flujo funcional probado.

### Fase 0 — Setup base
- Scaffold Next.js 15 + TypeScript + Tailwind + shadcn/ui.
- Conexión a PostgreSQL (Neon) + Drizzle ORM.
- Definir el schema de Drizzle a partir del modelo de datos adjunto.
- CI básico (lint + type-check).

**Entregable:** proyecto corriendo en local, conectado a la DB, sin funcionalidad de negocio todavía.

### Fase 1 — Organizaciones, autenticación y cadenas (CRUD)
- NextAuth.js (Google + credentials).
- Modelo de organizaciones + invitación de miembros.
- CRUD de cadenas (crear, listar, eliminar, privada/compartida).
- Listado de cadenas sin canvas todavía.

**Entregable:** usuario se loguea, crea una organización, crea cadenas vacías.

### Fase 2 — Editor de canvas
- React Flow + 4 custom nodes + custom edges.
- Drag & drop desde toolbar, reglas de conexión.
- Auto-layout con dagre.
- Serialización grafo ↔ PostgreSQL.
- 3 plantillas predefinidas.

**Entregable:** usuario diseña una cadena completa y la guarda.

### Fase 3 — Digital Twin (monitoreo en tiempo real)
- Scripts de datos sintéticos por tipo de nodo.
- Ticks acelerados (1s) corriendo en backend.
- SSE hacia el cliente.
- Visualización del estado vivo en el canvas.

**Entregable:** una cadena guardada "cobra vida" en el canvas.

### Fase 4 — Motor de simulación determinístico
- Ticks discretos para perturbaciones.
- 3 mecanismos MVP.
- Propagación configurable por nodo.
- Mecanismo de fork.
- Tests unitarios (determinismo).
- Animación de propagación en canvas.

**Entregable:** usuario inserta una perturbación y ve el impacto propagarse.

### Fase 5 — Microservicio ML (puede ir en paralelo a la Fase 4)
- Entrenamiento del modelo (ver guía adjunta).
- API FastAPI de scoring.
- Deploy en Railway/Render.
- Integración: backend llama al microservicio en cada tick.

**Entregable:** el sistema predice probabilidad de quiebre de stock en tiempo real.

### Fase 6 — Alertas y sugerencias
- Alertas por umbral ML o perturbación prolongada.
- Heurísticas de sugerencias.
- Acciones: simular vs. aplicar a cadena real.

**Entregable:** el sistema detecta y propone soluciones accionables.

### Fase 7 — Escenarios y dashboard
- Modo escenario con pila de eventos.
- Dashboard con Recharts.
- Comparación de escenarios.
- "Aplicar escenario a cadena base".

**Entregable:** flujo completo detectar → simular → comparar → decidir.

### Fase 8 — Polish y deploy final
- Resumen ejecutivo, responsive básico.
- Sentry, tests E2E de flujos críticos.
- Deploy productivo + dominio.

**Entregable:** aplicación online lista para defensa de tesis.

---

## 9. Reglas de proceso por módulo

Al empezar cada fase:
1. Confirmá que entendiste el alcance de la fase antes de generar código.
2. Si el modelo de datos adjunto no cubre algo que la fase necesita, preguntá — no lo inventes.
3. Al terminar la fase, indicá explícitamente cómo probarla manualmente (comandos, rutas, pasos).
4. No mezcles código de una fase futura "adelantándote" — mantené el scope acotado a lo que la fase pide.
