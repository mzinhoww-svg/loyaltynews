-- Reverte creative_cards: remove os cards sociais do Creative Studio e o registro da migracao (para ela poder ser aplicada de novo).
-- PERDE os cards e o historico de revisao gravados (a trilha em audit_log fica). Nenhuma outra tabela e tocada; nada foi enviado ao mLabs.
DROP TABLE IF EXISTS creative_cards;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795450168743;
