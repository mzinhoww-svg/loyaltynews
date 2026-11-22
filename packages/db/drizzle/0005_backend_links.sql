CREATE TABLE "company_evidences" (
	"company_id" text NOT NULL,
	"evidence_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_editorias" (
	"source_id" text NOT NULL,
	"editoria" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_evidences" ADD CONSTRAINT "company_evidences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_evidences" ADD CONSTRAINT "company_evidences_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_editorias" ADD CONSTRAINT "source_editorias_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_editorias" ADD CONSTRAINT "source_editorias_editoria_editorias_slug_fk" FOREIGN KEY ("editoria") REFERENCES "public"."editorias"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_evidences_pk" ON "company_evidences" USING btree ("company_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_editorias_pk" ON "source_editorias" USING btree ("source_id","editoria");