-- Privacidade (LGPD): o limite de tentativas passa a guardar so um HMAC (`h1:<hex>`) de kind + sujeito, nunca o IP nem o e-mail em claro (packages/auth/src/attempts.ts).
-- As linhas atuais estao no formato antigo (IP e e-mail crus) e NAO sao convertidas: sao apagadas. Efeito: zera contadores e levanta bloqueios em curso (janelas de 15 min).
DELETE FROM "auth_attempt";
