CREATE TABLE "openbot_callbacks" (
	"callback_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openbot_cost_entries" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"lease_id" text NOT NULL,
	"lane" text DEFAULT 'api' NOT NULL,
	"account" text,
	"model" text NOT NULL,
	"generation_ids" jsonb,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"cost_micro" bigint NOT NULL,
	"overrun" boolean NOT NULL,
	"month_key" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_cost_lane" CHECK ("openbot_cost_entries"."lane" IN ('api', 'subscription', 'opencode', 'antigravity')),
	CONSTRAINT "openbot_cost_account" CHECK ("openbot_cost_entries"."account" IS NULL OR "openbot_cost_entries"."account" IN ('claude', 'codex', 'opencode', 'antigravity')),
	CONSTRAINT "openbot_cost_nonneg" CHECK ("openbot_cost_entries"."cost_micro" >= 0 AND ("openbot_cost_entries"."prompt_tokens" IS NULL OR "openbot_cost_entries"."prompt_tokens" >= 0) AND ("openbot_cost_entries"."completion_tokens" IS NULL OR "openbot_cost_entries"."completion_tokens" >= 0) AND ("openbot_cost_entries"."cache_read_tokens" IS NULL OR "openbot_cost_entries"."cache_read_tokens" >= 0) AND ("openbot_cost_entries"."cache_write_tokens" IS NULL OR "openbot_cost_entries"."cache_write_tokens" >= 0)),
	CONSTRAINT "openbot_cost_free_lane" CHECK ("openbot_cost_entries"."lane" = 'api' OR "openbot_cost_entries"."cost_micro" = 0),
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
CREATE TABLE "openbot_io" (
	"ref" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"content" jsonb NOT NULL,
	"task_class" text,
	"prompt_version" text,
	"task_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_io_direction" CHECK ("openbot_io"."direction" IN ('input', 'result')),
	CONSTRAINT "openbot_io_size" CHECK (octet_length("openbot_io"."content"::text) <= 262144)
);
--> statement-breakpoint
CREATE TABLE "openbot_pilot_rows" (
	"task_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"stage" text NOT NULL,
	"account" text NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"row" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_pilot_rows_task_id_attempt_pk" PRIMARY KEY("task_id","attempt"),
	CONSTRAINT "openbot_pilot_rows_outcome" CHECK ("openbot_pilot_rows"."outcome" IN ('completed', 'failed', 'retryable', 'pending_limit')),
	CONSTRAINT "openbot_pilot_rows_attempt" CHECK ("openbot_pilot_rows"."attempt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "openbot_pilot_state" (
	"id" text PRIMARY KEY NOT NULL,
	"reasons" jsonb NOT NULL,
	"stopped_at" timestamp with time zone NOT NULL,
	CONSTRAINT "openbot_pilot_state_id" CHECK ("openbot_pilot_state"."id" = 'pilot'),
	CONSTRAINT "openbot_pilot_state_reasons" CHECK (jsonb_typeof("openbot_pilot_state"."reasons") = 'array' AND jsonb_array_length("openbot_pilot_state"."reasons") >= 1)
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
	"available_at" timestamp with time zone,
	"result_ref" text,
	"last_error" text,
	"route" jsonb DEFAULT '["claude"]'::jsonb NOT NULL,
	"route_index" integer DEFAULT 0 NOT NULL,
	"limit_hits" integer DEFAULT 0 NOT NULL,
	"accounts_limited" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "openbot_tasks_status" CHECK ("openbot_tasks"."status" IN ('pending', 'leased', 'completed', 'failed', 'dead')),
	CONSTRAINT "openbot_tasks_data_class" CHECK ("openbot_tasks"."data_class" IN ('public', 'internal')),
	CONSTRAINT "openbot_tasks_cost" CHECK ("openbot_tasks"."max_cost_micro" >= 1),
	CONSTRAINT "openbot_tasks_attempts" CHECK ("openbot_tasks"."attempts" >= 0 AND "openbot_tasks"."max_attempts" BETWEEN 1 AND 10 AND "openbot_tasks"."limit_hits" >= 0),
	CONSTRAINT "openbot_tasks_route" CHECK (jsonb_typeof("openbot_tasks"."route") = 'array' AND jsonb_array_length("openbot_tasks"."route") BETWEEN 1 AND 4 AND "openbot_tasks"."route_index" >= 0 AND "openbot_tasks"."route_index" < jsonb_array_length("openbot_tasks"."route")),
	CONSTRAINT "openbot_tasks_lease" CHECK ("openbot_tasks"."status" <> 'leased' OR ("openbot_tasks"."lease_id" IS NOT NULL AND "openbot_tasks"."lease_holder" IS NOT NULL AND "openbot_tasks"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "openbot_cost_entries" ADD CONSTRAINT "openbot_cost_entries_task_id_openbot_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."openbot_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "openbot_cost_month_idx" ON "openbot_cost_entries" USING btree ("month_key");--> statement-breakpoint
CREATE INDEX "openbot_pilot_rows_started_idx" ON "openbot_pilot_rows" USING btree ("started_at","task_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "openbot_tasks_idem_uq" ON "openbot_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "openbot_tasks_claim_idx" ON "openbot_tasks" USING btree ("status","seq");