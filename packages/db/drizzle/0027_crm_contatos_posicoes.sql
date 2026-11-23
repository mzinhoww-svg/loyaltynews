CREATE TABLE "campaign_positions" (
	"campanha_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "campaign_positions_ordem" CHECK ("campaign_positions"."ordem" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp" text,
	"cargo" text,
	"base_legal" text NOT NULL,
	"consentimento_em" timestamp (3) with time zone NOT NULL,
	"registrado_por" text,
	"classe_de_dado" text DEFAULT 'personal' NOT NULL,
	"criado_em" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contacts_base_legal" CHECK ("crm_contacts"."base_legal" in ('consentimento', 'legitimo_interesse', 'execucao_de_contrato')),
	CONSTRAINT "crm_contacts_classe" CHECK ("crm_contacts"."classe_de_dado" = 'personal'),
	CONSTRAINT "crm_contacts_nome" CHECK (char_length(btrim("crm_contacts"."nome")) BETWEEN 1 AND 120),
	CONSTRAINT "crm_contacts_email" CHECK (char_length("crm_contacts"."email") BETWEEN 3 AND 254 AND "crm_contacts"."email" LIKE '%_@_%'),
	CONSTRAINT "crm_contacts_cargo" CHECK ("crm_contacts"."cargo" IS NULL OR char_length("crm_contacts"."cargo") <= 80)
);
--> statement-breakpoint
ALTER TABLE "campaign_positions" ADD CONSTRAINT "campaign_positions_campanha_id_campaigns_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_positions" ADD CONSTRAINT "campaign_positions_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_positions_pk" ON "campaign_positions" USING btree ("campanha_id","slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_positions_ordem_uq" ON "campaign_positions" USING btree ("campanha_id","ordem");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_email_uq" ON "crm_contacts" USING btree ("conta_id",lower("email"));--> statement-breakpoint
CREATE INDEX "crm_contacts_conta_idx" ON "crm_contacts" USING btree ("conta_id","criado_em");--> statement-breakpoint
-- Campanhas existentes: a posição única de campaigns.slot_id vira a posição 0 em campaign_positions (nada se perde; slot_id continua igual).
INSERT INTO "campaign_positions" ("campanha_id", "slot_id", "ordem") SELECT "id", "slot_id", 0 FROM "campaigns" WHERE "slot_id" IS NOT NULL;