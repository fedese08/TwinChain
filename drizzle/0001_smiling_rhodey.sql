ALTER TABLE "desempeno_semanal" ADD COLUMN "banda_semanal_inferior" double precision;--> statement-breakpoint
ALTER TABLE "desempeno_semanal" ADD COLUMN "banda_semanal_superior" double precision;--> statement-breakpoint
ALTER TABLE "nodos" ADD COLUMN "vendedor_olist_id" text;--> statement-breakpoint
ALTER TABLE "nodos" ADD COLUMN "fuente_linea_base" text;--> statement-breakpoint
ALTER TABLE "desempeno_semanal" ADD CONSTRAINT "desempeno_banda_semanal_completa" CHECK (("desempeno_semanal"."banda_semanal_inferior" IS NULL) = ("desempeno_semanal"."banda_semanal_superior" IS NULL));--> statement-breakpoint
ALTER TABLE "nodos" ADD CONSTRAINT "nodos_datos_reales_completos" CHECK (("nodos"."vendedor_olist_id" IS NULL) = ("nodos"."fuente_linea_base" IS NULL) AND ("nodos"."fuente_linea_base" IS NULL OR "nodos"."fuente_linea_base" IN ('ml', 'provisoria')));