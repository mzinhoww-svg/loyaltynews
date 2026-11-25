-- Fecha o furo de TRUNCATE nas cinco tabelas append-only. O trigger de linha (BEFORE UPDATE OR DELETE
-- FOR EACH ROW) não dispara em TRUNCATE; este é FOR EACH STATEMENT e a ln_reject_mutation recusa TG_OP='TRUNCATE'
-- com erro 23000, preservando as linhas. Os cinco nomes vêm da 0002 (budget_ledger, effect_ledger, audit_log,
-- publication_receipts) e da 0031 (openbot_pilot_resolutions).
-- Renumerada de 0032 (ft/openbot-pilot-append-only, 64a90ec) para 0037; o corpo dos triggers é o mesmo.
CREATE TRIGGER openbot_pilot_resolutions_no_truncate BEFORE TRUNCATE ON openbot_pilot_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER budget_ledger_no_truncate BEFORE TRUNCATE ON budget_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER effect_ledger_no_truncate BEFORE TRUNCATE ON effect_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER publication_receipts_no_truncate BEFORE TRUNCATE ON publication_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION ln_reject_mutation();
