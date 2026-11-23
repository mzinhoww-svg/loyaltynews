-- Reverte 0023_ad_creatives_arquivo: remove os CHECKs e as colunas do arquivo do criativo e o registro da migracao (para ela poder ser aplicada de novo).
-- PERDE o arquivo/alt/dimensoes/hash ja gravados (o arquivo no Blob nao e tocado) e NAO reaprova os criativos que a subida revogou: so rode em staging/desenvolvimento ou depois de exportar.
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_aprovado_completo;
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_alt;
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_arquivo_coerente;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS texto_alternativo;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS arquivo_sha256;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS tamanho_kb;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS altura;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS largura;
ALTER TABLE ad_creatives DROP COLUMN IF EXISTS arquivo_mime;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795443792109;
