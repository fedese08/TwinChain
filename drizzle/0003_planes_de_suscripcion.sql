ALTER TABLE "organizaciones" ADD COLUMN "plan" text DEFAULT 'freemium' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizaciones" ADD COLUMN "plan_desde" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organizaciones" ADD CONSTRAINT "organizaciones_plan_valido" CHECK ("organizaciones"."plan" IN ('freemium', 'pro', 'max'));
-- Las organizaciones que ya existían (con sus cadenas y escenarios) quedan en Max, para no dejarlas por encima del
-- tope de un plan que nunca eligieron. Las que se creen después nacen en Freemium (default de la columna).
UPDATE "organizaciones" SET "plan" = 'max';
