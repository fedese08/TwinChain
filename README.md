# TwinChain

**Monitoreo y simulación de disrupciones en cadenas de suministro.**

TwinChain es una plataforma web que modela una cadena de suministro como un grafo, vigila el desempeño semanal de cada
nodo contra su nivel normal y permite simular qué pasaría si una disrupción se sostiene, para decidir **cuándo conviene
reconfigurar la cadena** (por ejemplo, cambiar de proveedor) y cuándo seguir mitigando.

Producción: <https://twinchain.vercel.app>

## Para qué se hizo

Es el **Proyecto Final de Ingeniería (PFI)** de la Universidad Argentina de la Empresa (UADE). El problema que
ataca sale de una entrevista del relevamiento: un equipo detectó con sus propios indicadores la caída de un
subcontratista a los 20 días, y el proveedor la reconoció recién a los 45. Entre un momento y otro hay una decisión que
tomar (aguantar o reconfigurar) y hoy se toma sin un criterio explícito.

El aporte de la tesis es ese criterio: **para cada costo de reconfigurar, cuántas semanas tiene que sostenerse el
problema para que el cambio se pague**. TwinChain observa y proyecta; la decisión sigue siendo de quien la toma.

## Autores

| Autor | Legajo |
|---|---|
| Sena, Federico | 1112998 |
| Guevara, Facundo | 1113997 |

Proyecto Final de Ingeniería, UADE, 2026. Contacto: fsena@uade.edu.ar.

## Qué hace

Dos capas de análisis que no se mezclan:

1. **Monitoreo tipo Digital Twin.** Cada nodo (Proveedor, Fábrica, Almacén, Vendedor, Cliente) reporta su desempeño por
   semana. Un modelo de machine learning, entrenado con datos reales de Olist, estima su **línea base** (qué es normal)
   y una **banda de incertidumbre** a partir de sus primeras semanas. Una regla CUSUM suma los desvíos y confirma una
   **degradación sostenida** cuando lo acumulado supera un umbral calibrado; avisa desde cuándo y con cuánto déficit.
2. **Simulación hipotética.** Un escenario agrupa un evento (corte, huelga, demora…) sobre un nodo. El motor propaga
   el golpe por la red semana a semana, con el retraso de tránsito de cada arista, y devuelve cuánta operación se pierde
   y, para cada costo de reconfigurar, **a partir de cuántas semanas conviene hacerlo** (tabla N(k), con mediana y rango
   p10–p90). La simulación puede partir de una alerta real o de cualquier caso hipotético, y no altera la cadena viva.

Además: organizaciones con roles (Administrador y Operador), invitaciones, tres planes (Freemium, Pro y Max) con topes
de nodos y escenarios, comparación de simulaciones, alertas derivadas del monitoreo e ingesta de envíos desde un CSV.

## Cómo se construyó

- **Aplicación**: monolito en Next.js 15 (App Router) con React 19 y TypeScript. Interfaz con Tailwind y componentes de
  shadcn/ui; el canvas de la cadena usa React Flow y los gráficos, Recharts. Estado de trabajo en el cliente con Zustand.
- **Datos**: PostgreSQL en Neon (región São Paulo) con Drizzle como ORM y migraciones versionadas en `drizzle/`.
  Multi-tenant por organización: toda consulta filtra por la organización de la sesión.
- **Autenticación**: Auth.js v5 con credenciales y contraseñas con bcrypt.
- **Motor de simulación**: núcleo puro y determinístico en `src/lib/domain/`. Propaga con una recurrencia semanal
  (cuesta lo mismo sin importar cuántos caminos tenga la red) y corre en segundo plano en el servidor. Las definiciones
  metodológicas están en [`docs/definiciones-motor.md`](docs/definiciones-motor.md).
- **Modelo de ML** (`twinchain-ml/`): microservicio en Python (FastAPI y scikit-learn) con tres modelos de gradient
  boosting por cuantiles (0,1 / 0,5 / 0,9) y calibración de la banda por regresión cuantílica conformal. Se entrenó con
  110.187 ítems reales de Olist y se evaluó en 292 vendedores que no había visto. Corre en Docker (Render). Si no
  contesta, la app usa una línea base provisoria y la marca como tal.
