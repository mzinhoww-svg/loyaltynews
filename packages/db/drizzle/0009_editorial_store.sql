CREATE TABLE "editorial_article" (
	"article_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"editoria" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_correction" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_source_state" (
	"source_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"terms_status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE INDEX "editorial_article_status_idx" ON "editorial_article" USING btree ("status","editoria","updated_at");--> statement-breakpoint
CREATE INDEX "editorial_correction_state_idx" ON "editorial_correction" USING btree ("state","received_at");--> statement-breakpoint
CREATE INDEX "editorial_correction_article_idx" ON "editorial_correction" USING btree ("article_id");