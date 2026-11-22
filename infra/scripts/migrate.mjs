#!/usr/bin/env node
// Aplica migrações do banco (packages/db, dono: Chief Architect) com barreiras de segurança.
// Uso: node infra/scripts/migrate.mjs --env staging|production [--dry-run] [--confirm-production]
// Contrato: packages/db/package.json precisa ter o script `migrate`. Ambiente: DB_* (ver infra/vertra/env-contract.json).
// Barreiras: (1) ci-checks (extensões trusted); (2) em produção exige --confirm-production E backup fresco (<= 375 min).
//            Migração roda enquanto a versão antiga ainda serve (doc Vertra, zero downtime): só mudanças compatíveis para trás
//            (expandir -> migrar dados -> contrair em deploys separados).
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, fail, requireEnv, npm, run } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const envName = args.env;
if (!['staging', 'production'].includes(envName)) fail('use --env staging|production', 2);
if (!existsSync('packages/db/package.json')) fail('packages/db ausente: o esquema/migrações são da frente 02 (Chief Architect)', 2);
const pkg = JSON.parse(readFileSync('packages/db/package.json', 'utf8'));
if (!pkg.scripts?.migrate) fail('packages/db/package.json sem script "migrate" (pedido registrado ao Chief Architect)', 2);
requireEnv(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_CA_PEM', 'DB_CLIENT_CERT_PEM', 'DB_CLIENT_KEY_PEM']);

if (run(process.execPath, ['infra/scripts/ci-checks.mjs']).status !== 0) fail('ci-checks reprovado: migração recusada');

if (envName === 'production') {
  if (!args['confirm-production']) fail('produção exige --confirm-production', 2);
  requireEnv(['BACKUP_DEST']);
  const f = run(process.execPath, ['infra/scripts/backup-freshness.mjs', '--env', 'production']);
  if (f.status !== 0) fail('sem backup fresco de produção: migração recusada');
}
if (args['dry-run']) { console.log(`dry-run: rodaria "npm run migrate -w packages/db" em ${envName}`); process.exit(0); }
const code = npm(['run', 'migrate', '-w', 'packages/db'], { env: { APP_ENV: envName } });
if (code !== 0) fail(`migração falhou (código ${code})`, code);
console.log(`migração OK em ${envName}`);
