-- Privacidade (LGPD): o Better Auth deixa de gravar o IP na sessao (advanced.ipAddress.disableIpTracking). Desligar nao apaga o historico: zera o IP cru ja gravado.
-- Sessoes sao de 12 h; o efeito e imediato e nao derruba ninguem (so a coluna ip_address).
UPDATE "auth_session" SET "ip_address" = NULL WHERE "ip_address" IS NOT NULL;
