/**
 * Medição da ADR-009 (p95 <= 300 ms com 100 mil arestas) no PostgreSQL REAL do staging, em schema isolado e descartável (ver src/bench-pg.ts).
 * Roda sob o script de credenciais do PM, que põe no ambiente do processo filho: APP_ENV, DATABASE_URL, DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM.
 * Nunca imprime URL, usuário, senha ou PEM; só o relatório (tempos, contagens, versão e planos de dados sintéticos) ou o tipo/código do erro.
 *
 * Compilar (na raiz do checkout do Intelligence):
 *   npx esbuild packages/intelligence/scripts/bench-pg.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/bench-pg.mjs
 * Rodar (fumaça primeiro; depois a medição completa):
 *   node ln-com-credenciais.mjs staging -- node <checkout>/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration <checkout>/packages/db/drizzle/0006_intelligence.sql --scale 0.02
 *   node ln-com-credenciais.mjs staging -- node <checkout>/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration <checkout>/packages/db/drizzle/0006_intelligence.sql --out <arquivo.json>
 * Opções: --schema ln_bench_AAAAMMDD[_sufixo] (padrão: hoje), --scale 0..1 (padrão 1 = ~100 mil arestas), --replace (só apaga schema com a marca deste script).
 * Só APP_ENV=staging. Conexão única (Client).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { runPgBench, type BenchClient, type BenchHandle } from '../src/bench-pg';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);

const REQUIRED = ['APP_ENV', 'DATABASE_URL', 'DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
const migrationPath = arg('migration');
if (missing.length || !migrationPath) {
  console.error('uso: <script de credenciais> -- bench-pg --migration <0006_intelligence.sql> [--schema ln_bench_AAAAMMDD] [--scale 0.02] [--replace] [--out arquivo.json]');
  if (missing.length) console.error(`variáveis ausentes no ambiente: ${missing.join(', ')}`); // só NOMES
  process.exit(2);
}
if (process.env.APP_ENV !== 'staging') {
  console.error('a medição só roda com APP_ENV=staging (produção é recusada).');
  process.exit(2);
}
for (const k of ['DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM'] as const) {
  if (!String(process.env[k]).includes('-----BEGIN ')) { console.error(`${k} não parece PEM`); process.exit(2); }
}
const scale = arg('scale') === undefined ? 1 : Number(arg('scale'));
const out = arg('out');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: process.env.DB_SSL_CA_PEM, cert: process.env.DB_SSL_CERT_PEM, key: process.env.DB_SSL_KEY_PEM, rejectUnauthorized: true },
});
let handle: BenchHandle | undefined;
let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.error(`sinal ${signal}: apagando o schema de teste antes de sair`);
  (handle ? handle.abort() : Promise.resolve()).catch(() => undefined).finally(() => client.end().catch(() => undefined).finally(() => process.exit(130)));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

try {
  await client.connect();
  const bc: BenchClient = { query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }) };
  const r = await runPgBench(
    bc,
    { migrationSql: readFileSync(migrationPath, 'utf8'), schema: arg('schema'), scale, replace: flag('replace'), log: (l) => console.error(`[bench] ${l}`) },
    (h) => { handle = h; },
  );
  const json = JSON.stringify({ env: process.env.APP_ENV, ...r }, null, 2);
  if (out) writeFileSync(out, json + '\n');
  console.log(json);
  process.exitCode = r.schema_dropped ? 0 : 1; // schema que sobrou = falha visível
} catch (e) {
  // nunca ecoar a mensagem do driver (pode conter host/usuário): só o tipo e o código; mensagens do próprio script começam por "bench_"
  const err = e as { name?: string; code?: string; message?: string };
  const own = typeof err.message === 'string' && err.message.startsWith('bench_') ? ` — ${err.message}` : '';
  const perm = err.code === '42501' ? ' — sem permissão para criar schema no banco: peça ao DevOps (não há como contornar)' : '';
  console.error(`falha: ${err.name ?? 'Error'}${err.code ? ` (${err.code})` : ''}${own}${perm}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
