-- editorial_audit é somente-acréscimo (contrato da porta EditorialStore): UPDATE e DELETE são recusados.
CREATE TRIGGER editorial_audit_append_only BEFORE UPDATE OR DELETE ON editorial_audit FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
