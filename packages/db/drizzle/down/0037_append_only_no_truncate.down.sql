-- Rollback da 0037: só remove os triggers de TRUNCATE. Nenhuma linha das cinco tabelas é tocada.
DROP TRIGGER IF EXISTS openbot_pilot_resolutions_no_truncate ON openbot_pilot_resolutions;
DROP TRIGGER IF EXISTS budget_ledger_no_truncate ON budget_ledger;
DROP TRIGGER IF EXISTS effect_ledger_no_truncate ON effect_ledger;
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
DROP TRIGGER IF EXISTS publication_receipts_no_truncate ON publication_receipts;
