CREATE TABLE "openbot_pilot_resolutions" (
	"task_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"resolvido_por" text NOT NULL,
	"resolvido_em" timestamp with time zone NOT NULL,
	"motivo" text NOT NULL,
	"acao_tomada" text NOT NULL,
	CONSTRAINT "openbot_pilot_resolutions_task_id_attempt_pk" PRIMARY KEY("task_id","attempt"),
	CONSTRAINT "openbot_pilot_resolutions_motivo" CHECK (char_length(btrim("openbot_pilot_resolutions"."motivo")) BETWEEN 10 AND 500),
	CONSTRAINT "openbot_pilot_resolutions_acao" CHECK (char_length(btrim("openbot_pilot_resolutions"."acao_tomada")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "openbot_pilot_resolutions" ADD CONSTRAINT "openbot_pilot_resolutions_row_fk" FOREIGN KEY ("task_id","attempt") REFERENCES "public"."openbot_pilot_rows"("task_id","attempt") ON DELETE no action ON UPDATE no action;