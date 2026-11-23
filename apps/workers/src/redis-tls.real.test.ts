// Conexão REAL com Redis por TLS + certificado de cliente. Só roda com LN_TEST_REAL_TLS=1:
//   LN_TEST_CERTS_DIR (ca.crt, client.crt, client.pk8.key) e LN_TEST_REDIS_TLS_URL (ex.: rediss://default:senha@127.0.0.1:56380).
// O servidor de teste usa `tls-auth-clients yes`. Sem as variáveis, o arquivo é ignorado.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import IORedis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { redisTlsOptions } from './redis-tls';

const dir = process.env.LN_TEST_CERTS_DIR;
const url = process.env.LN_TEST_REDIS_TLS_URL;
const real = process.env.LN_TEST_REAL_TLS === '1' && !!dir && !!url;
const file = (n: string) => readFileSync(join(dir!, n), 'utf8');
const oneLine = (pem: string) => pem.trimEnd().replace(/\n/g, '\n');
const good = (): Record<string, string | undefined> => ({
  REDIS_URL: url, NODE_ENV: 'production', REDIS_SSL_CA_PEM: file('ca.crt'), REDIS_SSL_CERT_PEM: file('client.crt'), REDIS_SSL_KEY_PEM: file('client.pk8.key'),
});

async function ping(env: Record<string, string | undefined>, urlOverride?: string) {
  const r = new IORedis(urlOverride ?? env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 4000, retryStrategy: () => null, ...redisTlsOptions(env) });
  r.on('error', () => undefined);
  try {
    await r.connect();
    return await r.ping();
  } finally {
    r.disconnect();
  }
}

describe.skipIf(!real)('Redis real com TLS e certificado de cliente', () => {
  it('conecta (PEM multilinha) e responde PONG', async () => {
    expect(await ping(good())).toBe('PONG');
  });
  it('conecta com os PEM em UMA linha com \n escapado', async () => {
    const e = good();
    const flat = { ...e, REDIS_SSL_CA_PEM: oneLine(e.REDIS_SSL_CA_PEM!), REDIS_SSL_CERT_PEM: oneLine(e.REDIS_SSL_CERT_PEM!), REDIS_SSL_KEY_PEM: oneLine(e.REDIS_SSL_KEY_PEM!) };
    expect(await ping(flat)).toBe('PONG');
  });
  it('os PEM cabem nas variáveis da Vertra (3072 caracteres cada)', () => {
    for (const n of ['ca.crt', 'client.crt', 'client.pk8.key']) expect(oneLine(file(n)).length).toBeLessThan(3072);
  });
  it('BullMQ funciona sobre a conexão TLS (fila, job e worker reais)', async () => {
    const { Queue, Worker } = await import('bullmq');
    const e = good();
    const mk = () => new IORedis(e.REDIS_URL!, { maxRetriesPerRequest: null, ...redisTlsOptions(e) });
    const qc = mk();
    const wc = mk();
    const name = `tls-real-${Date.now()}`;
    const q = new Queue(name, { connection: qc });
    const done = new Promise<string>((res) => {
      const w = new Worker(name, async (j) => { res(String(j.data.id)); return 'ok'; }, { connection: wc });
      void w;
    });
    await q.add('t', { id: 'abc' });
    expect(await done).toBe('abc');
    await q.obliterate({ force: true });
    await q.close();
    qc.disconnect();
    wc.disconnect();
  }, 30_000);
  it('senha errada é recusada mesmo com o certificado certo; CA errada ⇒ falha', async () => {
    await expect(ping(good(), url!.replace(/:\/\/[^@]*@/, '://default:errada@'))).rejects.toThrow();
    await expect(ping({ ...good(), REDIS_SSL_CA_PEM: file('client.crt') })).rejects.toThrow();
  });
  it('sem certificado de cliente o servidor corta a conexão', async () => {
    const e = good();
    const r = new IORedis(e.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 4000, retryStrategy: () => null, tls: { ca: e.REDIS_SSL_CA_PEM } });
    r.on('error', () => undefined);
    await expect(r.connect().then(() => r.ping())).rejects.toThrow();
    r.disconnect();
  });
});
