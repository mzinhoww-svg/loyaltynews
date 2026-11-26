-- Reverte 0030_auth_attempt_hmac: so tira o registro da migracao. As linhas apagadas de auth_attempt NAO voltam (eram estado transitorio de janelas de 15 min).
-- Atencao: o codigo anterior grava IP cru de novo; reverter a migracao sem reverter o codigo deixa linhas HMAC orfas (expiram e sao varridas).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795562530520;
