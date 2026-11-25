-- Reverte 0031_crm_leads_retencao: remove os gatilhos, os indices e as duas colunas. PERDE ultimo_contato_em e descartado_em (a retencao deixa de funcionar ate reaplicar).
DROP TRIGGER IF EXISTS crm_opp_toca_lead ON crm_opportunities;
DROP FUNCTION IF EXISTS ln_crm_opp_toca_lead();
DROP TRIGGER IF EXISTS crm_leads_retencao ON crm_leads;
DROP FUNCTION IF EXISTS ln_crm_lead_retencao();
DROP INDEX IF EXISTS crm_leads_descartado_idx;
DROP INDEX IF EXISTS crm_leads_retencao_idx;
ALTER TABLE crm_leads DROP COLUMN IF EXISTS descartado_em;
ALTER TABLE crm_leads DROP COLUMN IF EXISTS ultimo_contato_em;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795610909241;
