ALTER TABLE "sources" ADD COLUMN "origem" text DEFAULT 'cms' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_origem" CHECK ("sources"."origem" in ('fabrica', 'cms'));