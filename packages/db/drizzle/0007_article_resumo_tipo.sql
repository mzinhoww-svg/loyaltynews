CREATE TYPE "public"."content_type" AS ENUM('noticia', 'flash', 'analise', 'entrevista', 'opiniao', 'estudo', 'patrocinado', 'cobertura_evento');--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "resumo" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "tipo_conteudo" "content_type" DEFAULT 'noticia' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tipo_patrocinado" CHECK ("articles"."tipo_conteudo" <> 'patrocinado' OR "articles"."patrocinado");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_publicada_com_resumo" CHECK ("articles"."status" <> 'publicado' OR ("articles"."resumo" IS NOT NULL AND length("articles"."resumo") BETWEEN 1 AND 300));