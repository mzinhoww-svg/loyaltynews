CREATE TABLE "source_editorias" (
	"source_id" text NOT NULL,
	"editoria" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_editorias" ADD CONSTRAINT "source_editorias_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_editorias" ADD CONSTRAINT "source_editorias_editoria_editorias_slug_fk" FOREIGN KEY ("editoria") REFERENCES "public"."editorias"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_editorias_pk" ON "source_editorias" USING btree ("source_id","editoria");