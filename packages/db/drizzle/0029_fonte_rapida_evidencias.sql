CREATE TABLE "editorial_evidencias" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"source_id" text,
	"url" text NOT NULL,
	"trecho" text NOT NULL,
	"trecho_sha256" text NOT NULL,
	"estado" text DEFAULT 'a_confirmar' NOT NULL,
	"chave_idem" text NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "editorial_evidencias_url_https" CHECK ("editorial_evidencias"."url" ~ '^https://'),
	CONSTRAINT "editorial_evidencias_trecho" CHECK (char_length("editorial_evidencias"."trecho") BETWEEN 1 AND 500),
	CONSTRAINT "editorial_evidencias_sha" CHECK ("editorial_evidencias"."trecho_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "editorial_evidencias_estado" CHECK ("editorial_evidencias"."estado" in ('a_confirmar', 'confirmada'))
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "revisao" text DEFAULT 'confirmada' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "licenca" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "chave_idem" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "criado_por" text;--> statement-breakpoint
ALTER TABLE "editorial_evidencias" ADD CONSTRAINT "editorial_evidencias_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_evidencias" ADD CONSTRAINT "editorial_evidencias_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_evidencias_chave_uq" ON "editorial_evidencias" USING btree ("chave_idem");--> statement-breakpoint
CREATE INDEX "editorial_evidencias_article_idx" ON "editorial_evidencias" USING btree ("article_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_chave_idem_uq" ON "sources" USING btree ("chave_idem");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_revisao" CHECK ("sources"."revisao" in ('confirmada', 'a_confirmar'));--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_a_confirmar_inativa" CHECK ("sources"."revisao" = 'confirmada' OR NOT "sources"."ativo");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_licenca" CHECK ("sources"."licenca" IS NULL OR "sources"."licenca" in ('aberta', 'creative_commons', 'termos_do_site', 'direitos_reservados', 'desconhecida'));