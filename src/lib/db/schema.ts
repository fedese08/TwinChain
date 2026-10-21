// Schema de Drizzle derivado de docs/modelo-datos.md — ese documento manda en lo estructural.
// Nombres de tablas y columnas en español (como el modelo); identificadores de TypeScript en inglés.
//
// Columnas que NO están en el modelo formal y se agregaron por necesidad de la app (todas
// marcadas abajo con "app:"): visibilidad y creador de la cadena, etiqueta y posición del nodo en
// el canvas, nombre del escenario, timestamps y la tabla de invitaciones.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const NODE_TYPE_VALUES = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"] as const;
export const tipoNodoEnum = pgEnum("tipo_nodo", NODE_TYPE_VALUES);

export const visibilidadCadenaEnum = pgEnum("visibilidad_cadena", ["shared", "private"]);

/**
 * Forma de cada fila de `resultados.tabla_k` (RF029): mediana y rango (percentiles 10 y 90), nunca un valor puntual.
 * `null` en el umbral = "no cruza" dentro del horizonte. `fraccion` es la fracción de propagación de la fila
 * (ausente en las corridas anteriores a la tabla por fracción) y `cruzan` la fracción de réplicas que sí cruzan.
 * Los nombres `umbral_min`/`umbral_max` se conservan por compatibilidad con las filas ya guardadas: hoy son p10/p90.
 */
export interface TablaKRow {
  k: number;
  fraccion?: number;
  cruzan?: number;
  umbral_mediana: number | null;
  umbral_min: number | null;
  umbral_max: number | null;
}

const pk = () => uuid("id").primaryKey().defaultRandom();
const creadoEn = () => timestamp("creado_en", { withTimezone: true }).notNull().defaultNow();

export const organizaciones = pgTable(
  "organizaciones",
  {
    id: pk(),
    nombre: text("nombre").notNull(),
    // app: plan de suscripción vigente de la organización (freemium | pro | max). Define los topes de nodos y de
    // escenarios guardados (ver `lib/plans.ts`). No hay cobro real: el cambio de plan lo hace un administrador.
    plan: text("plan").notNull().default("freemium"),
    // app: desde cuándo rige el plan actual.
    planDesde: timestamp("plan_desde", { withTimezone: true }).notNull().defaultNow(),
    creadoEn: creadoEn(),
  },
  (t) => [check("organizaciones_plan_valido", sql`${t.plan} IN ('freemium', 'pro', 'max')`)],
);

export const rolesUsuario = pgTable("roles_usuario", {
  id: pk(),
  nombre: text("nombre").notNull().unique(),
  // Lista abierta de acciones permitidas; qué significa cada permiso lo define la aplicación.
  permisos: text("permisos").array().notNull().default(sql`'{}'::text[]`),
});

export const usuarios = pgTable(
  "usuarios",
  {
    id: pk(),
    nombre: text("nombre").notNull(),
    email: text("email").notNull(),
    // Hash bcrypt. Nullable para poder sumar login con Google (sin contraseña) más adelante.
    contrasena: text("contrasena"),
    // app: un empleado se registra sin organización y queda "pendiente" hasta aceptar una invitación.
    rolId: uuid("rol_id").references(() => rolesUsuario.id, { onDelete: "restrict" }),
    organizacionId: uuid("organizacion_id").references(() => organizaciones.id, { onDelete: "restrict" }),
    creadoEn: creadoEn(),
  },
  (t) => [
    // Los emails se guardan en minúsculas; el índice sobre lower() protege igual ante datos externos.
    uniqueIndex("usuarios_email_lower_uq").on(sql`lower(${t.email})`),
    index("usuarios_organizacion_idx").on(t.organizacionId),
    // O pertenece a una organización con un rol, o a ninguna y sin rol. Nunca a medias.
    check("usuarios_rol_org_juntos", sql`(${t.rolId} IS NULL) = (${t.organizacionId} IS NULL)`),
  ],
);

