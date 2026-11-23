-- PROPOSTA (NÃO APLICADA) — migração 0030: índices cobrindo para as consultas de grafo (ADR-009), depois da 0029 do Backend 3.
-- Dono do schema `intelligence`: @ln/db (Chief Architect/DevOps). Este arquivo é só o texto candidato; entra no drizzle como migração customizada
-- (drizzle-kit generate --custom) SE a medição no PostgreSQL real mostrar ganho (bench-pg --with-indexes: compara antes/depois no mesmo servidor).
--
-- Por que cobrindo: a consulta do produto só precisa de (id da aresta, extremos, vigência, certeza); com INCLUDE a sonda por pessoa/organização/relação
-- vira varredura só de índice (Index Only Scan) sem visitar a tabela (requer a visibilidade em dia: VACUUM normal já cuida).
-- Custo: ~4 índices a mais (espaço e escrita em org_relation/role_assignment; volume de escrita desta frente é pequeno: carga editorial, não transacional).
-- Não usar CONCURRENTLY aqui: o migrador roda em transação e as tabelas são pequenas (milhares a poucas centenas de milhares de linhas).
--
-- Reversão: DROP INDEX IF EXISTS intelligence.<nome>; (sem perda de dado).

CREATE INDEX IF NOT EXISTS org_relation_from_cov_idx ON intelligence.org_relation (from_org_id) INCLUDE (id, to_org_id, valid_from, valid_to, certainty);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_relation_to_cov_idx ON intelligence.org_relation (to_org_id) INCLUDE (id, from_org_id, valid_from, valid_to, certainty);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS role_assignment_person_cov_idx ON intelligence.role_assignment (person_id) INCLUDE (id, organization_id, valid_from, valid_to, certainty);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS role_assignment_org_cov_idx ON intelligence.role_assignment (organization_id) INCLUDE (id, person_id, valid_from, valid_to, certainty);
