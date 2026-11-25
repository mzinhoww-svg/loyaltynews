-- Retencao do codigo de IP do audit_log (decisao do PM, 25/11): o codigo (HMAC h1:) fica por 12 meses e depois e ANULADO. E a UNICA excecao ao append-only: so a coluna ip,
-- so para NULL, com TODO o resto da linha igual; apagar a linha e qualquer outra mudanca continuam rejeitados (mesmo erro 23000 de ln_reject_mutation).
CREATE FUNCTION ln_audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ip IS NULL AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER audit_log_append_only ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION ln_audit_log_guard();
