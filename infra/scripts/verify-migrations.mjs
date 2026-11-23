#!/usr/bin/env node
// Prova que TODAS as migrações do repositório foram aplicadas no banco alvo (QA: impedir CI verde sem migrate).
// Compara o número de entradas de packages/db/drizzle/meta/_journal.json com as linhas de drizzle.__drizzle_migrations.
// Falha se o journal estiver ausente/vazio, se faltar migração aplicada ou se houver a mais. Usado pelo job `migrations` do CI
// (depois de `npm run migrate -w @ln/db`, SEM --if-present) e por migrate.mjs (staging/produção).
// Uso (na raiz): node infra/scripts/verify-migrations.mjs     Ambiente: DATABASE_URL (+ DB_SSL_*_PEM, ou DB_SSL_MODE=disable com CI=true)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function journalCount(root) {
  const p = join(root, 'packages/db/drizzle/meta/_journal.json');
  if (!existsSync(p)) throw new Error('packages/db/drizzle/meta/_journal.json ausente');
  const n = JSON.parse(readFileSync(p, 'utf8')).entries?.length ?? 0;
  if (n < 1) throw new Error('journal de migrações vazio');
  return n;
}

/** `query` recebe um SQL e devolve o número de linhas aplicadas. Separado para teste sem banco. */
export async function verify({ root, query }) {
  const expected = journalCount(root);
  const applied = await query('select count(*)::int as n from drizzle.__drizzle_migrations');
  return { expected, applied, ok: applied === expected };
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const root = process.cwd();
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL ausente');
    const pg = (await import('pg')).default;
    let ssl;
    if (process.env.DB_SSL_MODE === 'disable') {
      if (process.env.CI !== 'true') throw new Error('DB_SSL_MODE=disable só é permitido com CI=true');
      ssl = false;
    } else {
      const { DB_SSL_CA_PEM: ca, DB_SSL_CERT_PEM: cert, DB_SSL_KEY_PEM: key } = process.env;
      if (!ca || !cert || !key) throw new Error('TLS exige DB_SSL_CA_PEM, DB_SSL_CERT_PEM e DB_SSL_KEY_PEM');
      ssl = { ca, cert, key, rejectUnauthorized: true };
    }
    const pool = new pg.Pool({ connectionString: url, ssl, max: 1 });
    try {
      const r = await verify({ root, query: async (sql) => Number((await pool.query(sql)).rows[0].n) });
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
    } finally { await pool.end(); }
  } catch (e) {
    console.error(`verify-migrations REPROVADO: ${e.message}`);
    process.exit(1);
  }
}
