-- Reverte 0028_openbot_pilot_resolutions: remove as resolucoes de violacao do piloto e o registro da migracao (para ela poder ser aplicada de novo).
-- PERDE o registro de quem tratou cada violacao (a trilha em audit_log fica); as linhas do piloto (openbot_pilot_rows) NAO sao tocadas e as violacoes voltam a bloquear o despacho.
-- Ordem: esta reversao tem de rodar ANTES da 0022 (a tabela tem FK para openbot_pilot_rows).
DROP TABLE IF EXISTS openbot_pilot_resolutions;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795463954203;