- **Sensores**: como no hay sensores reales, un generador sintético los simula (envíos individuales que la ingesta
  agrega por semana). La fuente se puede reemplazar por datos reales sin cambiar el resto. Ver
  [`docs/ingesta-sintetica.md`](docs/ingesta-sintetica.md).
- **Despliegue**: Vercel (funciones fijadas en São Paulo, junto a la base), Neon y Render. Integración continua con
  GitHub Actions.
- **Proceso**: desarrollo incremental por fases, con la documentación del modelo de datos y de las definiciones del
  motor como fuente de verdad, y verificación en cada paso. El desarrollo contó con la asistencia de Claude Code bajo
  esas reglas, que quedaron escritas en `CLAUDE.md`.

## Calidad

- **181 pruebas unitarias** (Vitest), que incluyen las calibraciones de Monte Carlo del CUSUM.
- **22 pruebas** del servicio de ML (pytest).
- **48 casos funcionales de integración** contra la API y una base local
  ([resultados](docs/pruebas-funcionales-resultados.md)).
- Una simulación de una red de 100 nodos y 52 semanas tarda 191 ms medida en local, contra los 5 s exigidos.

## Cómo correrlo

Requisitos: Node.js, una base PostgreSQL (se usa Neon) y, opcionalmente, Python para el servicio de ML.

```bash
npm install
cp .env.example .env.local     # completar DATABASE_URL, DIRECT_URL y AUTH_SECRET
npm run db:migrate             # crea las tablas
npm run db:seed                # datos de ejemplo
npm run dev                    # http://localhost:3000
```

Sin `ML_SERVICE_URL` y `ML_API_KEY` la app funciona igual, con la línea base provisoria. Para levantar el servicio de ML
en local, ver [`twinchain-ml/README.md`](twinchain-ml/README.md).

| Script | Para qué |
|---|---|
| `npm test` | Pruebas unitarias |
| `npm run typecheck` / `npm run lint` | Verificación estática |
| `npm run test:funcional` | Casos funcionales de integración (requiere una base local) |
| `npm run db:seed:demo` | Caso de demostración «Hogar Andino» con una alerta vigente y simulaciones guardadas |
| `npm run db:studio` | Explorador de la base |

La serie del sensor de la demo depende de la fecha: conviene volver a correr `db:seed:demo` el día de una presentación
y releer las cifras en pantalla.

## Estructura

```
src/app/          Pantallas y rutas de API (Next.js App Router)
src/lib/domain/   Motor de simulación, detección, alertas y generador sintético
src/lib/db/       Esquema de Drizzle y cliente
src/stores/       Estado de trabajo del cliente
twinchain-ml/     Microservicio de ML (entrenamiento, validación y API)
scripts/          Seed, demo, calibración y pruebas funcionales
docs/             Modelo de datos, definiciones del motor, ML y mediciones
drizzle/          Migraciones
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/modelo-datos.md`](docs/modelo-datos.md) | Modelo de datos (fuente de verdad estructural) |
| [`docs/definiciones-motor.md`](docs/definiciones-motor.md) | Definiciones del motor de simulación |
| [`docs/modelo-ml.md`](docs/modelo-ml.md) | Modelo de ML, validación y límites |
| [`docs/ingesta-sintetica.md`](docs/ingesta-sintetica.md) | Sensores simulados e ingesta semanal |
| [`docs/TwinChain-DEV.md`](docs/TwinChain-DEV.md) | Contexto funcional y de proceso |
| [`docs/pendientes.md`](docs/pendientes.md) | Mejoras abiertas y decisiones pendientes |

## Alcance y límites

Es un prototipo académico. En su estado actual:

- No hay una magnitud monetaria en ningún punto del sistema: el costo de reconfigurar se expresa en semanas de operar
  como hoy.
- El modelo de ML se entrenó una sola vez y no se reentrena. Frente a una regresión lineal la mejora del error es
  mínima, y sobre nodos simulados subestima el nivel en unos 0,45 días (ver `docs/modelo-ml.md`).
- La cantidad de clientes del modelo económico son hipótesis del equipo, no una medición.
- Los sensores son simulados; la ingesta ya acepta envíos de una fuente real, pero no hay una integración productiva.
- El servicio de ML y la base corren en planes gratuitos.
