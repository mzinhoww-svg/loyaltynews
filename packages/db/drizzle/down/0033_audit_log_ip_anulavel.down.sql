-- Reverte 0033_audit_log_ip_anulavel: volta o audit_log a append-only TOTAL (ln_reject_mutation). Os IPs ja anulados NAO voltam.
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
DROP FUNCTION IF EXISTS ln_audit_log_guard();
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795617553402;
