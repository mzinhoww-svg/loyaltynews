-- Índices para a travessia do grafo (consultas de até 3 saltos, ADR-009). Sem eles, cada salto varre toda a relação.
SET search_path TO intelligence, public;
CREATE INDEX org_relation_from_idx ON org_relation (from_org_id);
CREATE INDEX org_relation_to_idx   ON org_relation (to_org_id);
CREATE INDEX org_chart_edge_sup_idx ON org_chart_edge (superior_role_id);
CREATE INDEX org_chart_edge_sub_idx ON org_chart_edge (subordinate_role_id);
CREATE INDEX move_from_role_idx ON move (from_role_id);
CREATE INDEX move_to_role_idx ON move (to_role_id);
