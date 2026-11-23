CREATE TABLE "growth_media_uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"image_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "growth_media_uploads_key" CHECK ("growth_media_uploads"."key" ~ '^[A-Za-z0-9:_,.-]{1,200}$'),
	CONSTRAINT "growth_media_uploads_image" CHECK (char_length("growth_media_uploads"."image_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX "growth_media_uploads_created_idx" ON "growth_media_uploads" USING btree ("created_at");