import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readiness, tlsState } from '../_lib/ready';

// /api/ready: o TLS dos certificados do ambiente é conferido UMA vez, sem abrir conexão, e o corpo público só diz `ok`/`invalido` por grupo (sem variável,
// código do OpenSSL nem formato); TLS inválido = 503. O par de teste é gerado aqui (nenhuma chave versionada).
const dir = mkdtempSync(join(tmpdir(), 'ln-ready-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=ln-ready.invalid'], { stdio: 'ignore' });
execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', join(dir, 'k.pem'), '-out', join(dir, 'k8.pem')], { stdio: 'ignore' });
const lf = (s: string) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const crt = lf(readFileSync(join(dir, 'c.pem'), 'utf8'));
const key = lf(readFileSync(join(dir, 'k8.pem'), 'utf8'));
const um = (s: string) => s.trim().replace(/\n/g, '\\n');

const ok = async () => undefined;
const boa = (extra: Record<string, string> = {}) => ({
  NODE_ENV: 'production', REDIS_URL: 'rediss://default:segredo-da-url@redis.exemplo.invalid:6379',
  DB_SSL_CA_PEM: um(crt), DB_SSL_CERT_PEM: um(crt), DB_SSL_KEY_PEM: um(key),
  REDIS_SSL_CA_PEM: um(crt), REDIS_SSL_CERT_PEM: um(crt), REDIS_SSL_KEY_PEM: um(key), ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('/api/ready: estado do TLS', () => {
  it('PEM completo (inclusive em uma linha com \\n escapado): tls ok nos dois grupos e a prontidão depende só das sondas', async () => {
    const r = await readiness(boa(), { db: ok, redis: ok });
    expect(r).toMatchObject({ status: 'ok', mode: 'completo', db: 'ok', redis: 'ok', tls: { db: 'ok', redis: 'ok' } });
  });

  it('PEM truncado (só a 1ª linha, o que a Vertra repassa de variável multilinha): invalido, 503, e o corpo NÃO traz variável, código nem formato; o detalhe vai ao log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = boa({ DB_SSL_CERT_PEM: '-----BEGIN CERTIFICATE-----', REDIS_SSL_KEY_PEM: '-----BEGIN PRIVATE KEY-----' });
    const r = await readiness(env, { db: ok, redis: ok });
    expect(r.status).toBe('indisponivel');
    expect(r.tls).toEqual({ db: 'invalido', redis: 'invalido' });
    const publico = JSON.stringify(r);
    expect(publico).not.toMatch(/PEM|ERR_OSSL|BEGIN|lines|chars|DB_SSL|REDIS_SSL|segredo-da-url/);
    const logado = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logado).toMatch(/DB_SSL_CERT_PEM: FALHA/);
    expect(logado).toMatch(/REDIS_SSL_KEY_PEM: FALHA/);
    expect(logado).not.toContain('segredo-da-url');
  });

  it('é calculado UMA vez por processo (mesmo objeto de ambiente): a segunda chamada não confere nem loga de novo', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = boa({ DB_SSL_KEY_PEM: 'lixo' });
    expect(tlsState(env).db).toBe('invalido');
    const n = log.mock.calls.length;
    env.DB_SSL_KEY_PEM = key; // mudar depois do boot não vale (e não é relido)
    expect(tlsState(env).db).toBe('invalido');
    expect(log.mock.calls.length).toBe(n);
  });

  it('produção sem certificados do banco: invalido (falha fechada); fora de produção sem eles: nao_configurado; REDIS_URL sem TLS em produção: invalido; sem REDIS_URL: nao_configurado', () => {
    expect(tlsState({ NODE_ENV: 'production' }).db).toBe('invalido');
    expect(tlsState({}).db).toBe('nao_configurado');
    expect(tlsState({ NODE_ENV: 'production', REDIS_URL: 'redis://x.invalid:6379' }).redis).toBe('invalido');
    expect(tlsState({}).redis).toBe('nao_configurado');
    expect(tlsState({ DB_SSL_MODE: 'disable', CI: 'true' }).db).toBe('n/a');
  });

  it('APP_MODE=nodb: ok e tls n/a (o site sobe sem banco)', async () => {
    expect(await readiness({ APP_MODE: 'nodb' }, {})).toEqual({ status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a', tls: { db: 'n/a', redis: 'n/a' } });
  });

});
