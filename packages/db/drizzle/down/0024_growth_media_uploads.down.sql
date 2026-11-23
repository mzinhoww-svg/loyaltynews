-- Reverte 0024_growth_media_uploads: remove o registro dos envios de midia do mLabs e o registro da migracao (para ela poder ser aplicada de novo).
-- Efeito: o proximo envio sobe a imagem de novo (a idempotencia do mLabs NAO foi verificada); nenhum outro dado e perdido.
DROP TABLE IF EXISTS growth_media_uploads;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795448461583;
