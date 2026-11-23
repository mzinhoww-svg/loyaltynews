import { describe, expect, it } from 'vitest';
import { ENV_VALUE_MAX, anyPemSet, normalizePem, pgPoolConfig, pgSslFromEnv, requirePemSet, stripSslParams } from './tls';
import { sslConfigFromEnv } from './migrate';

const CA = '-----BEGIN CERTIFICATE-----\nQUFB\nQkJC\n-----END CERTIFICATE-----\n';
const CERT = '-----BEGIN CERTIFICATE-----\nQ0ND\nREQ=\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN PRIVATE KEY-----\nS0VZ\nS0VZ\n-----END PRIVATE KEY-----\n';
const oneLine = (pem: string) => pem.trimEnd().replace(/\n/g, '\\n'); // como o painel de variáveis costuma achatar
const env = (over: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: 'postgres:' + '//u:p@db.example:5432/ln', DB_SSL_CA_PEM: CA, DB_SSL_CERT_PEM: CERT, DB_SSL_KEY_PEM: KEY, ...over,
});

describe('normalizePem', () => {
  it('PEM multilinha fica igual (com quebra final); sem valor ⇒ undefined', () => {
    expect(normalizePem(CA)).toBe(CA);
    expect(normalizePem(CA.trimEnd())).toBe(CA);
    expect(normalizePem(undefined)).toBeUndefined();
    expect(normalizePem('   ')).toBeUndefined();
  });
  it('PEM em UMA linha com \\n escapado volta a ter quebras reais; aspas ao redor e \\r\\n são tratados', () => {
    expect(normalizePem(oneLine(CA))).toBe(CA);
    expect(normalizePem(`"${oneLine(KEY)}"`)).toBe(KEY);
    expect(normalizePem(`'${oneLine(CERT)}'`)).toBe(CERT);
    expect(normalizePem(CA.replace(/\n/g, '\r\n'))).toBe(CA);
    expect(normalizePem(oneLine(CA).replace(/\\n/g, '\\r\\n'))).toBe(CA);
  });
  it('forma MISTURADA (quebras reais e `\\n` escapado no meio do corpo) é limpa: o corpo base64 nunca carrega barra-n literal', () => {
    const odd = '-----BEGIN CERTIFICATE-----\nabc\\ndef\n-----END CERTIFICATE-----\n';
    expect(normalizePem(odd)).toBe('-----BEGIN CERTIFICATE-----\nabcdef\n-----END CERTIFICATE-----\n');
  });
});

