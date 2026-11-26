-- Exclusão MANUAL de UM lead, só para atender pedido do titular enquanto a rota não funcionar (sem LN_LEAD_AUDIT_SALT).
-- Exige autorização escrita do proprietário para cada pedido; quem executa é o DevOps. Não grava a trilha HMAC: registre à mão.
-- uso: psql ... -v ON_ERROR_STOP=1 -v lead='<id do lead>' -f excluir-lead.sql
-- Apaga a pessoa em crm_leads; a conta e a oportunidade ficam (sem o vínculo), como faz a rota.
BEGIN;
-- Mesma trava das escritas do CRM (COMMERCIAL_LOCK): sem ela, uma gravação em andamento poderia recriar o lead apagado.
SELECT pg_advisory_xact_lock(7010001);
UPDATE crm_opportunities SET lead_id = NULL WHERE lead_id = :'lead';
DELETE FROM crm_leads WHERE id = :'lead' RETURNING 1 AS apagado;
SELECT count(*) AS restantes FROM crm_leads WHERE id = :'lead';
COMMIT;
