CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'enqueued', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('reserva', 'conciliacao', 'liberacao');--> statement-breakpoint
CREATE TYPE "public"."reservation_state" AS ENUM('reservada', 'conciliada', 'liberada', 'recusada');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"ip" text,
	"detalhe" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_attempt" (
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "auth_attempt_kind_subject_pk" PRIMARY KEY("kind","subject")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'leitor' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "effect_ledger" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"effect" text NOT NULL,
	"ref_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"ref_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"enqueued_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"reservation_id" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"delta_microusd" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_ledger_month" CHECK ("budget_ledger"."month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"month_key" text NOT NULL,
	"route" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"max_estimated_microusd" integer NOT NULL,
	"state" "reservation_state" DEFAULT 'reservada' NOT NULL,
	"actual_microusd" integer,
	"generation_id" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_reservations_month" CHECK ("budget_reservations"."month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_reservations_max" CHECK ("budget_reservations"."max_estimated_microusd" >= 0),
	CONSTRAINT "budget_reservations_provider" CHECK ("budget_reservations"."provider" IN ('anthropic', 'openai', 'deepseek')),
	CONSTRAINT "budget_reservations_conciliada" CHECK ("budget_reservations"."state" <> 'conciliada' OR ("budget_reservations"."actual_microusd" IS NOT NULL AND "budget_reservations"."generation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agenda_events" (
	"id" text PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"local" text NOT NULL,
	"url" text,
	"editorias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"patrocinado" boolean DEFAULT false NOT NULL,
	"fonte_url" text NOT NULL,
	CONSTRAINT "agenda_periodo" CHECK ("agenda_events"."fim" >= "agenda_events"."inicio")
);
--> statement-breakpoint
CREATE TABLE "article_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"de" text NOT NULL,
	"para" text NOT NULL,
	"actor_id" text NOT NULL,
	"nota" text,
	"receipt_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"direitos" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tipo" CHECK ("media"."tipo" IN ('imagem', 'video', 'documento')),
	CONSTRAINT "media_sha" CHECK ("media"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "publication_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"versao" integer NOT NULL,
	"conteudo_sha256" text NOT NULL,
	"checagens" jsonb NOT NULL,
	"aprovador" text NOT NULL,
	"identidade_publicacao" text NOT NULL,
	"emitido_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_receipts_sha" CHECK ("publication_receipts"."conteudo_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_ledger" ADD CONSTRAINT "budget_ledger_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_transitions" ADD CONSTRAINT "article_transitions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_transitions" ADD CONSTRAINT "article_transitions_receipt_id_publication_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."publication_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_receipts" ADD CONSTRAINT "publication_receipts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_user_idx" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_uq" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox" USING btree ("status","enqueued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_ledger_idem_uq" ON "budget_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_ledger_month_idx" ON "budget_ledger" USING btree ("month_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservations_idem_uq" ON "budget_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "article_transitions_article_idx" ON "article_transitions" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_receipts_version_uq" ON "publication_receipts" USING btree ("article_id","versao");