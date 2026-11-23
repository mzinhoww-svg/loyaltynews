/**
 * Ponto de entrada da carga no PostgreSQL (staging). Compile e rode (ver STAGING_LOAD_PLAN.md):
 *   npx esbuild packages/intelligence/scripts/load-seed.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/load-seed.mjs
 *   DATABASE_URL=… node node_modules/.cache/ln-intelligence/load-seed.mjs --dataset … --verification …                 (dry-run, padrão)
 *   DATABASE_URL=… node node_modules/.cache/ln-intelligence/load-seed.mjs --dataset … --verification … --apply --manifest <arquivo>
 * DATABASE_URL vem do ambiente e NUNCA é impresso. Conexão única (Client), não pool: a carga usa BEGIN/COMMIT.
 */
import pg from 'pg';
import { runSeedCli } from '../src/seed-cli';
import type { Db } from '../src/db';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = process.env.DATABASE_URL;
const dataset = arg('dataset');
const verification = arg('verification');
if (!url || !dataset || !verification) {
  console.error('uso: DATABASE_URL=… load-seed --dataset <arquivo> --verification <arquivo> [--apply --manifest <arquivo>]');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const db: Db = { query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }) } as Db;
  const r = await runSeedCli(db, { datasetPath: dataset, verificationPath: verification, apply: flag('apply'), manifestPath: arg('manifest') });
  console.log(JSON.stringify({ mode: r.mode, ok: r.plan.ok, issues: r.plan.issues, counts: r.plan.counts, records: r.plan.records, manifest: r.manifest }, null, 2));
  process.exitCode = r.plan.ok && r.plan.counts.rejected === 0 ? 0 : 1;
} finally {
  await client.end();
}
