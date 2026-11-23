#!/usr/bin/env node
// Aplica as migrações do banco (@ln/db, dono: Chief Architect) com barreiras de segurança.
// Uso (na raiz): node infra/scripts/migrate.mjs --env staging|production [--dry-run] [--confirm-production]
// Ambiente: APP_ENV, DATABASE_URL, DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM (convenção do scaffold, packages/db/src/migrate.ts);
//           produção também BACKUP_DEST (+ AWS_*).
// Barreiras (bloqueio do QA em ft-infra-ci-staging.md):
//   1. `--env` NÃO decide sozinho: APP_ENV tem de ser o mesmo ambiente, e o banco da DATABASE_URL tem de ser o registrado para ele em
//      infra/vertra/bindings.json (host e nome). Ambiente sem vínculo, ou URL de outro banco, é recusado.
//   2. guard-env: nada de variável só de teste/CI (LN_STUDIO_TEST_SESSION, CI=true, DB_SSL_MODE=disable, mock) e ci-checks --deploy.
//   3. Produção exige --confirm-production e um backup do MESMO banco, com manifesto e objeto cifrado ÍNTEGROS (hash conferido) e fresco.
//   4. Depois de migrar, verify-migrations compara o journal do repositório com as migrações aplicadas (nada de "verde sem migrar").
// Migração roda enquanto a versão antiga ainda serve (zero downtime): só mudanças compatíveis para trás (expandir -> migrar -> contrair).
import { parseArgs, fail, requireEnv, npm, run } from './lib/util.mjs';
import { userTablesPg } from './lib/pg.mjs';
import { assertBound, canonEnv } from './lib/binding.mjs';
import { envProblems } from './lib/guards.mjs';

const args = parseArgs(process.argv.slice(2));
const envName = canonEnv(args.env);
if (!envName) fail('use --env staging|production', 2);
requireEnv(['APP_ENV', 'DATABASE_URL', 'DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM']);
if (canonEnv(process.env.APP_ENV) !== envName) fail(`APP_ENV (${process.env.APP_ENV}) não corresponde a --env ${envName}: recusado`, 2);

const probs = envProblems(process.env, { deploy: true });
if (probs.length) fail(`ambiente reprovado: ${probs.join('; ')}`, 1);

let alvo;
try { alvo = assertBound({ env: envName, databaseUrl: process.env.DATABASE_URL, root: process.cwd() }); } catch (e) { fail(e.message, 2); }

if (run(process.execPath, ['infra/scripts/ci-checks.mjs', '--deploy']).status !== 0) fail('ci-checks reprovado: migração recusada');

if (envName === 'production') {
  if (!args['confirm-production']) fail('produção exige --confirm-production', 2);
  if (args['first-run-empty']) {
    // Primeira migração de um banco NOVO: não existe backup a exigir. Só vale se o banco não tem NENHUMA tabela de usuário (conferido agora, no banco do vínculo);
    // depois dela o banco deixa de ser vazio e as próximas migrações exigem backup fresco como sempre.
    let tabelas;
    try { tabelas = await userTablesPg(process.env); } catch (e) { fail(`--first-run-empty: não consegui ler o banco (${String(e.message).slice(0, 200)}); recusado`, 2); }
    if (tabelas.length) fail(`--first-run-empty recusado: o banco de produção já tem ${tabelas.length} tabela(s) (ex.: ${tabelas.slice(0, 3).join(', ')}); use o fluxo normal com backup fresco`, 2);
    console.log('first-run-empty: banco de produção sem tabelas de usuário; backup pré-migração dispensado só desta vez');
  } else {
    requireEnv(['BACKUP_DEST']);
    const f = run(process.execPath, ['infra/scripts/backup-freshness.mjs', '--env', 'production', '--verify-object']);
    if (f.status !== 0) fail('backup de produção inexistente, velho, de outro banco ou corrompido: migração recusada');
  }
}

if (args['dry-run']) { console.log(`dry-run: migraria ${alvo.host}/${alvo.database} (${envName}) com "npm run migrate -w @ln/db"`); process.exit(0); }

const code = npm(['run', 'migrate', '-w', '@ln/db']);
if (code !== 0) fail(`migração falhou (código ${code})`, code);
if (run(process.execPath, ['infra/scripts/verify-migrations.mjs']).status !== 0) fail('migrações aplicadas não conferem com o journal do repositório');
console.log(`migração OK e verificada em ${envName} (${alvo.host}/${alvo.database})`);
