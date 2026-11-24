-- PROPOSTA (NÃO APLICADA) — migração 0031: tipo de relação `association_member` ("é associada de"). Ver RELATION_TYPES.md.
-- Dono do schema `intelligence`: @ln/db (Chief Architect/DevOps). Entra no drizzle como migração customizada, DEPOIS da 0030 e SÓ com o contrato (zod)
-- e o carregador aceitando o tipo no mesmo release (código novo antes desta migração falharia no CHECK; migração antes do código é inofensiva).
--
-- 1) amplia o CHECK (o nome do constraint é o gerado pelo PostgreSQL para a coluna: org_relation_relation_type_check)
ALTER TABLE intelligence.org_relation DROP CONSTRAINT IF EXISTS org_relation_relation_type_check;
--> statement-breakpoint
ALTER TABLE intelligence.org_relation ADD CONSTRAINT org_relation_relation_type_check
  CHECK (relation_type IN ('parent_of','partner_of','supplier_of','coalition_member','acquired','other','association_member'));
--> statement-breakpoint
-- 2) reclassifica SÓ as relações que vieram da lista oficial "Empresas Associadas" da ABEMF (preserva id, evidência e datas):
--    tipo 'other', destino = ABEMF, evidência da página web.abemf.com.br/associados/. Qualquer outra relação 'other' fica como está.
UPDATE intelligence.org_relation r
   SET relation_type = 'association_member'
  FROM intelligence.organization o, intelligence.evidence e
 WHERE r.relation_type = 'other'
   AND o.id = r.to_org_id AND o.normalized_name LIKE 'abemf%'
   AND e.id = r.evidence_id AND e.source_url = 'https://web.abemf.com.br/associados/';
--> statement-breakpoint
-- Conferência (esperado 12 em staging, após a v3):
--   SELECT count(*) FROM intelligence.org_relation WHERE relation_type = 'association_member';
-- Reversão: UPDATE intelligence.org_relation SET relation_type = 'other' WHERE relation_type = 'association_member';
--           depois recriar o CHECK sem 'association_member'.
