CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"decision_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"title" text NOT NULL,
	"owner_agent_id" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"evidence_ref" text,
	CONSTRAINT "action_items_status_ck" CHECK ("action_items"."status" IN ('open','done','escalated')),
	CONSTRAINT "action_items_done_evidence_ck" CHECK ("action_items"."status" <> 'done' OR ("action_items"."closed_at" IS NOT NULL AND "action_items"."evidence_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "meeting_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"text" text NOT NULL,
	"proposed_by" text NOT NULL,
	"authority" text NOT NULL,
	"status" text NOT NULL,
	"needs_human_approval" boolean DEFAULT false NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "meeting_decisions_status_ck" CHECK ("meeting_decisions"."status" IN ('approved','pending_human','rejected_invalid_authority'))
);
--> statement-breakpoint
CREATE TABLE "meeting_inputs" (
	"meeting_id" text NOT NULL,
	"local_date" date NOT NULL,
	"instance" text DEFAULT '' NOT NULL,
	"agent_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "meeting_inputs_meeting_id_local_date_instance_agent_id_pk" PRIMARY KEY("meeting_id","local_date","instance","agent_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"local_date" date NOT NULL,
	"instance" text DEFAULT '' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"route" text NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"recovered" boolean DEFAULT false NOT NULL,
	"chair" text NOT NULL,
	"participants_present" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participants_absent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quorum_minimum" integer NOT NULL,
	CONSTRAINT "meeting_runs_idem_uq" UNIQUE("meeting_id","local_date","instance"),
	CONSTRAINT "meeting_runs_status_ck" CHECK ("meeting_runs"."status" IN ('completed','status_only','waiting')),
	CONSTRAINT "meeting_runs_reason_ck" CHECK ("meeting_runs"."reason" IS NULL OR "meeting_runs"."reason" IN ('no_inputs_or_decisions','quorum_not_met','recovery_window_expired','host_off_previous_day')),
	CONSTRAINT "meeting_runs_delay_ck" CHECK ("meeting_runs"."delay_minutes" >= 0),
	CONSTRAINT "meeting_runs_model_calls_ck" CHECK ("meeting_runs"."model_calls" >= 0),
	CONSTRAINT "meeting_runs_reason_status_ck" CHECK (("meeting_runs"."status" = 'status_only' AND "meeting_runs"."reason" IS NOT NULL) OR ("meeting_runs"."status" <> 'status_only' AND "meeting_runs"."reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sector_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"editoria" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_agent_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sector_memory_editoria_key_version_uq" UNIQUE("editoria","key","version"),
	CONSTRAINT "sector_memory_editoria_ck" CHECK ("sector_memory"."editoria" IN ('mercado','programas','pontos','bancos','varejo','travel','tech','crm','global','regulacao')),
	CONSTRAINT "sector_memory_kind_ck" CHECK ("sector_memory"."kind" IN ('sources','glossary','style','lessons','open_threads','decision')),
	CONSTRAINT "sector_memory_version_ck" CHECK ("sector_memory"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_decision_id_meeting_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."meeting_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_run_id_meeting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."meeting_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_run_id_meeting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."meeting_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_run_id_meeting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."meeting_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_owner_status_idx" ON "action_items" USING btree ("owner_agent_id","status");--> statement-breakpoint
CREATE INDEX "action_items_due_idx" ON "action_items" USING btree ("due_date") WHERE "action_items"."status" = 'open';--> statement-breakpoint
CREATE INDEX "meeting_decisions_run_idx" ON "meeting_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sector_memory_editoria_kind_idx" ON "sector_memory" USING btree ("editoria","kind");