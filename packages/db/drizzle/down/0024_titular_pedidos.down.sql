-- Reverte 0024_titular_pedidos: remove a fila do canal do titular (DP-38) e o registro da migracao (para ela poder ser aplicada de novo).
-- PERDE os pedidos de correcao/remocao ja recebidos (dado pessoal): so rode em staging/desenvolvimento ou depois de exportar e tratar os pedidos em aberto.
DROP TABLE IF EXISTS titular_pedidos;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795448928054;
