// CI=true em ambiente de deploy (decisão do PM 24/11/2026, opção A apertada, com os requisitos da Security): o runner do GitHub Actions (GITHUB_ACTIONS === 'true') constrói o .next de
// produção com CI=true; a exceção é DESLIGADA por padrão, só guard-env e build-web a pedem, nunca start-web, migrate nem ci-checks, e o que o CI destravaria (TLS desligado do banco e do
// Redis) continua reprovado em deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ciDoRunnerAceito, envProblems, LOG_CI_RUNNER } from '../scripts/lib/guards.mjs';
import { startProblems } from '../scripts/start-web.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const MSG_CI = /CI=true em ambiente de deploy/;
const juntar = (p) => p.join(' | ');
const amb = (extra) => ({ APP_ENV: 'production', ...extra });
const RUNNER = { permitirCiRunner: true };

test('(1) CI=true sem GITHUB_ACTIONS reprova em deploy (igual a antes), com ou sem o pedido da exceção, em produção e em staging', () => {
  for (const app of ['production', 'staging']) {
    for (const opt of [{ deploy: true }, { deploy: true, ...RUNNER }]) {
      assert.match(juntar(envProblems({ APP_ENV: app, CI: 'true' }, opt)), MSG_CI);
      assert.match(juntar(envProblems({ APP_ENV: app, CI: 'TRUE' }, opt)), MSG_CI);
    }
  }
  assert.match(juntar(envProblems({ CI: 'true' }, { deploy: true, ...RUNNER })), MSG_CI, 'sem APP_ENV, com --deploy');
});

test('(2) CI=true com GITHUB_ACTIONS=true passa em deploy SÓ quando a exceção é pedida; por padrão (start-web, migrate, ci-checks) continua reprovando', () => {
  const e = amb({ CI: 'true', GITHUB_ACTIONS: 'true' });
  assert.deepEqual(envProblems(e, { deploy: true, ...RUNNER }), []);
  assert.deepEqual(envProblems({ APP_ENV: 'staging', CI: 'true', GITHUB_ACTIONS: 'true' }, { deploy: true, ...RUNNER }), []);
  assert.match(juntar(envProblems(e, { deploy: true })), MSG_CI, 'padrão desligado');
  assert.equal(ciDoRunnerAceito(e, { permitir: true }), true);
  assert.equal(ciDoRunnerAceito(e), false);
});

test('(3) CI=true + GITHUB_ACTIONS=true + TLS desligado reprova (o perigo real que o CI destravaria): banco e Redis', () => {
  const db = envProblems(amb({ CI: 'true', GITHUB_ACTIONS: 'true', DB_SSL_MODE: 'disable' }), { deploy: true, ...RUNNER });
  assert.match(juntar(db), /DB_SSL_MODE=disable em ambiente de deploy/);
  assert.ok(!MSG_CI.test(juntar(db)), 'a mensagem do CI some (exceção), a do TLS fica');
  const redis = envProblems(amb({ CI: 'true', GITHUB_ACTIONS: 'true', REDIS_SSL_MODE: 'disable' }), { deploy: true, ...RUNNER });
  assert.match(juntar(redis), /REDIS_SSL_MODE=disable em ambiente de deploy/);
});

test('(4) start-web, guard-env e build-web na Vertra: CI=true sem GITHUB_ACTIONS continua reprovando', () => {
  const release = { siteUrl: 'https://loyaltynews.vertraweb.app', appEnv: 'production', commit: 'a'.repeat(40), vitrine: false, indexavel: false };
  const base = { APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: release.siteUrl, APP_COMMIT: release.commit };
  assert.deepEqual(startProblems(base, release), []);
  assert.match(juntar(startProblems({ ...base, CI: 'true' }, release)), MSG_CI);
  const guard = spawnSync(process.execPath, [join(S, 'guard-env.mjs')], { encoding: 'utf8', cwd: tmpdir(), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_ENV: 'production', CI: 'true' } });
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, MSG_CI);
  const src = readFileSync(join(S, 'build-web.mjs'), 'utf8');
  assert.ok(src.includes('envProblems(efetivo, { deploy: true, permitirCiRunner: true })'), 'o build-web pede a exceção; o ambiente efetivo é avaliado pelo mesmo envProblems');
  assert.ok(!/delete efetivo\.(CI|GITHUB_ACTIONS)\b/.test(src), 'o build-web não descarta CI/GITHUB_ACTIONS por conta própria');
});

test('(5) a trava da plataforma: com HOST=0.0.0.0 e PORT=80 (assinatura do app na Vertra) a exceção NÃO se aplica e GITHUB_ACTIONS definida reprova, com ou sem CI', () => {
  const vertra = { HOST: '0.0.0.0', PORT: '80' };
  const a = envProblems(amb({ CI: 'true', GITHUB_ACTIONS: 'true', ...vertra }), { deploy: true, ...RUNNER });
  assert.match(juntar(a), MSG_CI);
  assert.match(juntar(a), /GITHUB_ACTIONS definida em app da Vertra/);
  assert.match(juntar(envProblems(amb({ GITHUB_ACTIONS: 'true', ...vertra }), { deploy: true })), /GITHUB_ACTIONS definida em app da Vertra/);
  assert.equal(ciDoRunnerAceito(amb({ CI: 'true', GITHUB_ACTIONS: 'true', ...vertra }), { permitir: true }), false);
  // HOST/PORT que não são a assinatura (o runner não os define; um valor qualquer não aciona a trava)
  assert.deepEqual(envProblems(amb({ CI: 'true', GITHUB_ACTIONS: 'true', HOST: '127.0.0.1', PORT: '3000' }), { deploy: true, ...RUNNER }), []);
});

