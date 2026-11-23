ALTER TABLE "ad_creatives" ADD COLUMN "arquivo_mime" text;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "largura" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "altura" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "tamanho_kb" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "arquivo_sha256" text;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "texto_alternativo" text;--> statement-breakpoint
-- Regra do PM: so criativo REAL aparece. Criativo aprovado sem arquivo/texto alternativo/destino nao e real: a aprovacao anterior (de antes de existir o arquivo)
-- e REVOGADA aqui para o CHECK abaixo valer sobre as linhas existentes (sem NOT VALID e sem deixar linha fora da regra). Nada e apagado.
UPDATE "ad_creatives" SET "aprovado" = false WHERE "aprovado" = true;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_arquivo_coerente" CHECK (("ad_creatives"."arquivo_mime" IS NULL AND "ad_creatives"."largura" IS NULL AND "ad_creatives"."altura" IS NULL AND "ad_creatives"."tamanho_kb" IS NULL AND "ad_creatives"."arquivo_sha256" IS NULL) OR ("ad_creatives"."arquivo_ref" IS NOT NULL AND "ad_creatives"."arquivo_mime" IN ('image/jpeg', 'image/png', 'image/gif') AND "ad_creatives"."largura" > 0 AND "ad_creatives"."altura" > 0 AND "ad_creatives"."tamanho_kb" > 0 AND "ad_creatives"."arquivo_sha256" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_alt" CHECK ("ad_creatives"."texto_alternativo" IS NULL OR char_length(btrim("ad_creatives"."texto_alternativo")) BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_aprovado_completo" CHECK (NOT "ad_creatives"."aprovado" OR ("ad_creatives"."arquivo_ref" IS NOT NULL AND "ad_creatives"."arquivo_mime" IS NOT NULL AND "ad_creatives"."largura" IS NOT NULL AND "ad_creatives"."altura" IS NOT NULL AND "ad_creatives"."tamanho_kb" IS NOT NULL AND "ad_creatives"."arquivo_sha256" IS NOT NULL AND "ad_creatives"."texto_alternativo" IS NOT NULL AND "ad_creatives"."destino_url" IS NOT NULL));