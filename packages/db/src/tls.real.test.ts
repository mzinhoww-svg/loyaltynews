// Conexão REAL com PostgreSQL por TLS + certificado de cliente (como a Vertra). Só roda com LN_TEST_REAL_TLS=1:
//   LN_TEST_CERTS_DIR (ca.crt, client.crt, client.pk8.key), LN_TEST_PG_URL (ex.: postgres://postgres:senha@127.0.0.1:55432/postgres).
// O servidor de teste exige `hostssl ... scram-sha-256 clientcert=verify-full`. Sem as variáveis, o arquivo é ignorado.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { pgPoolConfig } from './tls';

const dir = process.env.LN_TEST_CERTS_DIR;
const url = process.env.LN_TEST_PG_URL;
const real = process.env.LN_TEST_REAL_TLS === '1' && !!dir && !!url;
const file = (n: string) => readFileSync(join(dir!, n), 'utf8');
const oneLine = (pem: string) => pem.trimEnd().replace(/\n/g, '\n');
const base = () => ({ DATABASE_URL: `${url}?sslmode=disable`, NODE_ENV: 'production' }); // sslmode da URL é ignorado: manda o ssl do ambiente

async function query(env: Record<string, string | undefined>, sql: string) {
  const pool = new pg.Pool({ ...pgPoolConfig(env, { max: 1 }), connectionTimeoutMillis: 5000 });
  try {
    return (await pool.query(sql)).rows;
  } finally {
    await pool.end();
  }
}

describe.skipIf(!real)('PostgreSQL real com TLS e certificado de cliente', () => {
  const good = () => ({ ...base(), DB_SSL_CA_PEM: file('ca.crt'), DB_SSL_CERT_PEM: file('client.crt'), DB_SSL_KEY_PEM: file('client.pk8.key') });

  it('conecta com PEM multilinha: a sessão está em TLS e o servidor viu o certificado do cliente', async () => {
    const [r] = await query(good(), 'select ssl, client_dn, version() as v from pg_stat_ssl s join pg_stat_activity a using (pid) where pid = pg_backend_pid()');
    expect(r.ssl).toBe(true);
    expect(r.client_dn).toContain('CN=postgres');
    expect(r.v).toMatch(/PostgreSQL 18/);
  });

  it('conecta com os três PEM em UMA linha com \n escapado (como saem do painel de variáveis)', async () => {
    const e = good();
    const flat = { ...e, DB_SSL_CA_PEM: oneLine(e.DB_SSL_CA_PEM), DB_SSL_CERT_PEM: oneLine(e.DB_SSL_CERT_PEM), DB_SSL_KEY_PEM: oneLine(e.DB_SSL_KEY_PEM) };
    expect((await query(flat, 'select 1 as x'))[0].x).toBe(1);
  });

  it('os PEM cabem nas variáveis da Vertra (3072 caracteres cada)', () => {
    for (const n of ['ca.crt', 'client.crt', 'client.pk8.key']) expect(oneLine(file(n)).length).toBeLessThan(3072);
  });

  it('sem certificado de cliente a conexão é recusada (senha sozinha nunca conecta)', async () => {
    const e = good();
    // monta o ssl à mão, sem cert/key, para provar que o servidor realmente exige
    const pool = new pg.Pool({ connectionString: `${url}`, ssl: { ca: e.DB_SSL_CA_PEM, rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 5000 });
    await expect(pool.query('select 1')).rejects.toThrow();
    await pool.end().catch(() => undefined);
  });

  it('CA errada ⇒ o servidor não é confiável e a conexão falha (verify-full)', async () => {
    const e = { ...good(), DB_SSL_CA_PEM: file('client.crt') }; // um certificado qualquer que não é a CA do servidor
    await expect(query(e, 'select 1')).rejects.toThrow();
  });

  it('nome do servidor errado (host fora do certificado) ⇒ falha', async () => {
    const e = { ...good(), DATABASE_URL: url!.replace('127.0.0.1', '127.0.0.2') };
    await expect(query(e, 'select 1')).rejects.toThrow();
  });
});
