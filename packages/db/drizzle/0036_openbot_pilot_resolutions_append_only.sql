-- openbot_pilot_resolutions: trilha append-only de verdade. O motivo do config_invalid e o registro de quem tratou
-- a linha não podem ser reescritos nem apagados; corrigir é inserir outra resolução (mesma task, outro attempt) ou
-- tratar em outra tabela. A função ln_reject_mutation (migração 0002) recusa com erro 23000 e nomeia a operação.
-- Renumerada de 0031 (ft/openbot-pilot-append-only, e43fb25) para 0036; o corpo do trigger é o mesmo.
CREATE TRIGGER openbot_pilot_resolutions_append_only BEFORE UPDATE OR DELETE ON openbot_pilot_resolutions
  FOR EACH ROW EXECUTE FUNCTION ln_reject_mutation();
