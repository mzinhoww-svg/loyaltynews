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

/** Valida a dispensa de backup externo (DP-23): referencia DP-23, data AAAA-MM-DD ainda nao vencida e a no maximo 60 dias. Devolve o motivo da recusa ou ''. Pura (testada). */
export function waiverProblem(ate, ref, agora, snapshotEm) {
  if (String(ref ?? '') !== 'DP-23') return 'LN_BACKUP_WAIVER_REF deve ser DP-23 (decisao do proprietario)';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate)) return 'LN_BACKUP_WAIVER_UNTIL deve ser AAAA-MM-DD';
  const fim = new Date(`${ate}T23:59:59Z`);
  if (Number.isNaN(fim.getTime())) return 'LN_BACKUP_WAIVER_UNTIL invalida';
  if (fim.getTime() < agora.getTime()) return `a dispensa venceu em ${ate}`;
  if (fim.getTime() - agora.getTime() > 60 * 24 * 3600 * 1000) return 'prazo maior que 60 dias: renove por periodos curtos';
  // B2 (Security, decisao 13): antes de migrar sob dispensa, a Vertra tem de ter um backup (snapshot) do banco de producao com MENOS de 24 h, conferido por leitura (list_snapshots) e informado aqui.
  const snap = new Date(String(snapshotEm ?? ''));
  if (!snapshotEm || Number.isNaN(snap.getTime())) return 'LN_BACKUP_VERTRA_SNAPSHOT_AT deve ser o instante (ISO 8601) do snapshot mais recente da Vertra para este banco (list_snapshots)';
  if (snap.getTime() > agora.getTime() + 5 * 60 * 1000) return 'LN_BACKUP_VERTRA_SNAPSHOT_AT esta no futuro';
  if (agora.getTime() - snap.getTime() > 24 * 3600 * 1000) return 'o snapshot da Vertra tem mais de 24 h: tire um novo antes de migrar (create_snapshot) e informe o instante';
  return '';
}
const envName = canonEnv(args.env);
if (!envName) fail('use --env staging|production', 2);
requireEnv(['APP_ENV', 'DATABASE_URL', 'DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM']);
if (canonEnv(process.env.APP_ENV) !== envName) fail(`APP_ENV (${process.env.APP_ENV}) não corresponde a --env ${envName}: recusado`, 2);

const probs = envProblems(process.env, { deploy: true, migracao: true });
if (probs.length) fail(`ambiente reprovado: ${probs.join('; ')}`, 1);

let alvo;
try { alvo = assertBound({ env: envName, databaseUrl: process.env.DATABASE_URL, root: process.cwd() }); } catch (e) { fail(e.message, 2); }

if (run(process.execPath, ['infra/scripts/ci-checks.mjs', '--deploy', '--migracao']).status !== 0) fail('ci-checks reprovado: migração recusada');

if (envName === 'production') {
  if (!args['confirm-production']) fail('produção exige --confirm-production', 2);
  if (args['first-run-empty']) {
    // Primeira migração de um banco NOVO: não existe backup a exigir. Só vale se o banco não tem NENHUMA tabela de usuário (conferido agora, no banco do vínculo);
    // depois dela o banco deixa de ser vazio e as próximas migrações exigem backup fresco como sempre.
    let tabelas;
    try { tabelas = await userTablesPg(process.env); } catch (e) { fail(`--first-run-empty: não consegui ler o banco (${String(e.message).slice(0, 200)}); recusado`, 2); }
    if (tabelas.length) fail(`--first-run-empty recusado: o banco de produção já tem ${tabelas.length} tabela(s) (ex.: ${tabelas.slice(0, 3).join(', ')}); use o fluxo normal com backup fresco`, 2);
    console.log('first-run-empty: banco de produção sem tabelas de usuário; backup pré-migração dispensado só desta vez');
  } else if (args['waive-external-backup']) {
    // DP-23 (proprietario): ate o lancamento a producao roda so com o backup diario da Vertra; o backup externo (ADR-012) fica para depois. A dispensa e EXPLICITA, com prazo
    // (LN_BACKUP_WAIVER_UNTIL=AAAA-MM-DD, no maximo 60 dias a frente) e referencia (LN_BACKUP_WAIVER_REF=DP-23); sem isso, ou vencida, a migracao recusa como antes.
    const ate = String(process.env.LN_BACKUP_WAIVER_UNTIL ?? '');
    const prazo = waiverProblem(ate, process.env.LN_BACKUP_WAIVER_REF, new Date(), process.env.LN_BACKUP_VERTRA_SNAPSHOT_AT);
    if (prazo) fail(`--waive-external-backup recusado: ${prazo}`, 2);
    console.warn(`ATENCAO (DP-23): migracao de producao SEM backup externo fresco (dispensa ate ${ate}); vale o backup diario da Vertra. Risco aceito pelo proprietario; registrar no status.`);
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
