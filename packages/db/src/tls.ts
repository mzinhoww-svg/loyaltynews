// TLS do PostgreSQL para o RUNTIME (web, auth e workers). Mesmo contrato do migrate.ts (R0-07): a Vertra exige TLS com verificação
// completa do servidor (verify-full) E certificado de cliente; senha sozinha nunca conecta.
//   DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM: conteúdo PEM em variável (nunca arquivo no repositório). Aceita PEM multilinha
//   ou em UMA linha com `\n` escapado (painéis de variáveis costumam achatar quebras de linha).
//   DB_SSL_MODE=verify-full (padrão) | disable (só com CI=true: Postgres efêmero do CI).
//   Sem as três variáveis: em NODE_ENV=production é erro (falha fechada); fora de produção, conexão sem TLS (desenvolvimento local).
// Arquivo autocontido (sem imports relativos). Nunca devolve nem registra o conteúdo dos PEM em mensagens de erro.

export type PgSsl = false | { ca: string; cert: string; key: string; rejectUnauthorized: true };

/** Limite de uma variável de ambiente na Vertra (caracteres). */
export const ENV_VALUE_MAX = 3072;

/** PEM vindo de variável: tira aspas ao redor, converte `\n` escapado em quebra de linha e garante quebra final. */
export function normalizePem(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  v = v.replace(/\r\n/g, '\n');
  if (!v.includes('\n') && v.includes('\\n')) v = v.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  if (!v) return undefined;
  return v.endsWith('\n') ? v : `${v}\n`;
}

function pems(env: Record<string, string | undefined>, prefix: string): { ca?: string; cert?: string; key?: string } {
  return { ca: normalizePem(env[`${prefix}_CA_PEM`]), cert: normalizePem(env[`${prefix}_CERT_PEM`]), key: normalizePem(env[`${prefix}_KEY_PEM`]) };
}

/** Valida um conjunto CA/cert/chave: todos presentes, formato PEM e o tipo certo de bloco em cada um. */
export function requirePemSet(env: Record<string, string | undefined>, prefix: string): { ca: string; cert: string; key: string } {
  const { ca, cert, key } = pems(env, prefix);
  if (!ca || !cert || !key) throw new Error(`TLS exige ${prefix}_CA_PEM, ${prefix}_CERT_PEM e ${prefix}_KEY_PEM`);
  if (!/-----BEGIN CERTIFICATE-----/.test(ca)) throw new Error(`${prefix}_CA_PEM não parece um certificado PEM`);
  if (!/-----BEGIN CERTIFICATE-----/.test(cert)) throw new Error(`${prefix}_CERT_PEM não parece um certificado PEM`);
  if (!/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(key)) throw new Error(`${prefix}_KEY_PEM não parece uma chave privada PEM`);
  return { ca, cert, key };
}

export function anyPemSet(env: Record<string, string | undefined>, prefix: string): boolean {
  return [`${prefix}_CA_PEM`, `${prefix}_CERT_PEM`, `${prefix}_KEY_PEM`].some((k) => !!env[k]?.trim());
}

/** Configuração `ssl` do node-postgres a partir do ambiente (verify-full + certificado de cliente). */
export function pgSslFromEnv(env: Record<string, string | undefined> = process.env): PgSsl {
  if (env.DB_SSL_MODE === 'disable') {
    if (env.CI !== 'true') throw new Error('DB_SSL_MODE=disable só é permitido com CI=true');
    return false;
  }
  if (env.DB_SSL_MODE !== undefined && env.DB_SSL_MODE !== 'verify-full') {
    throw new Error(`DB_SSL_MODE inválido: ${env.DB_SSL_MODE} (use verify-full ou, só no CI, disable)`);
  }
  if (!anyPemSet(env, 'DB_SSL')) {
    if (env.NODE_ENV === 'production' || env.DB_SSL_MODE === 'verify-full') throw new Error('TLS exige DB_SSL_CA_PEM, DB_SSL_CERT_PEM e DB_SSL_KEY_PEM');
    return false; // desenvolvimento local sem TLS
  }
  return { ...requirePemSet(env, 'DB_SSL'), rejectUnauthorized: true };
}

/** Tira da URL os parâmetros de TLS (`sslmode`, `sslcert`…): quem manda no TLS é a configuração `ssl`, nunca a string de conexão. */
export function stripSslParams(url: string): string {
  const i = url.indexOf('?');
  if (i < 0) return url;
  const kept = url
    .slice(i + 1)
    .split('&')
    .filter((p) => p && !/^(?:sslmode|ssl|sslcert|sslkey|sslrootcert|sslpassword|uselibpqcompat)(?:=|$)/i.test(p));
  return kept.length ? `${url.slice(0, i)}?${kept.join('&')}` : url.slice(0, i);
}

/** Opções do `pg.Pool` para o runtime: URL sem parâmetros de TLS + `ssl` do ambiente. */
export function pgPoolConfig(env: Record<string, string | undefined>, opts: { max: number }): { connectionString: string; ssl: PgSsl; max: number } {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  return { connectionString: stripSslParams(url), ssl: pgSslFromEnv(env), max: opts.max };
}
