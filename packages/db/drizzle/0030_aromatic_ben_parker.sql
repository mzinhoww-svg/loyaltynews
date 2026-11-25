CREATE TABLE "commercial_lead_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_ref_hash" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"origin" text NOT NULL,
	CONSTRAINT "commercial_lead_deletions_hash" CHECK ("commercial_lead_deletions"."lead_ref_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_lead_deletions_origin" CHECK ("commercial_lead_deletions"."origin" IN ('studio', 'retencao'))
);
--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "descartado_em" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "commercial_lead_deletions_at_idx" ON "commercial_lead_deletions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "crm_leads_descartado_idx" ON "crm_leads" USING btree ("status","descartado_em");--> statement-breakpoint
-- Lead descartado antes desta migracao: usa a data de criacao como base para a retencao.
UPDATE "crm_leads" SET "descartado_em" = "criado_em" WHERE "status" = 'descartado' AND "descartado_em" IS NULL;
