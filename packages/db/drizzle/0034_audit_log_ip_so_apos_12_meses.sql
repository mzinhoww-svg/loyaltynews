-- Endurece a excecao da 0033 (pedido da Security): anular o ip so vale para linha com MAIS DE 12 MESES (a mesma fronteira do job de retencao). Antes, quem tinha escrita com o
-- papel do app podia anular o IP de um evento recente e apagar o rastro de um ataque em curso, justamente o que o append-only impede. O resto segue igual: so a coluna ip, so para NULL.
CREATE OR REPLACE FUNCTION ln_audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ip IS NULL AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') AND OLD.at < now() - interval '12 months' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;
