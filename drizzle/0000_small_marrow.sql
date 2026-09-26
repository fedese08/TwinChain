CREATE TYPE "public"."tipo_nodo" AS ENUM('Proveedor', 'Fabrica', 'Almacen', 'Vendedor', 'Cliente');--> statement-breakpoint
CREATE TYPE "public"."visibilidad_cadena" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TABLE "aristas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nodo_origen_id" uuid NOT NULL,
	"nodo_destino_id" uuid NOT NULL,
	"tiempo_transito" double precision NOT NULL,
	CONSTRAINT "aristas_sin_lazos" CHECK ("aristas"."nodo_origen_id" <> "aristas"."nodo_destino_id"),
	CONSTRAINT "aristas_transito_positivo" CHECK ("aristas"."tiempo_transito" > 0)
);
--> statement-breakpoint
CREATE TABLE "cadenas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"organizacion_id" uuid NOT NULL,
	"visibilidad" "visibilidad_cadena" DEFAULT 'shared' NOT NULL,
	"creada_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desempeno_semanal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nodo_id" uuid NOT NULL,
	"semana" date NOT NULL,
	"valor_real" double precision NOT NULL,
	"linea_base" double precision NOT NULL,
	"banda_inferior" double precision NOT NULL,
	"banda_superior" double precision NOT NULL,
	"deficit" double precision NOT NULL,
	CONSTRAINT "desempeno_deficit_no_negativo" CHECK ("desempeno_semanal"."deficit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "escenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"horizonte_proyeccion" double precision NOT NULL,
	"usuario_id" uuid NOT NULL,
	"cadena_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escenarios_horizonte_positivo" CHECK ("escenarios"."horizonte_proyeccion" > 0)
);
--> statement-breakpoint
CREATE TABLE "eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"magnitud" double precision NOT NULL,
	"nodo_id" uuid NOT NULL,
	"escenario_id" uuid NOT NULL,
	CONSTRAINT "eventos_magnitud_rango" CHECK ("eventos"."magnitud" > 0 AND "eventos"."magnitud" <= 100)
);
--> statement-breakpoint
CREATE TABLE "invitaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacion_id" uuid NOT NULL,
	"email" text NOT NULL,
	"rol_id" uuid NOT NULL,
	"invitada_por" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"aceptada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitaciones_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "nodos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_nodo" NOT NULL,
	"cadena_id" uuid NOT NULL,
	"etiqueta" text NOT NULL,
	"pos_x" double precision DEFAULT 0 NOT NULL,
	"pos_y" double precision DEFAULT 0 NOT NULL,
	"capacidad_suministro" double precision,
	"capacidad_produccion" double precision,
	"capacidad_almacenamiento" double precision,
	"nivel_stock_actual" double precision,
	CONSTRAINT "nodos_capacidades_no_negativas" CHECK (coalesce("nodos"."capacidad_suministro", 0) >= 0 AND coalesce("nodos"."capacidad_produccion", 0) >= 0 AND coalesce("nodos"."capacidad_almacenamiento", 0) >= 0 AND coalesce("nodos"."nivel_stock_actual", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "organizaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resultados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escenario_id" uuid NOT NULL,
	"fecha_corrida" date NOT NULL,
	"tabla_k" jsonb NOT NULL,
	"replicas" integer NOT NULL,
	"semilla" bigint NOT NULL,
	"semana_reconfiguracion" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles_usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"permisos" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "roles_usuario_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"contrasena" text,
	"rol_id" uuid,
	"organizacion_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_rol_org_juntos" CHECK (("usuarios"."rol_id" IS NULL) = ("usuarios"."organizacion_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "aristas" ADD CONSTRAINT "aristas_nodo_origen_id_nodos_id_fk" FOREIGN KEY ("nodo_origen_id") REFERENCES "public"."nodos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aristas" ADD CONSTRAINT "aristas_nodo_destino_id_nodos_id_fk" FOREIGN KEY ("nodo_destino_id") REFERENCES "public"."nodos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_organizacion_id_organizaciones_id_fk" FOREIGN KEY ("organizacion_id") REFERENCES "public"."organizaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_creada_por_usuarios_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desempeno_semanal" ADD CONSTRAINT "desempeno_semanal_nodo_id_nodos_id_fk" FOREIGN KEY ("nodo_id") REFERENCES "public"."nodos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escenarios" ADD CONSTRAINT "escenarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escenarios" ADD CONSTRAINT "escenarios_cadena_id_cadenas_id_fk" FOREIGN KEY ("cadena_id") REFERENCES "public"."cadenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_nodo_id_nodos_id_fk" FOREIGN KEY ("nodo_id") REFERENCES "public"."nodos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_escenario_id_escenarios_id_fk" FOREIGN KEY ("escenario_id") REFERENCES "public"."escenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_organizacion_id_organizaciones_id_fk" FOREIGN KEY ("organizacion_id") REFERENCES "public"."organizaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_rol_id_roles_usuario_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles_usuario"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_invitada_por_usuarios_id_fk" FOREIGN KEY ("invitada_por") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodos" ADD CONSTRAINT "nodos_cadena_id_cadenas_id_fk" FOREIGN KEY ("cadena_id") REFERENCES "public"."cadenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resultados" ADD CONSTRAINT "resultados_escenario_id_escenarios_id_fk" FOREIGN KEY ("escenario_id") REFERENCES "public"."escenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_roles_usuario_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles_usuario"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organizacion_id_organizaciones_id_fk" FOREIGN KEY ("organizacion_id") REFERENCES "public"."organizaciones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aristas_origen_destino_uq" ON "aristas" USING btree ("nodo_origen_id","nodo_destino_id");--> statement-breakpoint
CREATE INDEX "aristas_destino_idx" ON "aristas" USING btree ("nodo_destino_id");--> statement-breakpoint
CREATE INDEX "cadenas_organizacion_idx" ON "cadenas" USING btree ("organizacion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desempeno_nodo_semana_uq" ON "desempeno_semanal" USING btree ("nodo_id","semana");--> statement-breakpoint
CREATE INDEX "escenarios_cadena_idx" ON "escenarios" USING btree ("cadena_id");--> statement-breakpoint
CREATE INDEX "eventos_escenario_idx" ON "eventos" USING btree ("escenario_id");--> statement-breakpoint
CREATE INDEX "eventos_nodo_idx" ON "eventos" USING btree ("nodo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitaciones_pendiente_uq" ON "invitaciones" USING btree ("organizacion_id",lower("email")) WHERE "invitaciones"."aceptada_en" IS NULL;--> statement-breakpoint
CREATE INDEX "invitaciones_email_idx" ON "invitaciones" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "nodos_cadena_idx" ON "nodos" USING btree ("cadena_id");--> statement-breakpoint
CREATE INDEX "resultados_escenario_idx" ON "resultados" USING btree ("escenario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_lower_uq" ON "usuarios" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "usuarios_organizacion_idx" ON "usuarios" USING btree ("organizacion_id");