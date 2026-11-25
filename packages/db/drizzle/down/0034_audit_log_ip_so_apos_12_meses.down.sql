-- Reverte 0034: volta a funcao da 0033 (anular o ip de QUALQUER linha). Atencao: reabre a brecha de apagar o rastro de IP de evento recente.
CREATE OR REPLACE FUNCTION ln_audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ip IS NULL AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795619465555;
