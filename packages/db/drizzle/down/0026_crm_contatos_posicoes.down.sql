-- Reverte crm_contatos_posicoes: remove os contatos das contas do CRM e as posicoes multiplas das campanhas, e o registro da migracao.
-- PERDE os contatos (dado pessoal: exporte antes se precisar atender titular) e as posicoes alem da primeira (campaigns.slot_id, a primeira, fica).
-- So rode em staging/desenvolvimento ou depois de exportar. Nenhuma outra tabela e tocada.
DROP TABLE IF EXISTS campaign_positions;
DROP TABLE IF EXISTS crm_contacts;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795450171063;
