# Stack tecnológico — TwinChain

Referencia de qué se usa (o se va a usar) en el proyecto, y en qué estado está cada pieza. Fuente de verdad
del stack obligatorio: `docs/TwinChain-DEV.md` (sección 3). Este documento es el detalle operativo — qué está
instalado hoy, qué falta, y las sugerencias propias marcadas como tales.

> **Pendiente de confirmar:** la base cambió de MongoDB a PostgreSQL por pedido tuyo, pero todavía no elegiste ORM
> ni proveedor de hosting. Dejé **Drizzle ORM** (no choca con el Prisma descartado) y **Neon** (integra con Vercel)
> como default provisorio en la tabla de abajo — avisame si preferís otra cosa antes de que empecemos a escribir
> el schema en la Fase 1.

## Frontend — ya instalado

| Pieza | Para qué |
|---|---|
| **Next.js 15** (App Router) + **React 19** | framework/UI |
| **TypeScript** (`strict: true`) | tipado |
| **Tailwind CSS v4** | estilos |
| **shadcn/ui** (preset `base-nova`, sobre `@base-ui/react`) | sistema de componentes |
| **@xyflow/react** (React Flow 12) | canvas de nodos/aristas |
| **dagre** | auto-layout del grafo |
| **Recharts v3** | gráficos (déficit semanal, tabla_k) |
| **Zustand** | estado del canvas/simulación (hoy: `mock-db-store`) |
| **react-hook-form + Zod + @hookform/resolvers** | formularios y validación (cliente y servidor) |
| **sonner** | toasts |
| **lucide-react** | iconos |
| **class-variance-authority, clsx, tailwind-merge, tw-animate-css** | utilidades de estilos que trae shadcn |

## Pendiente — a sumar en las próximas fases

| Pieza | Para qué | Fase |
|---|---|---|
| **TanStack Query v5** | estado de servidor / cache de fetch | cuando haya backend real (Fase 1+) |
| **NextAuth.js (Auth.js) v5** | login Google + credentials | Fase 1 |
| **PostgreSQL (Neon) + Drizzle ORM** | base de datos y capa de acceso — reemplaza a MongoDB + Mongoose por decisión del usuario (ver `docs/modelo-datos.md`, sección "Migración de motor"). Nada de esto está instalado todavía: `src/lib/db/connect.ts` y `src/lib/db/models/` siguen en Mongoose, quedan obsoletos y se reescriben enteros en la Fase 1 | Fase 1 |
| **Python 3.12+ / FastAPI / Uvicorn** | microservicio ML, separado del monolito | Fase 5 |
| **scikit-learn, XGBoost, pandas, joblib** | entrenamiento e inferencia del modelo | Fase 5 |
| **Vitest** | tests del motor de simulación — el script `npm run test` ya existe en `package.json` pero el paquete todavía no está instalado | cuando arranque el motor real (Fase 4) |
| **Sentry** | monitoreo de errores en producción | Fase 8 |
| **Vercel** | deploy del monolito Next.js | Fase 8 |
| **Railway o Render** | deploy del microservicio ML | Fase 5/8 |
| **GitHub Actions** | CI (lint + typecheck) | ✅ ya configurado en `.github/workflows/ci.yml` |

**Sugerencia propia, no en el spec original:** para los "tests E2E de flujos críticos" de la Fase 8,
**Playwright** es la opción natural con Next.js. Queda propuesto, no instalado — a confirmar cuando llegue esa fase.

## Explícitamente descartado

No introducir sin autorización (definido en `docs/TwinChain-DEV.md`):

Express.js, Redux, Socket.io, GraphQL, Docker Compose completo, Kubernetes, Prisma (con Mongo era incompatible; con
Postgres es una alternativa real de ORM a Drizzle — sigue descartado por ahora, pero es una preferencia, no una
incompatibilidad técnica).
