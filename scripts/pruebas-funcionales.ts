// Pruebas funcionales de integración de TwinChain: recorren el sistema por su API HTTP, con una base PostgreSQL real, igual
// que lo haría el navegador. Cada caso tiene un identificador (PF-xx), el requisito que cubre y un resultado esperado.
//
// Prerrequisitos (todo local, nada toca Neon ni Vercel):
//   1. Una base PostgreSQL vacía con las migraciones aplicadas (`npm run db:migrate` con DIRECT_URL apuntando a ella).
//   2. La app corriendo contra esa base: `DATABASE_URL=... AUTH_SECRET=... npx next dev -p 3100`.
//   3. Opcional, para los casos del modelo de ML: `cd twinchain-ml && ML_API_KEY=clave .venv/bin/uvicorn api:app --port 8001`
//      y la app con `ML_SERVICE_URL=http://127.0.0.1:8001 ML_API_KEY=clave`.
//
// Uso: `TEST_DB_URL=postgres://postgres@localhost:54329/twinchain npx tsx scripts/pruebas-funcionales.ts [salida.md]`
// Escribe una tabla con el resultado de cada caso y termina con código 1 si alguno falla.
/* eslint-disable @typescript-eslint/no-explicit-any --
   Es un script de pruebas que lee JSON de la API y filas de la base sin tipar: tiparlos uno por uno agregaría ruido sin
   proteger nada (cada caso comprueba el valor que le importa). */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { buildSystemAlerts } from "../src/lib/domain/alerts";
import { thresholdForCost } from "../src/lib/domain/cusum-config";
import { degradationStatus } from "../src/lib/domain/degradation";
import { addDaysIso } from "../src/lib/domain/synthetic/weeks";
import type { WeeklyPerformance } from "../src/lib/domain/types";

const BASE = process.env.APP_URL ?? "http://localhost:3100";
const DB_URL = process.env.TEST_DB_URL ?? "postgres://postgres@localhost:54329/twinchain";
const ML_URL = process.env.ML_URL; // si está, se prueba la integración con el modelo
const PASSWORD = "clave-de-prueba-123";
const STAMP = Date.now();
const sql = postgres(DB_URL, { max: 2 });

// ───────────────────────────── infraestructura mínima de pruebas ─────────────────────────────

interface Result {
  id: string;
  req: string;
  technique: string;
  title: string;
  ok: boolean;
  ms: number;
  detail: string;
}
const results: Result[] = [];

async function test(id: string, req: string, technique: string, title: string, fn: () => Promise<string | void>) {
  const started = performance.now();
  try {
    const detail = (await fn()) ?? "";
    results.push({ id, req, technique, title, ok: true, ms: performance.now() - started, detail });
  } catch (error) {
    results.push({ id, req, technique, title, ok: false, ms: performance.now() - started, detail: (error as Error).message });
  }
  const last = results[results.length - 1];
  console.log(`${last.ok ? "OK  " : "FAIL"} ${id} ${title}${last.ok ? "" : `  -> ${last.detail}`}`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const eq = <T>(actual: T, expected: T, what: string) => expect(Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), `${what}: se esperaba ${JSON.stringify(expected)} y salió ${JSON.stringify(actual)}`);

class Client {
  jar = new Map<string, string>();
  async raw(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      this.jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return res;
  }
  async call(method: string, path: string, body?: unknown) {
    const t0 = performance.now();
    const res = await this.raw(path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, body: json, ms: performance.now() - t0 };
  }
  async login(email: string, password = PASSWORD) {
    const csrf = (await (await this.raw("/api/auth/csrf")).json()) as { csrfToken: string };
    await this.raw("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, json: "true" }),
    });
    const session = (await (await this.raw("/api/auth/session")).json()) as { user?: { email?: string } } | null;
    return Boolean(session?.user?.email);
  }
}

async function register(email: string, tipo: "organizacion" | "empleado", orgName = "Org de prueba") {
  const c = new Client();
  const res = await c.call("POST", "/api/registro", { tipo, nombre: `Usuario ${email.split("@")[0]}`, email, password: PASSWORD, ...(tipo === "organizacion" ? { nombreOrganizacion: orgName } : {}), aceptaTratamiento: true });
  expect(res.status === 201, `el registro de ${email} falló (${res.status})`);
  expect(await c.login(email), `no se pudo iniciar sesión con ${email}`);
  return c;
}

const uuid = () => crypto.randomUUID();
const q = async <T = any>(text: string, ...params: unknown[]) => (await sql.unsafe(text, params as never[])) as unknown as T[];

const eventFor = (nodeId: string, magnitude = 40) => ({ id: uuid(), nodeId, eventType: "corte", startDate: addDaysIso(new Date().toISOString().slice(0, 10), -7), magnitude });
const waitRun = async (c: Client, scenarioId: string, runId: string, timeoutMs = 60_000) => {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const r = await c.call("GET", `/api/escenarios/${scenarioId}/corridas/${runId}`);
    if (r.body?.estado === "listo") return { result: r.body.result, ms: performance.now() - t0 };
    if (r.body?.estado === "fallido") throw new Error("la corrida falló");
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error("la corrida no terminó a tiempo");
};

async function rowsOfNode(nodeId: string): Promise<WeeklyPerformance[]> {
  const rows = await q<any>("select *, semana::text as semana_txt from desempeno_semanal where nodo_id = $1 order by semana", nodeId);
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodo_id,
    weekStart: r.semana_txt,
    actualValue: r.valor_real,
    baseline: r.linea_base,
    baselineLowerBand: r.banda_inferior,
    baselineUpperBand: r.banda_superior,
    deficit: r.deficit,
  }));
}

/** Manda `weeks` semanas de envíos con un mismo margen para un nodo, a continuación de su última semana. */
async function feed(c: Client, chainId: string, nodeId: string, margins: number[], shipmentsPerWeek = 3) {
  for (const margin of margins) {
    const [last] = (await rowsOfNode(nodeId)).slice(-1);
    const monday = addDaysIso(last.weekStart, 7);
    const envios = Array.from({ length: shipmentsPerWeek }, (_, i) => ({ fecha: addDaysIso(monday, i), margen: margin }));
    const res = await c.call("POST", `/api/cadenas/${chainId}/envios`, { nodeId, envios });
    expect(res.status === 200 || res.status === 201, `la ingesta de envíos falló (${res.status}: ${JSON.stringify(res.body)})`);
  }
}

