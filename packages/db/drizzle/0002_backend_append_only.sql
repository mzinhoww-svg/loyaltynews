-- Tabelas append-only: orçamento (ledger), efeitos, auditoria e recibos de publicação nunca são alterados.
CREATE FUNCTION ln_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER budget_ledger_append_only BEFORE UPDATE OR DELETE ON budget_ledger FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER effect_ledger_append_only BEFORE UPDATE OR DELETE ON effect_ledger FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER publication_receipts_append_only BEFORE UPDATE OR DELETE ON publication_receipts FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