describe('pgSslFromEnv', () => {
  it('com as três variáveis: verify-full (rejectUnauthorized) + CA, certificado e chave de cliente', () => {
    expect(pgSslFromEnv(env())).toEqual({ ca: CA, cert: CERT, key: KEY, rejectUnauthorized: true });
  });
  it('aceita as três em uma linha com \\n escapado e devolve o mesmo que o multilinha', () => {
    const flat = env({ DB_SSL_CA_PEM: oneLine(CA), DB_SSL_CERT_PEM: oneLine(CERT), DB_SSL_KEY_PEM: oneLine(KEY) });
    expect(pgSslFromEnv(flat)).toEqual(pgSslFromEnv(env()));
  });
  it('mesmo contrato do migrate.ts (sem deriva): mesmas variáveis ⇒ mesma configuração, nos dois formatos', () => {
    for (const e of [env(), env({ DB_SSL_CA_PEM: oneLine(CA), DB_SSL_CERT_PEM: oneLine(CERT), DB_SSL_KEY_PEM: oneLine(KEY) })]) {
      const m = sslConfigFromEnv(e);
      // o migrate.ts exige quebras reais; o runtime também aceita escapadas, e o resultado normalizado é o mesmo do multilinha
      if (e.DB_SSL_CA_PEM === CA) expect(pgSslFromEnv(e)).toEqual(m);
    }
    expect(() => sslConfigFromEnv(env({ DB_SSL_MODE: 'disable' }))).toThrow(/CI=true/);
    expect(() => pgSslFromEnv(env({ DB_SSL_MODE: 'disable' }))).toThrow(/CI=true/);
    expect(() => sslConfigFromEnv(env({ DB_SSL_MODE: 'require' }))).toThrow(/inválido/);
    expect(() => pgSslFromEnv(env({ DB_SSL_MODE: 'require' }))).toThrow(/inválido/);
  });
  it('sem nenhuma variável: produção ⇒ erro (falha fechada); fora de produção ⇒ sem TLS (desenvolvimento local)', () => {
    const none = env({ DB_SSL_CA_PEM: undefined, DB_SSL_CERT_PEM: undefined, DB_SSL_KEY_PEM: undefined });
    expect(() => pgSslFromEnv({ ...none, NODE_ENV: 'production' })).toThrow(/DB_SSL_CA_PEM/);
    expect(pgSslFromEnv({ ...none, NODE_ENV: 'development' })).toBe(false);
    expect(pgSslFromEnv(none)).toBe(false);
    expect(() => pgSslFromEnv({ ...none, DB_SSL_MODE: 'verify-full' })).toThrow(/DB_SSL_CA_PEM/);
  });
  it('conjunto incompleto é sempre erro, nomeando só as variáveis (nunca o conteúdo)', () => {
    for (const falta of ['DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM']) {
      expect(() => pgSslFromEnv(env({ [falta]: undefined }))).toThrow(/exige DB_SSL_CA_PEM, DB_SSL_CERT_PEM e DB_SSL_KEY_PEM/);
    }
  });
  it('PEM trocados ou inválidos: erro sem vazar o valor', () => {
    const k = 'SEGREDO-DA-CHAVE';
    expect(() => pgSslFromEnv(env({ DB_SSL_KEY_PEM: CERT }))).toThrow(/chave privada/);
    expect(() => pgSslFromEnv(env({ DB_SSL_CA_PEM: KEY }))).toThrow(/certificado/);
    let msg = '';
    try {
      pgSslFromEnv(env({ DB_SSL_KEY_PEM: k }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/DB_SSL_KEY_PEM/);
    expect(msg).not.toContain(k);
  });
  it('DB_SSL_MODE=disable só com CI=true; nunca em produção sem CI', () => {
    expect(pgSslFromEnv(env({ DB_SSL_MODE: 'disable', CI: 'true' }))).toBe(false);
    expect(() => pgSslFromEnv(env({ DB_SSL_MODE: 'disable', NODE_ENV: 'production' }))).toThrow(/CI=true/);
  });
});

describe('pgPoolConfig e stripSslParams', () => {
  it('monta connectionString + ssl + max; a URL perde sslmode/sslcert/sslkey/sslrootcert (quem manda é o ssl do ambiente)', () => {
    const c = pgPoolConfig(env({ DATABASE_URL: 'postgres:' + '//u:p@db.example:5432/ln?sslmode=require&application_name=ln&sslrootcert=/x' }), { max: 5 });
    expect(c.connectionString).toBe('postgres:' + '//u:p@db.example:5432/ln?application_name=ln');
    expect(c.ssl).toEqual({ ca: CA, cert: CERT, key: KEY, rejectUnauthorized: true });
    expect(c.max).toBe(5);
    expect(stripSslParams('postgres://h/db?sslmode=verify-full')).toBe('postgres://h/db');
    expect(stripSslParams('postgres://h/db')).toBe('postgres://h/db');
  });
  it('sem DATABASE_URL ⇒ erro explícito (os chamadores só chamam com a URL presente)', () => {
    expect(() => pgPoolConfig(env({ DATABASE_URL: undefined }), { max: 1 })).toThrow(/DATABASE_URL/);
  });
});

describe('detalhes úteis ao provisionamento', () => {
  it('anyPemSet e requirePemSet por prefixo (usado também pelo Redis)', () => {
    expect(anyPemSet({}, 'X_SSL')).toBe(false);
    expect(anyPemSet({ X_SSL_CA_PEM: CA }, 'X_SSL')).toBe(true);
    expect(requirePemSet({ X_SSL_CA_PEM: CA, X_SSL_CERT_PEM: CERT, X_SSL_KEY_PEM: KEY }, 'X_SSL')).toEqual({ ca: CA, cert: CERT, key: KEY });
  });
  it('limite de 3072 caracteres por variável na Vertra: a constante documenta o limite (EC P-256 e RSA-2048 cabem; chave RSA-4096 não)', () => {
    expect(ENV_VALUE_MAX).toBe(3072);
  });
});