test('(6) REDIS_SSL_MODE=disable e DB_SSL_MODE=disable reprovam em deploy, com e sem CI; fora de deploy nada é cobrado', () => {
  for (const extra of [{}, { CI: 'true' }, { CI: 'true', GITHUB_ACTIONS: 'true' }]) {
    assert.match(juntar(envProblems(amb({ REDIS_SSL_MODE: 'disable', ...extra }), { deploy: true, ...RUNNER })), /REDIS_SSL_MODE=disable/);
    assert.match(juntar(envProblems(amb({ REDIS_SSL_MODE: 'Disable', ...extra }), { deploy: true })), /REDIS_SSL_MODE=disable/);
    assert.match(juntar(envProblems(amb({ DB_SSL_MODE: 'disable', ...extra }), { deploy: true, ...RUNNER })), /DB_SSL_MODE=disable/);
  }
  assert.deepEqual(envProblems({ CI: 'true', DB_SSL_MODE: 'disable', REDIS_SSL_MODE: 'disable' }, { deploy: false }), []);
});

test('(7) start-web reprova GITHUB_ACTIONS presente (nunca usa a exceção), mesmo com CI=true', () => {
  const release = { siteUrl: 'https://loyaltynews.vertraweb.app', appEnv: 'production', commit: 'a'.repeat(40), vitrine: false, indexavel: false };
  const base = { APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: release.siteUrl, APP_COMMIT: release.commit };
  assert.match(juntar(startProblems({ ...base, GITHUB_ACTIONS: 'true' }, release)), /GITHUB_ACTIONS definida em execução/);
  const ci = juntar(startProblems({ ...base, CI: 'true', GITHUB_ACTIONS: 'true' }, release));
  assert.match(ci, /GITHUB_ACTIONS definida em execução/);
  assert.match(ci, MSG_CI, 'e o CI=true também reprova no start (sem a exceção)');
  assert.match(juntar(startProblems({ ...base, GITHUB_ACTIONS: 'true', CI: 'true', DB_SSL_MODE: 'disable' }, release)), /DB_SSL_MODE=disable/);
});

test('(8) o processo da migração nunca usa a exceção: migracao:true com CI + GITHUB_ACTIONS reprova mesmo pedindo; migrate.mjs, ci-checks.mjs e start-web.mjs não pedem a exceção', () => {
  assert.match(juntar(envProblems(amb({ CI: 'true', GITHUB_ACTIONS: 'true' }), { deploy: true, migracao: true, ...RUNNER })), MSG_CI);
  assert.equal(ciDoRunnerAceito(amb({ CI: 'true', GITHUB_ACTIONS: 'true' }), { permitir: true, migracao: true }), false);
  for (const f of ['migrate.mjs', 'ci-checks.mjs', 'start-web.mjs']) assert.ok(!/permitirCiRunner/.test(readFileSync(join(S, f), 'utf8')), `${f} não pode pedir a exceção`);
});

test('(9) a comparação é EXATA: GITHUB_ACTIONS = 1, TRUE, True, " true", "true " e vazio não dão a exceção', () => {
  for (const v of ['1', 'TRUE', 'True', ' true', 'true ', '', 'false', 'yes']) {
    assert.match(juntar(envProblems(amb({ CI: 'true', GITHUB_ACTIONS: v }), { deploy: true, ...RUNNER })), MSG_CI, `GITHUB_ACTIONS=${JSON.stringify(v)}`);
  }
  assert.deepEqual(envProblems(amb({ GITHUB_ACTIONS: 'true' }), { deploy: true, ...RUNNER }), [], 'GITHUB_ACTIONS sozinho, sem CI e sem a assinatura da Vertra, não muda nada');
});

test('(10) guard-env no runner: passa e imprime a linha de log da exceção; na Vertra (HOST/PORT) reprova e não imprime; sem CI não imprime', () => {
  const rodar = (extra) => spawnSync(process.execPath, [join(S, 'guard-env.mjs')], { encoding: 'utf8', cwd: tmpdir(), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_ENV: 'production', ...extra } });
  const runner = rodar({ CI: 'true', GITHUB_ACTIONS: 'true' });
  assert.equal(runner.status, 0, runner.stderr);
  assert.ok(runner.stdout.includes(LOG_CI_RUNNER), runner.stdout);
  assert.equal(LOG_CI_RUNNER, 'CI=true aceito: runner do GitHub Actions');
  const naVertra = rodar({ CI: 'true', GITHUB_ACTIONS: 'true', HOST: '0.0.0.0', PORT: '80' });
  assert.equal(naVertra.status, 1);
  assert.ok(!naVertra.stdout.includes(LOG_CI_RUNNER));
  const semCi = rodar({});
  assert.equal(semCi.status, 0, semCi.stderr);
  assert.ok(!semCi.stdout.includes(LOG_CI_RUNNER));
  const tls = rodar({ CI: 'true', GITHUB_ACTIONS: 'true', DB_SSL_MODE: 'disable' });
  assert.equal(tls.status, 1);
  assert.match(tls.stderr, /DB_SSL_MODE=disable/);
});
