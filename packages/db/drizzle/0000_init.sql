CREATE TYPE "public"."article_status" AS ENUM('rascunho', 'em_checagem', 'bloqueado', 'aprovado', 'publicado', 'despublicado', 'corrigido');--> statement-breakpoint
CREATE TYPE "public"."disponibilidade" AS ENUM('disponivel', 'sob_consulta', 'indisponivel');--> statement-breakpoint
CREATE TYPE "public"."link_origin" AS ENUM('declarado', 'inferido');--> statement-breakpoint
CREATE TABLE "ad_formats" (
	"id" text PRIMARY KEY NOT NULL,
	"secao" text NOT NULL,
	"nome" text NOT NULL,
	"referencia_brl" text NOT NULL,
	"escopo" text NOT NULL,
	"disponibilidade" "disponibilidade" DEFAULT 'indisponivel' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"posicao" text NOT NULL,
	"dimensao_desktop" text NOT NULL,
	"limite_cotas" integer,
	"peso_max_kb" integer,
	"contrato_minimo" text
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"article_id" text NOT NULL,
	"evidence_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"titulo" text NOT NULL,
	"subtitulo" text,
	"editoria" text NOT NULL,
	"status" "article_status" DEFAULT 'rascunho' NOT NULL,
	"assinatura" text DEFAULT 'Redação Loyalty News' NOT NULL,
	"corpo" text NOT NULL,
	"imagem" jsonb,
	"classe_de_dado" text DEFAULT 'public' NOT NULL,
	"patrocinado" boolean DEFAULT false NOT NULL,
	"rotulo_publieditorial" text,
	"versao" integer DEFAULT 1 NOT NULL,
	"publicado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_assinatura" CHECK ("articles"."assinatura" = 'Redação Loyalty News'),
	CONSTRAINT "articles_publieditorial_rotulado" CHECK (NOT "articles"."patrocinado" OR "articles"."rotulo_publieditorial" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"anunciante" text NOT NULL,
	"formato_ids" jsonb NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"rotulada" boolean DEFAULT true NOT NULL,
	CONSTRAINT "campaigns_periodo" CHECK ("campaigns"."fim" >= "campaigns"."inicio"),
	CONSTRAINT "campaigns_rotulada" CHECK ("campaigns"."rotulada")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"nome_legal" text,
	"site" text,
	"setor" text
);
--> statement-breakpoint
CREATE TABLE "editorias" (
	"slug" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"capturado_em" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "evidences_sha256" CHECK ("evidences"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"de_company_id" text,
	"para_company_id" text NOT NULL,
	"cargo_novo" text NOT NULL,
	"data" date NOT NULL,
	"evidence_id" text NOT NULL,
	"origem" "link_origin" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"cargo" text NOT NULL,
	"empresa_id" text NOT NULL,
	"evidence_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"company_id" text NOT NULL,
	"cargo" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"evidence_id" text NOT NULL,
	"origem" "link_origin" NOT NULL,
	"observado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_vigencia" CHECK ("roles"."valid_to" IS NULL OR "roles"."valid_to" >= "roles"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"url" text NOT NULL,
	"tipo" text NOT NULL,
	"acesso" text DEFAULT 'publico' NOT NULL,
	"termos_revisados" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sources_acesso_publico" CHECK ("sources"."acesso" = 'publico')
);
--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_editoria_editorias_slug_fk" FOREIGN KEY ("editoria") REFERENCES "public"."editorias"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_de_company_id_companies_id_fk" FOREIGN KEY ("de_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_para_company_id_companies_id_fk" FOREIGN KEY ("para_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_empresa_id_companies_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_sources_pk" ON "article_sources" USING btree ("article_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_uq" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "articles_editoria_status_idx" ON "articles" USING btree ("editoria","status");