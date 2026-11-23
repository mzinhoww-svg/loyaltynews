CREATE TABLE "article_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"base_versao" integer NOT NULL,
	"versao" integer NOT NULL,
	"caso_id" text NOT NULL,
	"titulo" text NOT NULL,
	"subtitulo" text,
	"resumo" text,
	"corpo" text NOT NULL,
	"imagem" jsonb,
	"aviso" text NOT NULL,
	"estado" text DEFAULT 'rascunho' NOT NULL,
	"conteudo_sha256" text,
	"receipt_id" text,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"publicado_em" timestamp with time zone,
	CONSTRAINT "article_revisions_estado" CHECK ("article_revisions"."estado" IN ('rascunho', 'aprovada', 'publicada', 'descartada')),
	CONSTRAINT "article_revisions_versao" CHECK ("article_revisions"."versao" > "article_revisions"."base_versao"),
	CONSTRAINT "article_revisions_aprovada_com_recibo" CHECK ("article_revisions"."estado" NOT IN ('aprovada', 'publicada') OR ("article_revisions"."receipt_id" IS NOT NULL AND "article_revisions"."conteudo_sha256" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_aberta_uq" ON "article_revisions" USING btree ("article_id") WHERE "article_revisions"."estado" IN ('rascunho', 'aprovada');--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_versao_uq" ON "article_revisions" USING btree ("article_id","versao") WHERE "article_revisions"."estado" <> 'descartada';