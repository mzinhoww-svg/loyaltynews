-- Reverte 0022_openbot_fila_custos: remove as tabelas openbot_* (nao ha dado de outras tabelas nelas) e o registro da migracao, para ela poder ser aplicada de novo.
-- Perde o conteudo da fila, da trilha do piloto, dos custos relatados e do armazem de conteudo: so rode em staging/desenvolvimento ou depois de exportar.
-- Ordem: custos referenciam tarefas.
DROP TABLE IF EXISTS openbot_io;
DROP TABLE IF EXISTS openbot_pilot_state;
DROP TABLE IF EXISTS openbot_pilot_rows;
DROP TABLE IF EXISTS openbot_health;
DROP TABLE IF EXISTS openbot_cost_entries;
DROP TABLE IF EXISTS openbot_callbacks;
DROP TABLE IF EXISTS openbot_tasks;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795441426476;
