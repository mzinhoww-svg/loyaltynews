/**
 * Ponto de entrada da carga no PostgreSQL (staging). Roda sob o script de credenciais do PM (credenciais-sem-expor.md), que
 * põe no ambiente do processo filho: APP_ENV, DATABASE_URL, DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM.
 * Nada de segredo em argumento, arquivo, log ou chat; este script NUNCA imprime a URL nem os PEM e não gira senha.
 *
 * Compilar (na raiz do checkout do Intelligence):
 *   npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs
 * Rodar (dry-run é o padrão):
 *   node ln-com-credenciais.mjs staging -- node <checkout>/node_modules/.cache/ln-intelligence/load-seed.mjs --dataset <json> --verification <json>
 * Conferir o estado (só leitura, sem dataset):  … load-seed.mjs --check
 * Cargos públicos (intelligence-seed/2) só carregam com --with-persons (flag de pessoas, J-01); sem ela o plano recusa cada cargo com o motivo.
 * Aplicar (só APP_ENV=staging; produção é recusada):
 *   … load-seed.mjs --dataset <json> --verification <json> --apply --manifest <arquivo>
 * Conexão única (Client), não pool: a carga usa BEGIN/COMMIT.
 */
import pg from 'pg';
import { checkSeedState, runSeedCli } from '../src/seed-cli';
import type { Db } from '../src/db';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const REQUIRED = ['APP_ENV', 'DATABASE_URL', 'DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
const dataset = arg('dataset');
const verification = arg('verification');
const check = flag('check'); // só leitura: contagens e invariantes, sem dataset
if (missing.length || (!check && (!dataset || !verification))) {
  // só NOMES de variáveis, nunca valores
  console.error(`uso: <script de credenciais> -- load-seed --dataset <arquivo> --verification <arquivo> [--with-persons] [--apply --manifest <arquivo>]`);
  if (missing.length) console.error(`variáveis ausentes no ambiente: ${missing.join(', ')}`);
  process.exit(2);
}
const apply = flag('apply');
const withPersons = flag('with-persons'); // liga a ingestão de pessoas SÓ nesta execução (J-01: só com decisão registrada); padrão desligada
if (apply && process.env.APP_ENV !== 'staging') {
  console.error('--apply só é permitido com APP_ENV=staging (produção exige decisão e janela próprias).');
  process.exit(2);
}
for (const k of ['DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM'] as const) {
  if (!String(process.env[k]).includes('-----BEGIN ')) {
    console.error(`${k} não parece PEM`);
    process.exit(2);
  }
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: process.env.DB_SSL_CA_PEM, cert: process.env.DB_SSL_CERT_PEM, key: process.env.DB_SSL_KEY_PEM, rejectUnauthorized: true },
});
try {
  await client.connect();
  const db: Db = { query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }) } as Db;
  if (check) {
    console.log(JSON.stringify({ env: process.env.APP_ENV, mode: 'check', state: await checkSeedState(db) }, null, 2));
    process.exit(0);
  }
  const r = await runSeedCli(db, { datasetPath: dataset!, verificationPath: verification!, apply, manifestPath: arg('manifest'), withPersons });
  console.log(JSON.stringify({ env: process.env.APP_ENV, mode: r.mode, ok: r.plan.ok, issues: r.plan.issues, counts: r.plan.counts, records: r.plan.records, manifest: r.manifest }, null, 2));
  process.exitCode = r.plan.ok && r.plan.counts.rejected === 0 ? 0 : 1;
} catch (e) {
  // nunca ecoar a mensagem do driver (pode conter host/usuário): só o tipo e o código
  const err = e as { name?: string; code?: string; message?: string };
  console.error(`falha: ${err.name ?? 'Error'}${err.code ? ` (${err.code})` : ''}${err.message?.startsWith('schema_intelligence_ausente') ? ` — ${err.message}` : ''}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
