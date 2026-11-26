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
-- A coluna descartado_em, o indice crm_leads_descartado_idx e o gatilho de retencao ja existem na 0031
-- (backend 441c0cc, DP-55). Esta migracao so acrescenta a trilha de exclusao; repetir a coluna ou o indice
-- com o mesmo nome quebraria a cadeia.
CREATE INDEX "commercial_lead_deletions_at_idx" ON "commercial_lead_deletions" USING btree ("at");--> statement-breakpoint
-- Lead descartado antes desta migracao: o relogio da retencao comeca AGORA, nao na criacao (DP-55: nao antecipar
-- o prazo anunciado; um lead criado ha 2 anos e descartado ontem so sai 30 dias depois desta migracao).
UPDATE "crm_leads" SET "descartado_em" = now() WHERE "status" = 'descartado' AND "descartado_em" IS NULL;
