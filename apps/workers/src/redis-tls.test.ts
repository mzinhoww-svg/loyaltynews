import { describe, expect, it } from 'vitest';
import { redisTlsFromEnv, redisTlsOptions } from './redis-tls';

const CA = '-----BEGIN CERTIFICATE-----\nQUFB\nQkJC\n-----END CERTIFICATE-----\n';
const CERT = '-----BEGIN CERTIFICATE-----\nQ0ND\nREQ=\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN PRIVATE KEY-----\nS0VZ\nS0VZ\n-----END PRIVATE KEY-----\n';
const oneLine = (pem: string) => pem.trimEnd().replace(/\n/g, '\\n');
const env = (over: Record<string, string | undefined> = {}) => ({
  REDIS_URL: 'rediss://default:segredo@cache.example:6380', REDIS_SSL_CA_PEM: CA, REDIS_SSL_CERT_PEM: CERT, REDIS_SSL_KEY_PEM: KEY, ...over,
});

describe('redisTlsFromEnv', () => {
  it('rediss:// com as três variáveis: tls com CA, cert, chave, servername = host da URL e rejectUnauthorized', () => {
    expect(redisTlsFromEnv(env())).toEqual({ ca: CA, cert: CERT, key: KEY, servername: 'cache.example', rejectUnauthorized: true });
    expect(redisTlsOptions(env())).toEqual({ tls: { ca: CA, cert: CERT, key: KEY, servername: 'cache.example', rejectUnauthorized: true } });
  });
  it('host que é IP (v4 ou v6): sem servername (o Node recusa SNI com IP); com nome DNS: servername = host', () => {
    expect(redisTlsFromEnv(env({ REDIS_URL: 'rediss://default:x@10.1.2.3:6380' }))).toEqual({ ca: CA, cert: CERT, key: KEY, rejectUnauthorized: true });
    expect(redisTlsFromEnv(env({ REDIS_URL: 'rediss://default:x@[::1]:6380' }))).not.toHaveProperty('servername');
    expect(redisTlsFromEnv(env({ REDIS_URL: 'rediss://default:x@redis.interno.vertra:6380' }))?.servername).toBe('redis.interno.vertra');
  });
  it('PEM em uma linha com \\n escapado dá o mesmo resultado que multilinha', () => {
    const flat = env({ REDIS_SSL_CA_PEM: oneLine(CA), REDIS_SSL_CERT_PEM: oneLine(CERT), REDIS_SSL_KEY_PEM: oneLine(KEY) });
    expect(redisTlsFromEnv(flat)).toEqual(redisTlsFromEnv(env()));
  });
  it('sem REDIS_URL ⇒ undefined (o comportamento atual: sem Redis, o ad server sub-conta)', () => {
    expect(redisTlsFromEnv({})).toBeUndefined();
    expect(redisTlsOptions({})).toEqual({});
    expect(redisTlsFromEnv(env({ REDIS_URL: undefined }))).toBeUndefined();
  });
  it('rediss:// sem os PEM ⇒ erro que nomeia só as variáveis; conjunto incompleto também', () => {
    expect(() => redisTlsFromEnv({ REDIS_URL: 'rediss://h:6380' })).toThrow(/REDIS_SSL_CA_PEM, REDIS_SSL_CERT_PEM e REDIS_SSL_KEY_PEM/);
    for (const falta of ['REDIS_SSL_CA_PEM', 'REDIS_SSL_CERT_PEM', 'REDIS_SSL_KEY_PEM']) {
      expect(() => redisTlsFromEnv(env({ [falta]: undefined }))).toThrow(/REDIS_SSL_/);
    }
  });
  it('a senha da URL e o PEM nunca aparecem nas mensagens de erro', () => {
    const k = 'SEGREDO-DA-CHAVE';
    for (const e of [env({ REDIS_SSL_KEY_PEM: k }), env({ REDIS_URL: 'rediss://default:segredo@' }), { REDIS_URL: 'rediss://default:segredo@h:1' }]) {
      let msg = '';
      try {
        redisTlsFromEnv(e);
      } catch (x) {
        msg = (x as Error).message;
      }
      expect(msg).not.toContain('segredo');
      expect(msg).not.toContain(k);
    }
  });
  it('redis:// (sem TLS): produção ⇒ erro; fora de produção ⇒ sem TLS; com PEM configurados o TLS vale mesmo com redis://', () => {
    expect(() => redisTlsFromEnv({ REDIS_URL: 'redis://h:6379', NODE_ENV: 'production' })).toThrow(/rediss:\/\//);
    expect(redisTlsFromEnv({ REDIS_URL: 'redis://h:6379' })).toBeUndefined();
    expect(redisTlsFromEnv(env({ REDIS_URL: 'redis://h:6379' }))?.servername).toBe('h');
  });
  it('REDIS_SSL_MODE: disable só com CI=true; valor inválido recusado; verify-full exige os PEM', () => {
    expect(redisTlsFromEnv({ REDIS_URL: 'redis://h:6379', REDIS_SSL_MODE: 'disable', CI: 'true', NODE_ENV: 'production' })).toBeUndefined();
    expect(() => redisTlsFromEnv({ REDIS_URL: 'redis://h:6379', REDIS_SSL_MODE: 'disable' })).toThrow(/CI=true/);
    expect(() => redisTlsFromEnv({ REDIS_URL: 'redis://h:6379', REDIS_SSL_MODE: 'require' })).toThrow(/inválido/);
    expect(() => redisTlsFromEnv({ REDIS_URL: 'redis://h:6379', REDIS_SSL_MODE: 'verify-full' })).toThrow(/REDIS_SSL_CA_PEM/);
  });
  it('URL inválida e protocolo estranho são recusados', () => {
    expect(() => redisTlsFromEnv({ REDIS_URL: 'isto nao e url' })).toThrow(/inválida/);
    expect(() => redisTlsFromEnv(env({ REDIS_URL: 'http://h:80' }))).toThrow(/rediss:\/\/ ou redis:\/\//);
  });
});
