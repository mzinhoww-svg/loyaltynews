CREATE TABLE "social_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE INDEX "social_packages_article_idx" ON "social_packages" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "social_packages_status_idx" ON "social_packages" USING btree ("status","channel","updated_at");