// app: el modelo formal no cubre invitaciones; hace falta para "invitar usuarios a la organización".
export const invitaciones = pgTable(
  "invitaciones",
  {
    id: pk(),
    organizacionId: uuid("organizacion_id")
      .notNull()
      .references(() => organizaciones.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    rolId: uuid("rol_id")
      .notNull()
      .references(() => rolesUsuario.id, { onDelete: "restrict" }),
    invitadaPor: uuid("invitada_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    // Solo se guarda el hash SHA-256 del token: el token en claro viaja una vez en el link.
    tokenHash: text("token_hash").notNull().unique(),
    expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
    aceptadaEn: timestamp("aceptada_en", { withTimezone: true }),
    creadoEn: creadoEn(),
  },
  (t) => [
    // Una sola invitación pendiente por email y organización.
    uniqueIndex("invitaciones_pendiente_uq")
      .on(t.organizacionId, sql`lower(${t.email})`)
      .where(sql`${t.aceptadaEn} IS NULL`),
    index("invitaciones_email_idx").on(sql`lower(${t.email})`),
  ],
);

export const cadenas = pgTable(
  "cadenas",
  {
    id: pk(),
    nombre: text("nombre").notNull(),
    organizacionId: uuid("organizacion_id")
      .notNull()
      .references(() => organizaciones.id, { onDelete: "cascade" }),
    // app: "compartida" con toda la organización o "privada" de quien la creó.
    visibilidad: visibilidadCadenaEnum("visibilidad").notNull().default("shared"),
    creadaPor: uuid("creada_por")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    // app: costo de una falsa alarma (semanas de operar degradado). Fija el umbral del CUSUM de la cadena (HU1: umbral
    // configurable; RF019). 3 = el costo de reconfigurar, la cota superior.
    costoFalsaAlarma: doublePrecision("costo_falsa_alarma").notNull().default(3),
    creadoEn: creadoEn(),
  },
  (t) => [
    index("cadenas_organizacion_idx").on(t.organizacionId),
    check("cadenas_costo_falsa_alarma_rango", sql`${t.costoFalsaAlarma} >= 0 AND ${t.costoFalsaAlarma} <= 3`),
  ],
);

// Herencia de tabla única (nota de implementación del modelo): una sola tabla `nodos` con las
// columnas propias de cada tipo, todas nullable. Qué campo corresponde a qué tipo se valida en la app.
export const nodos = pgTable(
  "nodos",
  {
    id: pk(),
    tipo: tipoNodoEnum("tipo").notNull(),
    cadenaId: uuid("cadena_id")
      .notNull()
      .references(() => cadenas.id, { onDelete: "cascade" }),
    // app: código visible en canvas y tablas (ej. "FAB-02") y posición en el canvas.
    etiqueta: text("etiqueta").notNull(),
    posX: doublePrecision("pos_x").notNull().default(0),
    posY: doublePrecision("pos_y").notNull().default(0),
    capacidadSuministro: doublePrecision("capacidad_suministro"),
    capacidadProduccion: doublePrecision("capacidad_produccion"),
    capacidadAlmacenamiento: doublePrecision("capacidad_almacenamiento"),
    // Dato descriptivo: NO entra en ninguna fórmula del motor (RF027).
    nivelStockActual: doublePrecision("nivel_stock_actual"),
    // app: nodo Vendedor con datos REALES de Olist. `vendedor_olist_id` es el seller_id anonimizado cuyo
    // historial usa; su desempeño está en DÍAS de margen (margin_days), no en la escala 0-100 de los nodos
    // sintéticos. Null = nodo sintético. `fuente_linea_base` dice de dónde salió su línea base: "ml" (modelo
    // de línea base) o "provisoria" (estimador de respaldo cuando el servicio de ML no contestó).
    vendedorOlistId: text("vendedor_olist_id"),
    fuenteLineaBase: text("fuente_linea_base"),
  },
  (t) => [
    index("nodos_cadena_idx").on(t.cadenaId),
    // `fuente_linea_base` marca a un nodo que mide en días (línea base del modelo de ML o provisoria); un vendedor
    // real de Olist (camino inactivo) siempre la tiene.
    check(
      "nodos_fuente_linea_base_valida",
      sql`(${t.fuenteLineaBase} IS NULL OR ${t.fuenteLineaBase} IN ('ml', 'provisoria')) AND (${t.vendedorOlistId} IS NULL OR ${t.fuenteLineaBase} IS NOT NULL)`,
    ),
    check(
      "nodos_capacidades_no_negativas",
      sql`coalesce(${t.capacidadSuministro}, 0) >= 0 AND coalesce(${t.capacidadProduccion}, 0) >= 0 AND coalesce(${t.capacidadAlmacenamiento}, 0) >= 0 AND coalesce(${t.nivelStockActual}, 0) >= 0`,
    ),
  ],
);

// Sin costo, capacidad ni modo de transporte: decisión explícita del modelo (nada monetario).
export const aristas = pgTable(
  "aristas",
  {
    id: pk(),
    nodoOrigenId: uuid("nodo_origen_id")
      .notNull()
      .references(() => nodos.id, { onDelete: "cascade" }),
    nodoDestinoId: uuid("nodo_destino_id")
      .notNull()
      .references(() => nodos.id, { onDelete: "cascade" }),
    tiempoTransito: doublePrecision("tiempo_transito").notNull(),
  },
  (t) => [
    uniqueIndex("aristas_origen_destino_uq").on(t.nodoOrigenId, t.nodoDestinoId),
    index("aristas_destino_idx").on(t.nodoDestinoId),
    check("aristas_sin_lazos", sql`${t.nodoOrigenId} <> ${t.nodoDestinoId}`),
    check("aristas_transito_positivo", sql`${t.tiempoTransito} > 0`),
  ],
);

export const desempenoSemanal = pgTable(
  "desempeno_semanal",
  {
    id: pk(),
    nodoId: uuid("nodo_id")
      .notNull()
      .references(() => nodos.id, { onDelete: "cascade" }),
    semana: date("semana", { mode: "string" }).notNull(),
    valorReal: doublePrecision("valor_real").notNull(),
    // Congelada al momento de la decisión: no se recalcula con el tiempo.
    lineaBase: doublePrecision("linea_base").notNull(),
    bandaInferior: doublePrecision("banda_inferior").notNull(),
    bandaSuperior: doublePrecision("banda_superior").notNull(),
    // app: banda de UNA semana individual (CQR semanal del modelo de ML), la que sirve para alertas semana a
    // semana. Solo la tienen los nodos con línea base del modelo; null en el resto.
    bandaSemanalInferior: doublePrecision("banda_semanal_inferior"),
    bandaSemanalSuperior: doublePrecision("banda_semanal_superior"),
    // linea_base − valor_real, nunca negativo: las semanas buenas no compensan a las malas.
    deficit: doublePrecision("deficit").notNull(),
  },
  (t) => [
    uniqueIndex("desempeno_nodo_semana_uq").on(t.nodoId, t.semana),
    check("desempeno_deficit_no_negativo", sql`${t.deficit} >= 0`),
    check("desempeno_banda_semanal_completa", sql`(${t.bandaSemanalInferior} IS NULL) = (${t.bandaSemanalSuperior} IS NULL)`),
  ],
);

export const escenarios = pgTable(
  "escenarios",
  {
    id: pk(),
    // app: identificador legible en listados.
    nombre: text("nombre").notNull(),
    // Horizonte H, en semanas: la única magnitud temporal que carga el usuario.
    horizonteProyeccion: doublePrecision("horizonte_proyeccion").notNull(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    cadenaId: uuid("cadena_id")
      .notNull()
      .references(() => cadenas.id, { onDelete: "cascade" }),
    // app: semana de la decisión de reconfigurar (s_r). Null = simulación manual (s_r es el inicio del primer
    // evento); con valor = simulación desde una alerta (s_r es la semana siguiente a la detección).
    semanaDecision: date("semana_decision", { mode: "string" }),
    creadoEn: creadoEn(),
  },
  (t) => [
    index("escenarios_cadena_idx").on(t.cadenaId),
    check("escenarios_horizonte_positivo", sql`${t.horizonteProyeccion} > 0`),
  ],
);

// Nunca lleva duración: es la incógnita que resuelve el sistema. Un escenario afecta un único nodo
// (se valida en la app), pero `nodo_id` vive acá para no cerrar la puerta a C29.
export const eventos = pgTable(
  "eventos",
  {
    id: pk(),
    tipo: text("tipo").notNull(),
    fechaInicio: date("fecha_inicio", { mode: "string" }).notNull(),
    magnitud: doublePrecision("magnitud").notNull(),
    nodoId: uuid("nodo_id")
      .notNull()
      .references(() => nodos.id, { onDelete: "cascade" }),
    escenarioId: uuid("escenario_id")
      .notNull()
      .references(() => escenarios.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("eventos_escenario_idx").on(t.escenarioId),
    index("eventos_nodo_idx").on(t.nodoId),
    check("eventos_magnitud_rango", sql`${t.magnitud} > 0 AND ${t.magnitud} <= 100`),
  ],
);

// Cada corrida se conserva por separado y nunca se pisa (RF030).
export const resultados = pgTable(
  "resultados",
  {
    id: pk(),
    escenarioId: uuid("escenario_id")
      .notNull()
      .references(() => escenarios.id, { onDelete: "cascade" }),
    fechaCorrida: date("fecha_corrida", { mode: "string" }).notNull(),
    tablaK: jsonb("tabla_k").$type<TablaKRow[]>().notNull(),
    replicas: integer("replicas").notNull(),
    // Semilla del PRNG: junto con `replicas` permite reproducir la corrida exacta (RF030).
    semilla: bigint("semilla", { mode: "number" }).notNull(),
    // Semana del horizonte en que se reconfiguró (escalón, RF022); null = no se reconfiguró.
    semanaReconfiguracion: integer("semana_reconfiguracion"),
    // app: el motor corre como job en segundo plano (E90, arquitectura): la fila nace `corriendo` con la tabla vacía y
    // pasa a `listo` cuando el job la completa. Solo las `listo` son resultados; si el job falla, la fila se descarta.
    estado: text("estado").notNull().default("listo"),
    // app: `fecha_corrida` es solo una fecha; este timestamp ordena varias corridas del mismo día.
    creadoEn: creadoEn(),
  },
  (t) => [
    index("resultados_escenario_idx").on(t.escenarioId),
    check("resultados_estado_valido", sql`${t.estado} IN ('corriendo', 'listo')`),
  ],
);

export type Organizacion = typeof organizaciones.$inferSelect;
export type RolUsuarioRow = typeof rolesUsuario.$inferSelect;
export type UsuarioRow = typeof usuarios.$inferSelect;
export type InvitacionRow = typeof invitaciones.$inferSelect;
export type CadenaRow = typeof cadenas.$inferSelect;
export type NodoRow = typeof nodos.$inferSelect;
export type AristaRow = typeof aristas.$inferSelect;
export type DesempenoSemanalRow = typeof desempenoSemanal.$inferSelect;
export type EscenarioRow = typeof escenarios.$inferSelect;
export type EventoRow = typeof eventos.$inferSelect;
export type ResultadoRow = typeof resultados.$inferSelect;
