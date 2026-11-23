CREATE TABLE "openbot_callbacks" (
	"callback_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openbot_cost_entries" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"model" text NOT NULL,
	"generation_ids" jsonb NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"cost_micro" bigint NOT NULL,
	"overrun" boolean NOT NULL,
	"month_key" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_cost_nonneg" CHECK ("openbot_cost_entries"."cost_micro" >= 0 AND "openbot_cost_entries"."prompt_tokens" >= 0 AND "openbot_cost_entries"."completion_tokens" >= 0 AND "openbot_cost_entries"."cache_read_tokens" >= 0 AND "openbot_cost_entries"."cache_write_tokens" >= 0),
	CONSTRAINT "openbot_cost_month" CHECK ("openbot_cost_entries"."month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "openbot_health" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_health_id" CHECK ("openbot_health"."id" = 'pull')
);
--> statement-breakpoint
CREATE TABLE "openbot_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"kind" text NOT NULL,
	"profile_id" text NOT NULL,
	"ref_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"data_class" text NOT NULL,
	"max_cost_micro" bigint NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"lease_id" text,
	"lease_holder" text,
	"lease_expires_at" timestamp with time zone,
	"result_ref" text,
	"last_error" text,
	CONSTRAINT "openbot_tasks_status" CHECK ("openbot_tasks"."status" IN ('pending', 'leased', 'completed', 'failed', 'dead')),
	CONSTRAINT "openbot_tasks_data_class" CHECK ("openbot_tasks"."data_class" IN ('public', 'internal')),
	CONSTRAINT "openbot_tasks_cost" CHECK ("openbot_tasks"."max_cost_micro" >= 1),
	CONSTRAINT "openbot_tasks_attempts" CHECK ("openbot_tasks"."attempts" >= 0 AND "openbot_tasks"."max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "openbot_tasks_lease" CHECK ("openbot_tasks"."status" <> 'leased' OR ("openbot_tasks"."lease_id" IS NOT NULL AND "openbot_tasks"."lease_holder" IS NOT NULL AND "openbot_tasks"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "openbot_cost_entries" ADD CONSTRAINT "openbot_cost_entries_task_id_openbot_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."openbot_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "openbot_cost_month_idx" ON "openbot_cost_entries" USING btree ("month_key");--> statement-breakpoint
CREATE UNIQUE INDEX "openbot_tasks_idem_uq" ON "openbot_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "openbot_tasks_claim_idx" ON "openbot_tasks" USING btree ("status","seq");