ALTER TYPE "public"."reservation_state" ADD VALUE 'pendente';--> statement-breakpoint
CREATE TABLE "budget_kill_switch" (
	"scope" text PRIMARY KEY NOT NULL,
	"active" boolean NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_refill_fees" (
	"id" text PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"amount_microusd" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_refill_fees_month" CHECK ("budget_refill_fees"."month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_refill_fees_amount" CHECK ("budget_refill_fees"."amount_microusd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_ledger" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "pool" text DEFAULT 'allocation' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "task_class" text DEFAULT 'essential' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "lane" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "escalation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "budget_reservations_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE UNIQUE INDEX "budget_refill_fees_idem_uq" ON "budget_refill_fees" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_pool" CHECK ("budget_reservations"."pool" IN ('allocation', 'reserve'));--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_task_class" CHECK ("budget_reservations"."task_class" IN ('essential', 'non_essential', 'premium', 'reserve'));--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_lane" CHECK ("budget_reservations"."lane" IN ('text', 'image'));
--> statement-breakpoint
-- Gatilhos do orçamento (gap L1/L2 do G4): transições de reserva, liberação com evidência e mês.
-- Transições permitidas: reservada -> pendente | conciliada | liberada; pendente -> conciliada | liberada.
-- Todo o resto (inclusive pendente duplo, commit duplo, release após commit, mesmo valor) é recusado.
CREATE OR REPLACE FUNCTION ln_budget_reservation_transition() RETURNS trigger AS $$
BEGIN
  IF (OLD.state = 'reservada' AND NEW.state IN ('pendente', 'conciliada', 'liberada'))
     OR (OLD.state = 'pendente' AND NEW.state IN ('conciliada', 'liberada')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'transicao ilegal de reserva: % -> %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER budget_reservation_transition BEFORE UPDATE OF state ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ln_budget_reservation_transition();
--> statement-breakpoint
CREATE TRIGGER budget_reservation_no_delete BEFORE DELETE ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
-- Ledger: a linha de conciliação ou liberação só entra enquanto a reserva está aberta ou pendente.
-- Liberação de pendente exige evidência não vazia. Por isso o app grava a linha ANTES de mudar o estado.
CREATE OR REPLACE FUNCTION ln_budget_ledger_guard() RETURNS trigger AS $$
DECLARE
  st reservation_state;
BEGIN
  SELECT state INTO st FROM budget_reservations WHERE id = NEW.reservation_id;
  IF NEW.kind = 'reserva' THEN
    IF st IS DISTINCT FROM 'reservada' THEN
      RAISE EXCEPTION 'reserva deve nascer reservada (estado %)', st USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.kind IN ('conciliacao', 'liberacao') THEN
    IF st NOT IN ('reservada', 'pendente') THEN
      RAISE EXCEPTION 'reserva % ja encerrada (%), nao aceita %', NEW.reservation_id, st, NEW.kind USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'liberacao' AND st = 'pendente' AND (NEW.evidence IS NULL OR btrim(NEW.evidence) = '') THEN
      RAISE EXCEPTION 'liberacao de reserva pendente exige evidencia' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER budget_ledger_guard BEFORE INSERT ON budget_ledger
  FOR EACH ROW EXECUTE FUNCTION ln_budget_ledger_guard();
