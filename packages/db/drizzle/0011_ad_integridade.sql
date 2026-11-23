CREATE TYPE "public"."ad_gap_reason" AS ENUM('dedupe_perdido', 'dedupe_regrediu');--> statement-breakpoint
CREATE TABLE "ad_delivery_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"reason" "ad_gap_reason" NOT NULL,
	"from" timestamp with time zone NOT NULL,
	"served_until" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"uncounted_serves" integer DEFAULT 0 NOT NULL,
	"ignored_events" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ad_delivery_gaps_ordem" CHECK ("ad_delivery_gaps"."from" <= "ad_delivery_gaps"."served_until" AND "ad_delivery_gaps"."served_until" <= "ad_delivery_gaps"."to"),
	CONSTRAINT "ad_delivery_gaps_contadores" CHECK ("ad_delivery_gaps"."uncounted_serves" >= 0 AND "ad_delivery_gaps"."ignored_events" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ad_redis_watermark" (
	"id" text PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_redis_watermark_nao_negativo" CHECK ("ad_redis_watermark"."value" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ad_delivery_gaps_periodo_idx" ON "ad_delivery_gaps" USING btree ("from","to");