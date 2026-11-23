-- Reverte fonte_rapida_evidencias (P2-05): remove as evidencias rapidas da Nova materia e as colunas do cadastro rapido de fontes, e o registro da migracao.
-- PERDE as evidencias anotadas (URL + trecho) e a marca 'a_confirmar' das fontes rapidas: antes de rodar, revise ou apague as fontes com revisao = 'a_confirmar'
-- (sem a coluna elas parecem fontes comuns, mas continuam inativas e sem termos revisados). Nenhuma outra tabela e tocada.
DROP TABLE IF EXISTS editorial_evidencias;
DROP INDEX IF EXISTS sources_chave_idem_uq;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_licenca;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_a_confirmar_inativa;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_revisao;
ALTER TABLE sources DROP COLUMN IF EXISTS criado_por;
ALTER TABLE sources DROP COLUMN IF EXISTS chave_idem;
ALTER TABLE sources DROP COLUMN IF EXISTS licenca;
ALTER TABLE sources DROP COLUMN IF EXISTS revisao;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795464275839;
