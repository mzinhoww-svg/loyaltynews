CREATE TABLE "social_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"record" json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_delivery_flushes" (
	"flush_id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"day" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "social_packages_article_idx" ON "social_packages" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "social_packages_status_idx" ON "social_packages" USING btree ("status","channel","updated_at");--> statement-breakpoint
CREATE INDEX "ad_delivery_flushes_at_idx" ON "ad_delivery_flushes" USING btree ("at");