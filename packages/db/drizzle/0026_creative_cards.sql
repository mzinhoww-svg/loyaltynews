CREATE TABLE "creative_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"autoral_formato" text,
	"estado" text DEFAULT 'rascunho' NOT NULL,
	"svg" text NOT NULL,
	"svg_sha256" text NOT NULL,
	"alt_text" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"mock" boolean NOT NULL,
	"brand_status" text NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone NOT NULL,
	"revisado_por" text,
	"revisado_em" timestamp with time zone,
	"motivo" text,
	CONSTRAINT "creative_cards_kind" CHECK ("creative_cards"."kind" in ('materia', 'analise')),
	CONSTRAINT "creative_cards_format" CHECK ("creative_cards"."format" in ('linkedin_landscape', 'square')),
	CONSTRAINT "creative_cards_autoral" CHECK ("creative_cards"."autoral_formato" IS NULL OR "creative_cards"."autoral_formato" in ('analise', 'explicador', 'comparativo')),
	CONSTRAINT "creative_cards_estado" CHECK ("creative_cards"."estado" in ('rascunho', 'em_revisao', 'aprovado', 'rejeitado')),
	CONSTRAINT "creative_cards_sha" CHECK ("creative_cards"."svg_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "creative_cards_rejeitado_motivo" CHECK ("creative_cards"."estado" <> 'rejeitado' OR char_length(btrim("creative_cards"."motivo")) BETWEEN 1 AND 500),
	CONSTRAINT "creative_cards_revisado" CHECK ("creative_cards"."estado" NOT IN ('aprovado', 'rejeitado') OR ("creative_cards"."revisado_por" IS NOT NULL AND "creative_cards"."revisado_em" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "creative_cards" ADD CONSTRAINT "creative_cards_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_cards_idem_uq" ON "creative_cards" USING btree ("article_id","format","svg_sha256");--> statement-breakpoint
CREATE INDEX "creative_cards_estado_idx" ON "creative_cards" USING btree ("estado","criado_em");