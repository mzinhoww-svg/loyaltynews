ALTER TABLE "agenda_events" ADD COLUMN "moderacao" text DEFAULT 'aprovado' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "origem" text DEFAULT 'interno' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "motivo_rejeicao" text;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "moderado_por" text;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "moderado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "chave_dedupe" text;--> statement-breakpoint
ALTER TABLE "agenda_events" ADD COLUMN "criado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_sugestao_pendente_uq" ON "agenda_events" USING btree ("chave_dedupe") WHERE "agenda_events"."moderacao" = 'pendente' AND "agenda_events"."chave_dedupe" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agenda_moderacao_idx" ON "agenda_events" USING btree ("moderacao","inicio");--> statement-breakpoint
ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_moderacao" CHECK ("agenda_events"."moderacao" IN ('pendente', 'aprovado', 'rejeitado'));--> statement-breakpoint
ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_origem" CHECK ("agenda_events"."origem" IN ('interno', 'publico'));--> statement-breakpoint
ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_rejeicao_com_motivo" CHECK ("agenda_events"."moderacao" <> 'rejeitado' OR ("agenda_events"."motivo_rejeicao" IS NOT NULL AND length(trim("agenda_events"."motivo_rejeicao")) > 0));--> statement-breakpoint
ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_publico_aprovado_por_humano" CHECK ("agenda_events"."origem" <> 'publico' OR "agenda_events"."moderacao" = 'pendente' OR "agenda_events"."moderado_por" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_publico_nao_patrocinado" CHECK ("agenda_events"."origem" <> 'publico' OR NOT "agenda_events"."patrocinado");