// ───────────────────────────── datos de partida ─────────────────────────────

const emailA = `ada${STAMP}@prueba.test`;
const emailB = `beto${STAMP}@prueba.test`;
const emailOp = `omar${STAMP}@prueba.test`;
let A!: Client;
let B!: Client;
let OP!: Client;
let chainA = "";
let nodesA: { id: string; nodeType: string; label: string }[] = [];
let edgesA: { id: string }[] = [];
let scenarioA = "";
const timing: Record<string, number> = {};

async function main() {
  console.log(`Pruebas funcionales contra ${BASE} (base ${DB_URL.replace(/\/\/.*@/, "//***@")})\n`);

  // ── A. Registro, consentimiento y sesión ─────────────────────────────────────────────────────────
  await test("PF-01", "RF001, art. 6 Ley 25.326", "Funcional (API)", "El registro sin aceptar el tratamiento de datos se rechaza", async () => {
    const r = await new Client().call("POST", "/api/registro", { tipo: "organizacion", nombre: "Sin Aceptar", email: `sin${STAMP}@prueba.test`, password: PASSWORD, nombreOrganizacion: "X" });
    eq(r.status, 400, "estado");
    expect(JSON.stringify(r.body).includes("aceptar el tratamiento"), "el mensaje de error no menciona el consentimiento");
    eq((await q("select 1 from usuarios where email = $1", `sin${STAMP}@prueba.test`)).length, 0, "usuarios creados");
  });
  await test("PF-02", "RF001, RF002", "Funcional (API)", "Registro de una organización: crea la organización y deja a la persona como Administrador", async () => {
    A = await register(emailA, "organizacion", "Org A");
    const [u] = await q("select r.nombre as rol, o.plan from usuarios u join roles_usuario r on r.id = u.rol_id join organizaciones o on o.id = u.organizacion_id where u.email = $1", emailA);
    eq(u.rol, "Administrador", "rol");
    eq(u.plan, "freemium", "plan inicial");
  });
  await test("PF-03", "Seguridad", "Funcional (API)", "Un email repetido se rechaza (409) sin crear una segunda cuenta", async () => {
    const r = await new Client().call("POST", "/api/registro", { tipo: "empleado", nombre: "Otra Ada", email: emailA.toUpperCase(), password: PASSWORD, aceptaTratamiento: true });
    eq(r.status, 409, "estado");
  });
  await test("PF-04", "Seguridad", "Funcional (API)", "Una contraseña de menos de 8 caracteres se rechaza", async () => {
    const r = await new Client().call("POST", "/api/registro", { tipo: "empleado", nombre: "Corta", email: `corta${STAMP}@prueba.test`, password: "1234567", aceptaTratamiento: true });
    eq(r.status, 400, "estado");
  });
  await test("PF-05", "Seguridad", "Funcional (API)", "Inicio de sesión: la contraseña incorrecta no abre sesión y la correcta sí", async () => {
    expect(!(await new Client().login(emailA, "contraseña-equivocada")), "se abrió sesión con una contraseña incorrecta");
    expect(await new Client().login(emailA), "no se abrió sesión con la contraseña correcta");
  });
  await test("PF-06", "Seguridad", "Funcional (API)", "Sin sesión, los datos y las escrituras responden 401", async () => {
    const anon = new Client();
    eq((await anon.call("POST", "/api/cadenas", { name: "x", visibility: "shared", template: "blank" })).status, 401, "crear cadena");
    eq((await anon.call("DELETE", "/api/cuenta", {})).status, 401, "eliminar cuenta");
  });
  await test("PF-07", "Seguridad", "Prueba de robustez", "Un intento de inyección SQL en el email del inicio de sesión no rompe nada ni abre sesión", async () => {
    const c = new Client();
    expect(!(await c.login("' OR '1'='1' --", "x")), "abrió sesión con una inyección SQL");
    eq((await q("select count(*)::int as n from usuarios"))[0].n >= 1, true, "la tabla de usuarios sigue intacta");
  });

  // ── B. Cadena, nodos y aristas ───────────────────────────────────────────────────────────────────
  await test("PF-08", "RF003, RF005, RF008", "Funcional (API)", "Crear una cadena desde la plantilla lineal: 5 nodos de 5 tipos y 4 aristas con tránsito > 0", async () => {
    const t0 = performance.now();
    const r = await A.call("POST", "/api/cadenas", { name: "Cadena A", visibility: "shared", template: "linear" });
    timing.crearCadena = performance.now() - t0;
    eq(r.status, 201, "estado");
    chainA = r.body.chain.id;
    nodesA = r.body.nodes;
    edgesA = r.body.edges;
    eq(nodesA.length, 5, "nodos");
    eq(new Set(nodesA.map((n) => n.nodeType)).size, 5, "tipos distintos de nodo");
    eq(edgesA.length, 4, "aristas");
    return `${Math.round(timing.crearCadena)} ms`;
  });
  await test("PF-09", "RF012, RF013", "Funcional (API + base)", "Cada nodo nace con 28 semanas de historial, con línea base, banda y déficit nunca negativo", async () => {
    for (const n of nodesA) {
      const rows = await rowsOfNode(n.id);
      eq(rows.length, 28, `semanas del nodo ${n.id}`);
      expect(rows.every((r) => r.deficit >= 0), "hay un déficit negativo");
      expect(rows.every((r) => r.baselineLowerBand <= r.baseline && r.baseline <= r.baselineUpperBand), "la línea base queda fuera de su banda");
    }
  });
  await test("PF-10", "RF014", "Funcional (API + base)", "La línea base de un nodo está congelada: es la misma en todas sus semanas", async () => {
    for (const n of nodesA) eq(new Set((await rowsOfNode(n.id)).map((r) => r.baseline)).size, 1, "valores distintos de línea base");
  });
  await test("PF-11", "RF007", "Funcional (API)", "La capacidad de producción solo se acepta en una Fábrica y la de almacenamiento solo en un Almacén", async () => {
    const factory = nodesA.find((n) => n.nodeType === "Fabrica")!;
    const warehouse = nodesA.find((n) => n.nodeType === "Almacen")!;
    eq((await A.call("PATCH", `/api/nodos/${factory.id}`, { productionCapacity: 2500 })).status, 200, "capacidad de fábrica");
    eq((await A.call("PATCH", `/api/nodos/${warehouse.id}`, { storageCapacity: 4000 })).status, 200, "capacidad de almacén");
    eq((await A.call("PATCH", `/api/nodos/${warehouse.id}`, { productionCapacity: 10 })).status, 400, "producción en un almacén");
    eq((await A.call("PATCH", `/api/nodos/${factory.id}`, { productionCapacity: -5 })).status, 400, "capacidad negativa");
  });
  await test("PF-12", "RF008", "Funcional (API)", "El tiempo de tránsito de una arista se edita y debe ser mayor que cero; la arista no tiene costo", async () => {
    eq((await A.call("PATCH", `/api/aristas/${edgesA[0].id}`, { transitTimeDays: 9 })).status, 200, "editar tránsito");
    eq((await A.call("PATCH", `/api/aristas/${edgesA[0].id}`, { transitTimeDays: 0 })).status, 400, "tránsito 0");
    const cols = (await q("select column_name from information_schema.columns where table_name = 'aristas'")).map((c: any) => c.column_name);
    expect(!cols.some((c: string) => /costo|precio|cost/i.test(c)), "la tabla de aristas tiene una columna monetaria");
  });
  await test("PF-13", "Modelo de datos", "Funcional (API)", "Una arista de un nodo consigo mismo y una arista repetida se rechazan", async () => {
    const [a, b] = nodesA;
    eq((await A.call("POST", "/api/aristas", { id: uuid(), sourceNodeId: a.id, targetNodeId: a.id, transitTimeDays: 3 })).status >= 400, true, "lazo");
    const dup = await A.call("POST", "/api/aristas", { id: uuid(), sourceNodeId: a.id, targetNodeId: b.id, transitTimeDays: 3 });
    expect(dup.status >= 400, `se aceptó una arista repetida (${dup.status})`);
  });
  await test("PF-14", "Modelo de datos", "Funcional (API)", "Un nodo con aristas no se puede eliminar hasta desconectarlo", async () => {
    const mid = nodesA[1];
    const r = await A.call("DELETE", `/api/nodos/${mid.id}`);
    expect(r.status >= 400, `se eliminó un nodo conectado (${r.status})`);
    eq((await q("select 1 from nodos where id = $1", mid.id)).length, 1, "el nodo sigue existiendo");
  });

  // ── C. Planes ────────────────────────────────────────────────────────────────────────────────────
  await test("PF-15", "Planes (modelo de negocio)", "Funcional (API)", "Plan Freemium: se puede llegar a 6 nodos y el séptimo se rechaza con plan_limit", async () => {
    const add = (label: string) => A.call("POST", `/api/cadenas/${chainA}/nodos`, { id: uuid(), tipo: "Proveedor", etiqueta: label, x: 10, y: 10 });
    eq((await add("EXTRA-1")).status, 201, "sexto nodo");
    const seventh = await add("EXTRA-2");
    eq(seventh.status, 409, "séptimo nodo");
    eq(seventh.body.code, "plan_limit", "código");
  });
  await test("PF-16", "Planes", "Funcional (API)", "No hay tope de cadenas: una segunda cadena en blanco se crea, pero una plantilla que no entra en el plan se rechaza", async () => {
    eq((await A.call("POST", "/api/cadenas", { name: "Segunda", visibility: "shared", template: "blank" })).status, 201, "segunda cadena en blanco");
    const big = await A.call("POST", "/api/cadenas", { name: "Grande", visibility: "shared", template: "forked" });
    eq(big.status, 409, "plantilla bifurcada");
    eq(big.body.limit, "nodes", "tope alcanzado");
  });
  await test("PF-17", "Planes", "Funcional (API)", "Un downgrade que deja a la organización por encima de los topes se rechaza (plan_overage); un upgrade se acepta", async () => {
    eq((await A.call("PUT", "/api/organizacion/plan", { plan: "pro" })).status, 200, "pasar a Pro");
    eq((await A.call("POST", `/api/cadenas/${chainA}/nodos`, { id: uuid(), tipo: "Cliente", etiqueta: "EXTRA-3", x: 5, y: 5 })).status, 201, "séptimo nodo en Pro");
    const down = await A.call("PUT", "/api/organizacion/plan", { plan: "freemium" });
    eq(down.status, 409, "downgrade");
    eq(down.body.code, "plan_overage", "código");
    expect((await q("select plan from organizaciones where nombre = 'Org A'"))[0].plan === "pro", "el plan cambió pese al rechazo");
  });

  // ── D. Roles y aislamiento entre organizaciones ──────────────────────────────────────────────────
  await test("PF-18", "RF002, casos de uso", "Funcional (API)", "Invitar a una persona como Operador y aceptar la invitación con su cuenta", async () => {
    B = await register(emailB, "organizacion", "Org B");
    OP = await register(emailOp, "empleado");
    const inv = await A.call("POST", "/api/organizacion/invitaciones", { email: emailOp, rol: "operator" });
    eq(inv.status, 201, "crear invitación");
    const token = String(inv.body.link).split("/invitacion/")[1];
    const wrongPerson = await B.call("POST", "/api/invitaciones/aceptar", { token });
    expect(wrongPerson.status !== 200, "una cuenta de otra organización aceptó la invitación (el email no coincide)");
    eq((await OP.call("POST", "/api/invitaciones/aceptar", { token })).status, 200, "aceptar");
    eq((await q("select r.nombre from usuarios u join roles_usuario r on r.id = u.rol_id where u.email = $1", emailOp))[0].nombre, "Operador", "rol");
  });
  await test("PF-19", "RF002", "Funcional (API)", "El Operador no puede editar la red, invitar ni cambiar roles", async () => {
    eq((await OP.call("POST", "/api/cadenas", { name: "No", visibility: "shared", template: "blank" })).status, 403, "crear cadena");
    eq((await OP.call("PATCH", `/api/nodos/${nodesA[0].id}`, { label: "x" })).status, 403, "editar nodo");
    eq((await OP.call("POST", "/api/organizacion/invitaciones", { email: "x@prueba.test", rol: "operator" })).status, 403, "invitar");
    eq((await OP.call("PUT", "/api/organizacion/plan", { plan: "max" })).status, 403, "cambiar plan");
  });
  await test("PF-20", "RF002, Flujo B", "Funcional (API)", "El Operador sí puede crear una simulación", async () => {
    const r = await OP.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "Del operador", projectionHorizonWeeks: 8, events: [eventFor(nodesA[0].id)] });
    eq(r.status, 202, "estado");
  });
  await test("PF-21", "Casos de uso (Administrador)", "Funcional (API)", "El Administrador cambia el rol de otra persona (con efecto inmediato) y no puede cambiarse el suyo", async () => {
    const opId = (await q("select id from usuarios where email = $1", emailOp))[0].id;
    const meId = (await q("select id from usuarios where email = $1", emailA))[0].id;
    eq((await A.call("PATCH", `/api/organizacion/miembros/${opId}`, { rol: "admin" })).status, 200, "promover");
    eq((await OP.call("PATCH", `/api/nodos/${nodesA[0].id}`, { label: "OP-EDITA" })).status, 200, "el nuevo Administrador edita al instante");
    eq((await A.call("PATCH", `/api/organizacion/miembros/${opId}`, { rol: "operator" })).status, 200, "volver a Operador");
    const self = await A.call("PATCH", `/api/organizacion/miembros/${meId}`, { rol: "operator" });
    eq(self.status, 409, "cambio del propio rol");
  });
  await test("PF-22", "RNF03, RF001", "Funcional (API)", "Otra organización no ve ni modifica los datos de la primera: todo responde 404", async () => {
    eq((await B.call("PATCH", `/api/nodos/${nodesA[0].id}`, { label: "robado" })).status, 404, "editar nodo ajeno");
    eq((await B.call("DELETE", `/api/cadenas/${chainA}`)).status, 404, "borrar cadena ajena");
    eq((await B.call("POST", `/api/cadenas/${chainA}/avance`, { weeks: 1 })).status, 404, "avanzar cadena ajena");
    eq((await B.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "ajeno", projectionHorizonWeeks: 8, events: [eventFor(nodesA[0].id)] })).status, 404, "simular sobre cadena ajena");
    eq((await q("select etiqueta from nodos where id = $1", nodesA[0].id))[0].etiqueta === "robado", false, "el nodo fue modificado");
  });
  await test("PF-23", "RNF03", "Funcional (API)", "Una cadena privada solo la ve quien la creó, aunque sea de la misma organización", async () => {
    const priv = await A.call("POST", "/api/cadenas", { name: "Privada de Ada", visibility: "private", template: "blank" });
    eq(priv.status, 201, "crear privada");
    eq((await OP.call("POST", `/api/cadenas/${priv.body.chain.id}/avance`, { weeks: 1 })).status >= 400, true, "acceso de otro miembro");
  });
  await test("PF-24", "Gestión de integrantes", "Funcional (API)", "Quitar a una persona de la organización: pierde el acceso y los datos compartidos quedan", async () => {
    const opId = (await q("select id from usuarios where email = $1", emailOp))[0].id;
    eq((await A.call("DELETE", `/api/organizacion/miembros/${opId}`)).status, 200, "quitar");
    expect((await q("select organizacion_id from usuarios where id = $1", opId))[0].organizacion_id === null, "la persona sigue en la organización");
    expect((await OP.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "x", projectionHorizonWeeks: 8, events: [eventFor(nodesA[0].id)] })).status >= 400, "sigue teniendo acceso");
    eq((await q("select count(*)::int as n from cadenas where id = $1", chainA))[0].n, 1, "la cadena compartida se conserva");
  });

  // ── E. Ingesta, monitoreo y detección ────────────────────────────────────────────────────────────
  const nodeIngest = () => nodesA[0];
  await test("PF-25", "RF009, RF010", "Funcional (API + base)", "Ingesta de envíos: 3 envíos de una semana nueva se agregan en una fila con la media y la línea base congelada", async () => {
    const node = nodeIngest();
    const before = await rowsOfNode(node.id);
    const last = before[before.length - 1];
    const monday = addDaysIso(last.weekStart, 7);
    const res = await A.call("POST", `/api/cadenas/${chainA}/envios`, { nodeId: node.id, envios: [{ fecha: monday, margen: 2 }, { fecha: addDaysIso(monday, 1), margen: 4 }, { fecha: addDaysIso(monday, 2), margen: 6 }] });
    expect(res.status === 200 || res.status === 201, `estado ${res.status}: ${JSON.stringify(res.body)}`);
    const after = await rowsOfNode(node.id);
    eq(after.length, before.length + 1, "filas");
    const row = after[after.length - 1];
    expect(Math.abs(row.actualValue - 4) < 1e-9, `la media de la semana debía ser 4 y salió ${row.actualValue}`);
    eq(row.baseline, last.baseline, "línea base de la nueva fila");
    eq(row.deficit, Math.max(0, last.baseline - 4), "déficit");
  });
  await test("PF-26", "RF009, RF010", "Funcional (API)", "No se aceptan envíos de una semana que ya está registrada (409 stale_week)", async () => {
    const node = nodeIngest();
    const [last] = (await rowsOfNode(node.id)).slice(-1);
    const res = await A.call("POST", `/api/cadenas/${chainA}/envios`, { nodeId: node.id, envios: [{ fecha: last.weekStart, margen: 3 }] });
    eq(res.status, 409, "estado");
  });
  await test("PF-27", "RF006, RF014", "Funcional (API)", "El monitoreo vivo agrega una semana por nodo y no toca la historia ni la línea base", async () => {
    const node = nodesA[1];
    const before = await rowsOfNode(node.id);
    const t0 = performance.now();
    const r = await A.call("POST", `/api/cadenas/${chainA}/avance`, { weeks: 2 });
    timing.avance = performance.now() - t0;
    eq(r.status, 200, "estado");
    const after = await rowsOfNode(node.id);
    eq(after.length, before.length + 2, "filas nuevas");
    eq(JSON.stringify(after.slice(0, before.length)), JSON.stringify(before), "historia previa");
    eq(new Set(after.map((x) => x.baseline)).size, 1, "línea base");
    return `${Math.round(timing.avance)} ms`;
  });
  await test("PF-28", "RF006", "Funcional (API)", "Reiniciar el monitoreo vuelve a las 28 semanas originales", async () => {
    const r = await A.call("DELETE", `/api/cadenas/${chainA}/avance`);
    eq(r.status, 200, "estado");
    for (const n of nodesA) eq((await rowsOfNode(n.id)).length, 28, `semanas de ${n.id}`);
  });

  // Detección (Flujo A). Se alimentan los nodos con envíos sintéticos de margen controlado y se evalúa con el detector.
  const status = async (nodeId: string) => {
    const rows = await rowsOfNode(nodeId);
    const cost = (await q("select costo_falsa_alarma from cadenas where id = $1", chainA))[0].costo_falsa_alarma;
    return { rows, cost: Number(cost), ...degradationStatus(rows, thresholdForCost(Number(cost))) };
  };
  await test("PF-29", "RF018, HU1, HU2", "Funcional (API + detector)", "Una degradación sostenida (4 márgenes por debajo durante 8 semanas) se confirma, con desde cuándo y déficit acumulado", async () => {
    const node = nodesA[2];
    const base = (await rowsOfNode(node.id)).slice(-1)[0];
    const K = base.baseline - base.baselineLowerBand;
    await feed(A, chainA, node.id, Array(8).fill(base.baseline - 4 * K));
    const s = await status(node.id);
    expect(s.level === "alerta" && s.active, `el detector no confirmó la degradación (nivel ${s.level})`);
    const rows = s.rows;
    expect(s.active!.since <= rows[28].weekStart, `desde cuándo (${s.active!.since}) debe ser a lo sumo la primera semana degradada (${rows[28].weekStart})`);
    expect(s.active!.accumulatedDeficit > 0, "déficit acumulado vacío");
    return `desde ${s.active!.since}, ${s.active!.weeks} semanas, déficit ${s.active!.accumulatedDeficit.toFixed(1)} d`;
  });
  await test("PF-30", "HU1", "Funcional (API + detector)", "Un desvío aislado de una sola semana (1 margen) no dispara alerta", async () => {
    const node = nodesA[3];
    const base = (await rowsOfNode(node.id)).slice(-1)[0];
    const K = base.baseline - base.baselineLowerBand;
    await feed(A, chainA, node.id, [base.baseline - 1 * K, base.baseline, base.baseline, base.baseline]);
    const s = await status(node.id);
    const injected = s.rows[28].weekStart; // las alertas del historial previo son falsas alarmas esperables de la calibración: se cuentan solo las que confirma la semana inyectada
    expect(s.level === "normal" && s.run.episodes.every((e) => e.confirmedWeek < injected), `se disparó una alerta por una semana aislada (nivel ${s.level})`);
  });
  await test("PF-31", "RF019, HU1", "Funcional (API + detector)", "La sensibilidad configurable cambia el resultado: dos semanas a 1,5 márgenes se confirman con 'Máxima' y no con 'Baja'", async () => {
    const node = nodesA[4];
    const base = (await rowsOfNode(node.id)).slice(-1)[0];
    const K = base.baseline - base.baselineLowerBand;
    // La primera semana (2 márgenes por ENCIMA de la línea base) lleva el acumulado del CUSUM a cero: así el resultado no depende
    // de lo que arrastre el historial aleatorio del nodo. Después, dos semanas a 1,5 márgenes suman 1 margen: no alcanzan el
    // umbral de 'Baja' (2 márgenes) y sí el de 'Máxima' (0,25 márgenes).
    await feed(A, chainA, node.id, [base.baseline + 2 * K, base.baseline - 1.5 * K, base.baseline - 1.5 * K, base.baseline, base.baseline, base.baseline, base.baseline]);
    eq((await A.call("PATCH", `/api/cadenas/${chainA}`, { costoFalsaAlarma: 3 })).status, 200, "sensibilidad Baja");
    const low = await status(node.id);
    eq((await A.call("PATCH", `/api/cadenas/${chainA}`, { costoFalsaAlarma: 0 })).status, 200, "sensibilidad Máxima");
    const high = await status(node.id);
    const injected = low.rows[28].weekStart;
    expect(low.run.episodes.every((e) => e.confirmedWeek < injected), "con sensibilidad Baja se confirmó la degradación");
    expect(high.run.episodes.some((e) => e.confirmedWeek >= injected), "con sensibilidad Máxima no se confirmó la degradación");
    eq((await A.call("PATCH", `/api/cadenas/${chainA}`, { costoFalsaAlarma: 3 })).status, 200, "volver a Baja");
    eq((await A.call("PATCH", `/api/cadenas/${chainA}`, { costoFalsaAlarma: 9 })).status, 400, "sensibilidad fuera de rango");
  });
  await test("PF-32", "RF011, HU2", "Funcional (API + detector)", "El listado de alertas muestra la degradación vigente del nodo y no muestra a los nodos sanos", async () => {
    const nodes = (await q("select id, etiqueta, tipo, vendedor_olist_id, fuente_linea_base from nodos where cadena_id = $1", chainA)).map((n: any) => ({ id: n.id, chainId: chainA, label: n.etiqueta, nodeType: n.tipo, olistSellerId: n.vendedor_olist_id ?? undefined, baselineSource: n.fuente_linea_base }));
    const rows = (await Promise.all(nodes.map((n) => rowsOfNode(n.id)))).flat();
    const alerts = buildSystemAlerts({ chains: [{ id: chainA, name: "Cadena A", falseAlarmCost: 3 }], nodes, rows });
    const active = alerts.filter((a) => a.active);
    expect(active.some((a) => a.nodeId === nodesA[2].id && a.kind === "sostenida"), "falta la alerta del nodo degradado");
    // Se mira el nodo al que se le inyectaron semanas sanas (nodesA[3]): una alerta vigente que arranca en ellas sería un falso positivo del detector.
    // Los nodos sin semanas inyectadas solo tienen historial aleatorio, donde una falsa alarma es esperable por la calibración (no es un defecto).
    const cut3 = (await rowsOfNode(nodesA[3].id))[28].weekStart;
    expect(!active.some((a) => a.kind === "sostenida" && a.nodeId === nodesA[3].id && (a.since ?? "") >= cut3), "hay una degradación sostenida nueva en un nodo sano");
  });

  // ── F. Simulación (RF021–RF031, Flujo B) ─────────────────────────────────────────────────────────
  await test("PF-33", "RNF02, HU3", "Funcional (API)", "Crear una simulación con un evento responde 202 enseguida y la corrida termina en segundo plano", async () => {
    scenarioA = uuid();
    const t0 = performance.now();
    const r = await A.call("POST", "/api/escenarios", { id: scenarioA, chainId: chainA, name: "Corte en la fábrica", projectionHorizonWeeks: 12, events: [eventFor(nodesA[1].id, 50)] });
    timing.respuesta202 = performance.now() - t0;
    eq(r.status, 202, "estado");
    expect(r.body.run?.id, "la respuesta no trae el id de la corrida");
    const first = await waitRun(A, scenarioA, r.body.run.id);
    timing.corrida = first.ms;
    eq(first.result.kTable.length, 30, "filas de la tabla k (10 costos × 3 fracciones)");
    return `respuesta ${Math.round(timing.respuesta202)} ms, corrida lista en ${Math.round(first.ms)} ms`;
  });
  await test("PF-34", "RF029, RF028", "Funcional (API + base)", "La tabla k informa mediana y rango por fracción de propagación, y 'no cruza' como nulo, nunca como número", async () => {
    const [row] = await q("select tabla_k, replicas, semilla, estado from resultados where escenario_id = $1", scenarioA);
    eq(row.estado, "listo", "estado");
    const fractions = new Set(row.tabla_k.map((r: any) => r.fraccion));
    eq([...fractions].sort(), [0.45, 0.55, 0.65], "fracciones de propagación");
    const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    for (const r of row.tabla_k) {
      // 'no cruza' es null: nunca un texto, NaN ni un número inventado
      for (const campo of ["umbral_mediana", "umbral_min", "umbral_max"]) expect(r[campo] === null || isNum(r[campo]), `${campo} de k=${r.k} (fracción ${r.fraccion}) no es un número ni nulo: ${JSON.stringify(r[campo])}`);
      if (isNum(r.umbral_mediana)) expect(isNum(r.umbral_min) && isNum(r.umbral_max) && r.umbral_min <= r.umbral_mediana && r.umbral_mediana <= r.umbral_max, `rango incoherente en k=${r.k}`);
    }
    expect(row.replicas > 0 && Number.isFinite(Number(row.semilla)), "faltan réplicas o semilla");
    const medians = row.tabla_k.filter((r: any) => r.fraccion === 0.55).map((r: any) => r.umbral_mediana).filter((m: number | null) => m !== null);
    expect(medians.every((m: number, i: number) => i === 0 || m >= medians[i - 1]), "el umbral no crece con el costo k");
  });
  await test("PF-35", "RF030", "Funcional (API)", "Volver a correr con reconfiguración agrega una corrida nueva y no pisa la anterior", async () => {
    const before = await q("select id from resultados where escenario_id = $1 and estado = 'listo'", scenarioA);
    const r = await A.call("POST", `/api/escenarios/${scenarioA}/corridas`, { reconfigurationWeekIndex: 2 });
    eq(r.status, 202, "estado");
    const done = await waitRun(A, scenarioA, r.body.run.id);
    eq(done.result.reconfigurationWeekIndex, 2, "semana de reconfiguración");
    const after = await q("select id, semana_reconfiguracion from resultados where escenario_id = $1 and estado = 'listo' order by creado_en", scenarioA);
    eq(after.length, before.length + 1, "corridas guardadas");
    eq(after[0].id, before[0].id, "la primera corrida sigue siendo la misma");
  });
  await test("PF-36", "RF022, RF025", "Funcional (API)", "La semana de reconfiguración fuera del horizonte se rechaza", async () => {
    eq((await A.call("POST", `/api/escenarios/${scenarioA}/corridas`, { reconfigurationWeekIndex: 99 })).status, 400, "estado");
  });
  await test("PF-37", "RF026, Flujo B", "Funcional (API)", "Una simulación con dos eventos (de un nodo o de dos) se rechaza: es un evento por simulación", async () => {
    const two = [eventFor(nodesA[0].id), eventFor(nodesA[1].id)];
    eq((await A.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "dos", projectionHorizonWeeks: 8, events: two })).status, 400, "dos nodos");
    eq((await A.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "ninguno", projectionHorizonWeeks: 8, events: [] })).status, 400, "ningún evento");
  });
  await test("PF-38", "RF025, RF026", "Funcional (API)", "Entradas inválidas: horizonte fuera de rango, magnitud > 100 % y nodo de otra cadena se rechazan", async () => {
    eq((await A.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "h", projectionHorizonWeeks: 80, events: [eventFor(nodesA[0].id)] })).status, 400, "horizonte 80");
    eq((await A.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "m", projectionHorizonWeeks: 8, events: [eventFor(nodesA[0].id, 150)] })).status, 400, "magnitud 150");
    eq((await A.call("POST", "/api/escenarios", { id: uuid(), chainId: chainA, name: "n", projectionHorizonWeeks: 8, events: [eventFor(uuid())] })).status, 400, "nodo inexistente");
  });
  await test("PF-39", "RF024", "Funcional (base)", "El modelo de datos no tiene ninguna columna monetaria (resultados, eventos, escenarios, aristas)", async () => {
    const cols = (await q("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('resultados','eventos','escenarios','aristas','nodos','desempeno_semanal')")).map((c: any) => `${c.table_name}.${c.column_name}`);
    const money = cols.filter((c: string) => /costo|precio|monto|importe|usd|cost\b|price/i.test(c));
    expect(money.length === 0, `columnas monetarias: ${money.join(", ")}`);
  });
  await test("PF-40", "Planes", "Funcional (API)", "Tope de escenarios guardados: en Freemium el cuarto escenario se rechaza (plan_limit)", async () => {
    const c = await register(`tope${STAMP}@prueba.test`, "organizacion", "Org Tope");
    const chain = await c.call("POST", "/api/cadenas", { name: "Tope", visibility: "shared", template: "linear" });
    const node = chain.body.nodes[0].id;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await c.call("POST", "/api/escenarios", { id: uuid(), chainId: chain.body.chain.id, name: `E${i}`, projectionHorizonWeeks: 6, events: [eventFor(node)] });
      codes.push(r.status);
      if (r.body?.code) eq(r.body.code, "plan_limit", "código");
    }
    eq(codes, [202, 202, 202, 409], "estados de los cuatro pedidos");
  });
  await test("PF-41", "RF030", "Funcional (API + base)", "Eliminar una simulación borra sus eventos y todas sus corridas", async () => {
    const r = await A.call("DELETE", `/api/escenarios/${scenarioA}`);
    eq(r.status, 200, "estado");
    eq((await q("select (select count(*) from eventos where escenario_id = $1)::int + (select count(*) from resultados where escenario_id = $1)::int as n", scenarioA))[0].n, 0, "filas que quedaron");
  });
  await test("PF-42", "Robustez del job", "Prueba de robustez", "Una corrida que quedó 'corriendo' por más de 6 minutos (función perdida) se descarta y se informa como fallida", async () => {
    const c = await register(`job${STAMP}@prueba.test`, "organizacion", "Org Job");
    const chain = await c.call("POST", "/api/cadenas", { name: "Job", visibility: "shared", template: "linear" });
    const sid = uuid();
    const r = await c.call("POST", "/api/escenarios", { id: sid, chainId: chain.body.chain.id, name: "perdida", projectionHorizonWeeks: 6, events: [eventFor(chain.body.nodes[0].id)] });
    await waitRun(c, sid, r.body.run.id);
    await q("update resultados set estado = 'corriendo', tabla_k = '[]'::jsonb, replicas = 0, creado_en = now() - interval '10 minutes' where id = $1", r.body.run.id);
    const poll = await c.call("GET", `/api/escenarios/${sid}/corridas/${r.body.run.id}`);
    eq(poll.body.estado, "fallido", "estado informado");
    eq((await q("select 1 from escenarios where id = $1", sid)).length, 0, "el escenario sin corridas debe descartarse");
  });

  // ── G. Cuenta y privacidad ───────────────────────────────────────────────────────────────────────
  await test("PF-43", "Cuenta", "Funcional (API)", "Cambio de nombre y de contraseña: la contraseña actual es obligatoria y la nueva funciona", async () => {
    const c = await register(`perfil${STAMP}@prueba.test`, "organizacion", "Org Perfil");
    eq((await c.call("PATCH", "/api/cuenta", { nombre: "Nombre Nuevo" })).status, 200, "cambiar nombre");
    const wrong = await c.call("PUT", "/api/cuenta/contrasena", { actual: "no-es-esta", nueva: "otra-clave-456", confirmacion: "otra-clave-456" });
    expect(wrong.status >= 400, "se aceptó con la contraseña actual incorrecta");
    eq((await c.call("PUT", "/api/cuenta/contrasena", { actual: PASSWORD, nueva: "otra-clave-456", confirmacion: "otra-clave-456" })).status, 200, "cambiar contraseña");
    expect(await new Client().login(`perfil${STAMP}@prueba.test`, "otra-clave-456"), "la contraseña nueva no abre sesión");
  });
  await test("PF-44", "RF032", "Funcional (API + base)", "Eliminar la cuenta pide la contraseña; si es la única persona de la organización, se borra todo lo suyo", async () => {
    const email = `solo${STAMP}@prueba.test`;
    const c = await register(email, "organizacion", "Org Solo");
    await c.call("POST", "/api/cadenas", { name: "Se va", visibility: "shared", template: "linear" });
    const wrong = await c.call("DELETE", "/api/cuenta", { contrasena: "incorrecta" });
    eq(wrong.status, 400, "contraseña incorrecta");
    eq((await c.call("DELETE", "/api/cuenta", { contrasena: PASSWORD })).status, 200, "eliminar");
    eq((await q("select count(*)::int as n from usuarios where email = $1", email))[0].n, 0, "usuario");
    eq((await q("select count(*)::int as n from organizaciones where nombre = 'Org Solo'"))[0].n, 0, "organización");
    eq((await q("select count(*)::int as n from cadenas where nombre = 'Se va'"))[0].n, 0, "cadenas");
  });
  await test("PF-45", "RF032", "Funcional (API)", "La única administradora con más integrantes no puede eliminar su cuenta (409), y puede después de ceder el rol", async () => {
    const adminEmail = `adm${STAMP}@prueba.test`;
    const memberEmail = `mie${STAMP}@prueba.test`;
    const adm = await register(adminEmail, "organizacion", "Org Dos");
    const mem = await register(memberEmail, "empleado");
    const inv = await adm.call("POST", "/api/organizacion/invitaciones", { email: memberEmail, rol: "operator" });
    await mem.call("POST", "/api/invitaciones/aceptar", { token: String(inv.body.link).split("/invitacion/")[1] });
    const blocked = await adm.call("DELETE", "/api/cuenta", { contrasena: PASSWORD });
    eq(blocked.status, 409, "eliminar siendo la única administradora");
    const memId = (await q("select id from usuarios where email = $1", memberEmail))[0].id;
    await adm.call("PATCH", `/api/organizacion/miembros/${memId}`, { rol: "admin" });
    eq((await adm.call("DELETE", "/api/cuenta", { contrasena: PASSWORD })).status, 200, "eliminar tras ceder el rol");
    eq((await q("select count(*)::int as n from organizaciones where nombre = 'Org Dos'"))[0].n, 1, "la organización sigue existiendo");
  });

  // ── G2. Carga: el tope del plan Max (100 nodos) con el horizonte máximo (52 semanas) ─────────────
  await test("PF-48", "RNF01", "Prueba de carga", "Una simulación sobre una red de 100 nodos y 52 semanas termina en menos de 5 s (entorno local, app en modo desarrollo)", async () => {
    const c = await register(`max${STAMP}@prueba.test`, "organizacion", "Org Max");
    await q("update organizaciones set plan = 'max' where nombre = 'Org Max'");
    const chain = await c.call("POST", "/api/cadenas", { name: "Red de 100 nodos", visibility: "shared", template: "blank" });
    eq(chain.status, 201, "crear cadena");
    const chainId = chain.body.chain.id as string;
    const types = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"];
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = uuid();
      const r = await c.call("POST", `/api/cadenas/${chainId}/nodos`, { id, tipo: types[Math.floor(i / 20) % 5], etiqueta: `N-${i}`, x: (i % 20) * 120, y: Math.floor(i / 20) * 120 });
      eq(r.status, 201, `crear nodo ${i}`);
      ids.push(id);
    }
    // Red en capas de 20 nodos: cada nodo recibe de dos nodos de la capa anterior (200 aristas).
    let edges = 0;
    for (let i = 20; i < 100; i++) {
      for (const parent of [i - 20, (i - 20 + 1) % 20 + Math.floor((i - 20) / 20) * 20]) {
        const r = await c.call("POST", "/api/aristas", { id: uuid(), sourceNodeId: ids[parent], targetNodeId: ids[i], transitTimeDays: 7 });
        if (r.status === 201) edges++;
      }
    }
    expect(edges >= 100, `solo se crearon ${edges} aristas`);
    const sid = uuid();
    const t0 = performance.now();
    const r = await c.call("POST", "/api/escenarios", { id: sid, chainId, name: "Carga", projectionHorizonWeeks: 52, events: [eventFor(ids[0], 60)] });
    eq(r.status, 202, "estado");
    const done = await waitRun(c, sid, r.body.run.id, 30_000);
    const total = performance.now() - t0;
    timing.carga100nodos = total;
    expect(total < 5000, `la simulación tardó ${Math.round(total)} ms`);
    expect(done.result.kTable.length === 30, "tabla k incompleta");
    return `100 nodos, ${edges} aristas, 52 semanas: ${Math.round(total)} ms hasta tener el resultado`;
  });

  // ── H. Integración con el modelo de machine learning (opcional) ──────────────────────────────────
  if (ML_URL) {
    await test("PF-46", "RF015, RF016", "Integración", "Con el servicio de ML activo, las líneas base de los nodos nuevos salen del modelo ('ml') y traen banda semanal", async () => {
      const c = await register(`ml${STAMP}@prueba.test`, "organizacion", "Org ML");
      const chain = await c.call("POST", "/api/cadenas", { name: "Con ML", visibility: "shared", template: "linear" });
      eq(chain.status, 201, "crear cadena");
      const sources = (await q("select distinct fuente_linea_base from nodos where cadena_id = $1", chain.body.chain.id)).map((r: any) => r.fuente_linea_base);
      eq(sources, ["ml"], "fuente de la línea base");
      const [withBand] = await q("select count(*)::int as n from desempeno_semanal d join nodos n on n.id = d.nodo_id where n.cadena_id = $1 and d.banda_semanal_inferior is not null", chain.body.chain.id);
      expect(withBand.n > 0, "no hay banda semanal");
    });
    await test("PF-47", "Disponibilidad (RNF)", "Integración", "Con el servicio de ML caído, el sistema sigue operando con una línea base provisoria marcada como tal", async () => {
      const killed = process.env.ML_KILL_CMD;
      expect(killed, "falta ML_KILL_CMD para apagar el servicio durante la prueba");
      execFileSync("sh", ["-c", killed!]);
      await new Promise((r) => setTimeout(r, 800));
      const t0 = performance.now();
      const c = await register(`mlcaido${STAMP}@prueba.test`, "organizacion", "Org ML Caído");
      const chain = await c.call("POST", "/api/cadenas", { name: "Sin ML", visibility: "shared", template: "linear" });
      timing.sinMl = performance.now() - t0;
      eq(chain.status, 201, "crear cadena sin el servicio");
      const sources = (await q("select distinct fuente_linea_base from nodos where cadena_id = $1", chain.body.chain.id)).map((r: any) => r.fuente_linea_base);
      eq(sources, ["provisoria"], "fuente de la línea base");
      return `cadena creada en ${Math.round(timing.sinMl)} ms`;
    });
  }

  // ── Informe ──────────────────────────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    `# Resultados de las pruebas funcionales de integración`,
    ``,
    `Ejecutadas el ${new Date().toISOString().slice(0, 10)} con \`scripts/pruebas-funcionales.ts\` contra ${BASE}, base PostgreSQL local y ${ML_URL ? "servicio de ML local" : "sin servicio de ML"}.`,
    ``,
    `**${passed} de ${results.length} casos aprobados.**`,
    ``,
    `| Caso | Requisito | Técnica | Qué se verifica | Resultado | Tiempo (ms) | Detalle |`,
    `|---|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.id} | ${r.req} | ${r.technique} | ${r.title} | ${r.ok ? "Aprobado" : "FALLÓ"} | ${Math.round(r.ms)} | ${r.ok ? r.detail : r.detail.replace(/\|/g, "/")} |`),
    ``,
    `Tiempos medidos: ${Object.entries(timing).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")}.`,
    ``,
  ];
  const out = process.argv[2];
  if (out) writeFileSync(out, lines.join("\n"));
  console.log(`\n${passed} de ${results.length} casos aprobados`);
  await sql.end();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error("Error general:", error);
  await sql.end();
  process.exit(2);
});
