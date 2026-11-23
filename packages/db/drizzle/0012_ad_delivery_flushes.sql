CREATE TABLE "ad_delivery_flushes" (
	"flush_id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"day" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ad_delivery_flushes_at_idx" ON "ad_delivery_flushes" USING btree ("at");