-- Reverte 0032_auth_session_ip_limpo: so tira o registro da migracao. O IP cru que foi zerado NAO volta (e nao deve).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795617550443;
