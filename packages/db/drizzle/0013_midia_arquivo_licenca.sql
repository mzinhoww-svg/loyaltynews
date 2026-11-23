ALTER TABLE "media" ADD COLUMN "blob_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "mime" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "licenca_expira_em" date;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "licenca_evidencia" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "media_sha256_uq" ON "media" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_arquivo_completo" CHECK ("media"."blob_key" IS NULL OR ("media"."mime" IS NOT NULL AND "media"."bytes" > 0));