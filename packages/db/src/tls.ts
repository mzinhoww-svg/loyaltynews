// TLS do PostgreSQL para o RUNTIME (web, auth e workers). Mesmo contrato do migrate.ts (R0-07): a Vertra exige TLS com verificação
// completa do servidor (verify-full) E certificado de cliente; senha sozinha nunca conecta.
//   DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM: conteúdo PEM em variável (nunca arquivo no repositório). Aceita PEM multilinha
//   ou em UMA linha com `\n` escapado (painéis de variáveis costumam achatar quebras de linha).
//   DB_SSL_MODE=verify-full (padrão) | disable (só com CI=true: Postgres efêmero do CI).
//   Sem as três variáveis: em NODE_ENV=production é erro (falha fechada); fora de produção, conexão sem TLS (desenvolvimento local).
// Arquivo autocontido (sem imports relativos; só módulos do Node). Nunca devolve nem registra o conteúdo dos PEM em mensagens de erro.

import { X509Certificate, createPrivateKey } from 'node:crypto';
import { createSecureContext } from 'node:tls';

export type PgSsl = false | { ca: string; cert: string; key: string; rejectUnauthorized: true };

/** Limite de uma variável de ambiente na Vertra (caracteres). */
export const ENV_VALUE_MAX = 3072;

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

/**
 * PEM vindo de variável, em QUALQUER forma que painéis e executores costumam entregar: com aspas, com CRLF, com `\n` escapado (inteiro ou misturado com
 * quebras reais), achatado com ESPAÇOS no lugar das quebras, ou codificado em base64 (o PEM inteiro). Reconstrói cada bloco `-----BEGIN X-----…-----END X-----`
 * com o corpo limpo em linhas de 64 colunas. Sem nenhum bloco reconhecível, devolve o texto limpo como estava (a validação acusa o formato).
 */
export function normalizePem(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  v = v.replace(/\r\n/g, '\n');
  // tudo numa linha com `\n` escapado (painéis que achatam): volta a ter as quebras reais ANTES de reconstruir os blocos
  if (!v.includes('\n') && v.includes('\\n')) v = v.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  if (!v.includes('-----BEGIN ') && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 80) {
    // sem cabeçalho PEM, mas só caracteres de base64: pode ser o PEM inteiro em base64
    const dec = Buffer.from(v.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (dec.includes('-----BEGIN ')) v = dec.trim();
  }
  if (!v) return undefined;
  const blocks: string[] = [];
  for (const m of v.matchAll(PEM_BLOCK)) {
    const rawBody = (m[2] ?? '').trim();
    // forma canônica (linhas só de base64 separadas por quebras reais): mantém como veio; qualquer outra forma é reconstruída em linhas de 64 colunas
    const canonical = /^[A-Za-z0-9+/=]+(?:\n[A-Za-z0-9+/=]+)*$/.test(rawBody);
    // tira `\n` escapado (uma ou duas vezes), quebras, espaços, aspas e barras sobrando: o corpo de um PEM só tem o alfabeto base64
    const body = rawBody.replace(/\\+(?:r\\+)?n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
    const lines = canonical ? rawBody.split('\n') : (body.match(/.{1,64}/g) ?? []);
    blocks.push(`-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[1]}-----`);
  }
  if (blocks.length > 0) return `${blocks.join('\n')}\n`;
  if (!v.includes('\n') && v.includes('\\n')) v = v.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  return v.endsWith('\n') ? v : `${v}\n`;
}

/** Fatos ESTRUTURAIS de uma variável PEM (nunca o conteúdo): servem para achar, no log, o que o processo realmente recebeu. */
export function describePem(raw: string | undefined): Record<string, number | boolean> {
  const v = raw ?? '';
  return {
    chars: v.length,
    lines: v.length === 0 ? 0 : v.split('\n').length,
    begins: (v.match(/-----BEGIN /g) ?? []).length,
    ends: (v.match(/-----END /g) ?? []).length,
    hasCR: v.includes('\r'),
    hasEscapedNewline: v.includes('\\n'),
    hasQuotes: /^["']|["']$/.test(v.trim()),
    startsWithBegin: v.trim().startsWith('-----BEGIN '),
    flattenedWithSpaces: !v.includes('\n') && /-----BEGIN [A-Z ]+----- \S/.test(v),
  };
}

/**
 * Confere de verdade cada PEM (certificado e chave) com o OpenSSL do Node, SEM abrir conexão, e diz QUAL variável falhou e por quê (só a classe/código do
 * erro e os fatos estruturais, nunca o conteúdo). `ok: false` = o processo não deve nem tentar conectar.
 */
export function selfCheckPemSet(env: Record<string, string | undefined>, prefix: string): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const vars = [`${prefix}_CA_PEM`, `${prefix}_CERT_PEM`, `${prefix}_KEY_PEM`] as const;
  const bad = (name: string, e: unknown) => {
    ok = false;
    const x = e as { code?: string; message?: string };
    lines.push(`${name}: FALHA (${x?.code ?? (x?.message ?? 'erro').split('\n')[0]}) fatos=${JSON.stringify(describePem(env[name]))}`);
  };
  for (const name of vars) {
    const raw = env[name];
    if (!raw?.trim()) {
      ok = false;
      lines.push(`${name}: AUSENTE`);
      continue;
    }
    const pem = normalizePem(raw)!;
    try {
      if (name.endsWith('_KEY_PEM')) {
        createPrivateKey(pem);
        lines.push(`${name}: ok (chave privada) fatos=${JSON.stringify(describePem(raw))}`);
      } else {
        const certs = [...pem.matchAll(PEM_BLOCK)].filter((m) => m[1] === 'CERTIFICATE');
        if (certs.length === 0) throw Object.assign(new Error('nenhum bloco CERTIFICATE'), { code: 'NO_CERTIFICATE_BLOCK' });
        for (const m of certs) new X509Certificate(m[0]);
        lines.push(`${name}: ok (${certs.length} certificado(s)) fatos=${JSON.stringify(describePem(raw))}`);
      }
    } catch (e) {
      bad(name, e);
    }
  }
  if (ok) {
    try {
      const { ca, cert, key } = pems(env, prefix);
      createSecureContext({ ca, cert, key }); // o que o TLS faz na conexão: cadeia e par cert/chave coerentes
      lines.push(`${prefix}: contexto TLS ok`);
    } catch (e) {
      ok = false;
      const x = e as { code?: string; message?: string };
      lines.push(`${prefix}: contexto TLS FALHOU (${x?.code ?? (x?.message ?? 'erro').split('\n')[0]}): cert e chave não formam par, ou a CA não valida o cert`);
    }
  }
  return { ok, lines };
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
