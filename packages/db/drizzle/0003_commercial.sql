-- 0003_commercial: substitui ad_formats, ad_slots e campaigns do scaffold pelo modulo comercial (Frente 10).
-- Sem banco real em nenhum ambiente ate aqui; por isso remove e recria em vez de alterar colunas.
DROP TABLE "ad_formats" CASCADE;--> statement-breakpoint
DROP TABLE "ad_slots" CASCADE;--> statement-breakpoint
DROP TABLE "campaigns" CASCADE;--> statement-breakpoint
CREATE TYPE "public"."campanha_status" AS ENUM('draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('novo', 'qualificado', 'descartado', 'convertido');--> statement-breakpoint
CREATE TYPE "public"."metrica_status" AS ENUM('available', 'unavailable', 'stale');--> statement-breakpoint
CREATE TYPE "public"."oportunidade_estagio" AS ENUM('novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."preco_tipo" AS ENUM('fixo', 'a_partir_de', 'verba_mais_taxa');--> statement-breakpoint
CREATE TYPE "public"."preco_unidade" AS ENUM('mes', 'dia', 'unidade', 'verba');--> statement-breakpoint
CREATE TYPE "public"."reserva_status" AS ENUM('held', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."slot_posicao" AS ENUM('TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER', 'ARTICLE_INLINE', 'HOME_BETWEEN', 'AGENDA', 'DATA');--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"campanha_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"peso" integer DEFAULT 1 NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"aprovado" boolean DEFAULT false NOT NULL,
	"arquivo_ref" text,
	"destino_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_creatives_peso" CHECK ("ad_creatives"."peso" > 0),
	CONSTRAINT "ad_creatives_periodo" CHECK ("ad_creatives"."fim" >= "ad_creatives"."inicio"),
	CONSTRAINT "ad_creatives_destino_https" CHECK ("ad_creatives"."destino_url" IS NULL OR "ad_creatives"."destino_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "ad_delivery_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"criativo_id" text NOT NULL,
	"dia" date NOT NULL,
	"servidas" integer DEFAULT 0 NOT NULL,
	"visiveis" integer DEFAULT 0 NOT NULL,
	"cliques" integer DEFAULT 0 NOT NULL,
	"ignoradas_bot_interno" integer DEFAULT 0 NOT NULL,
	"refresh_suprimido" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_delivery_nao_negativo" CHECK ("ad_delivery_daily"."servidas" >= 0 AND "ad_delivery_daily"."visiveis" >= 0 AND "ad_delivery_daily"."cliques" >= 0 AND "ad_delivery_daily"."ignoradas_bot_interno" >= 0 AND "ad_delivery_daily"."refresh_suprimido" >= 0),
	CONSTRAINT "ad_delivery_visivel_le_servida" CHECK ("ad_delivery_daily"."visiveis" <= "ad_delivery_daily"."servidas" AND "ad_delivery_daily"."cliques" <= "ad_delivery_daily"."servidas")
);
--> statement-breakpoint
CREATE TABLE "ad_formats" (
	"id" text PRIMARY KEY NOT NULL,
	"secao" text NOT NULL,
	"nome" text NOT NULL,
	"referencia_brl" text NOT NULL,
	"escopo" text NOT NULL,
	"disponibilidade" "disponibilidade" DEFAULT 'indisponivel' NOT NULL,
	"preco_tipo" "preco_tipo" NOT NULL,
	"preco_valor_brl" numeric(12, 2),
	"unidade" "preco_unidade" NOT NULL,
	"taxa_pct" numeric(5, 2),
	"motivo_disponibilidade" text DEFAULT 'Sem capacidade operacional declarada.' NOT NULL,
	"fonte_linha" integer,
	CONSTRAINT "ad_formats_preco_coerente" CHECK (("ad_formats"."preco_tipo" = 'verba_mais_taxa' AND "ad_formats"."preco_valor_brl" IS NULL AND "ad_formats"."taxa_pct" IS NOT NULL) OR ("ad_formats"."preco_tipo" <> 'verba_mais_taxa' AND "ad_formats"."preco_valor_brl" IS NOT NULL AND "ad_formats"."preco_valor_brl" >= 0)),
	CONSTRAINT "ad_formats_motivo_se_nao_disponivel" CHECK ("ad_formats"."disponibilidade" = 'disponivel' OR length("ad_formats"."motivo_disponibilidade") > 0)
);
--> statement-breakpoint
CREATE TABLE "ad_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"slot_id" text NOT NULL,
	"conta_id" text NOT NULL,
	"campanha_id" text,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"status" "reserva_status" DEFAULT 'held' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_reservations_periodo" CHECK ("ad_reservations"."fim" >= "ad_reservations"."inicio")
);
--> statement-breakpoint
CREATE TABLE "ad_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"posicao" "slot_posicao" NOT NULL,
	"formato_id" text NOT NULL,
	"dimensao_desktop" text NOT NULL,
	"variantes_mobile" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limite_cotas" integer,
	"peso_max_kb" integer,
	"contrato_minimo_dias" integer,
	"tipos_permitidos" jsonb DEFAULT '["JPG","PNG","GIF","HTML5-sandbox"]'::jsonb NOT NULL,
	CONSTRAINT "ad_slots_limite_positivo" CHECK ("ad_slots"."limite_cotas" IS NULL OR "ad_slots"."limite_cotas" > 0),
	CONSTRAINT "ad_slots_reservavel_completo" CHECK ("ad_slots"."limite_cotas" IS NULL OR "ad_slots"."contrato_minimo_dias" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ad_takeovers" (
	"id" text PRIMARY KEY NOT NULL,
	"dia" date NOT NULL,
	"conta_id" text NOT NULL,
	"campanhas_acordadas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"conta_id" text NOT NULL,
	"oportunidade_id" text,
	"formato_id" text NOT NULL,
	"slot_id" text,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"status" "campanha_status" DEFAULT 'draft' NOT NULL,
	"rotulada" boolean DEFAULT true NOT NULL,
	"historico" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_periodo" CHECK ("campaigns"."fim" >= "campaigns"."inicio"),
	CONSTRAINT "campaigns_rotulada" CHECK ("campaigns"."rotulada")
);
--> statement-breakpoint
CREATE TABLE "commercial_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"origem" text NOT NULL,
	"metrica" text NOT NULL,
	"valor" numeric(20, 4),
	"periodo_inicio" timestamp with time zone,
	"periodo_fim" timestamp with time zone,
	"coletado_em" timestamp with time zone,
	"status" "metrica_status" NOT NULL,
	"versao_metodologia" text NOT NULL,
	CONSTRAINT "commercial_metrics_disponivel_completa" CHECK ("commercial_metrics"."status" = 'unavailable' OR ("commercial_metrics"."valor" IS NOT NULL AND "commercial_metrics"."periodo_inicio" IS NOT NULL AND "commercial_metrics"."periodo_fim" IS NOT NULL AND "commercial_metrics"."coletado_em" IS NOT NULL AND "commercial_metrics"."periodo_fim" >= "commercial_metrics"."periodo_inicio"))
);
--> statement-breakpoint
CREATE TABLE "crm_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"empresa" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp" text,
	"formato_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objetivo" text NOT NULL,
	"mensagem" text,
	"opt_in_newsletter" boolean DEFAULT false NOT NULL,
	"consentimento_em" timestamp with time zone NOT NULL,
	"classe_de_dado" text DEFAULT 'personal' NOT NULL,
	"status" "lead_status" DEFAULT 'novo' NOT NULL,
	"conta_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_leads_classe" CHECK ("crm_leads"."classe_de_dado" = 'personal')
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"lead_id" text,
	"titulo" text NOT NULL,
	"formato_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estagio" "oportunidade_estagio" DEFAULT 'novo' NOT NULL,
	"motivo_perda" text,
	"proxima_acao" text,
	"proxima_acao_prazo" date,
	"valor_brl" numeric(14, 2),
	"versoes_proposta" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opp_perda_exige_motivo" CHECK ("crm_opportunities"."estagio" <> 'perdido' OR ("crm_opportunities"."motivo_perda" IS NOT NULL AND length(trim("crm_opportunities"."motivo_perda")) > 0)),
	CONSTRAINT "crm_opp_valor_nao_negativo" CHECK ("crm_opportunities"."valor_brl" IS NULL OR "crm_opportunities"."valor_brl" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_opportunity_history" (
	"id" text PRIMARY KEY NOT NULL,
	"oportunidade_id" text NOT NULL,
	"de" "oportunidade_estagio",
	"para" "oportunidade_estagio" NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campanha_id_campaigns_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_delivery_daily" ADD CONSTRAINT "ad_delivery_daily_criativo_id_ad_creatives_id_fk" FOREIGN KEY ("criativo_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_reservations" ADD CONSTRAINT "ad_reservations_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_reservations" ADD CONSTRAINT "ad_reservations_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_reservations" ADD CONSTRAINT "ad_reservations_campanha_id_campaigns_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_formato_id_ad_formats_id_fk" FOREIGN KEY ("formato_id") REFERENCES "public"."ad_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_takeovers" ADD CONSTRAINT "ad_takeovers_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_oportunidade_id_crm_opportunities_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_formato_id_ad_formats_id_fk" FOREIGN KEY ("formato_id") REFERENCES "public"."ad_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_conta_id_crm_accounts_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."crm_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_history" ADD CONSTRAINT "crm_opportunity_history_oportunidade_id_crm_opportunities_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_creatives_slot_idx" ON "ad_creatives" USING btree ("slot_id","aprovado");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_delivery_daily_uq" ON "ad_delivery_daily" USING btree ("criativo_id","dia");--> statement-breakpoint
CREATE INDEX "ad_formats_secao_idx" ON "ad_formats" USING btree ("secao");--> statement-breakpoint
CREATE INDEX "ad_reservations_slot_periodo_idx" ON "ad_reservations" USING btree ("slot_id","inicio","fim");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_slots_posicao_uq" ON "ad_slots" USING btree ("posicao");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_takeovers_dia_uq" ON "ad_takeovers" USING btree ("dia");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_metrics_uq" ON "commercial_metrics" USING btree ("origem","metrica");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_accounts_nome_uq" ON "crm_accounts" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "crm_leads_status_idx" ON "crm_leads" USING btree ("status","criado_em");--> statement-breakpoint
CREATE INDEX "crm_leads_email_idx" ON "crm_leads" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "crm_opp_estagio_idx" ON "crm_opportunities" USING btree ("estagio");--> statement-breakpoint
CREATE INDEX "crm_opp_hist_idx" ON "crm_opportunity_history" USING btree ("oportunidade_id","em");