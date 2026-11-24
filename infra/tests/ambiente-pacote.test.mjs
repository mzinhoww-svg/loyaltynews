import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ambienteDoPacote, VARIAVEIS_DO_SISTEMA } from '../scripts/lib/ambiente-pacote.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

test('ambienteDoPacote: só variáveis do sistema + o declarado + APP_ENV; o que o runner define não passa', () => {
  const base = { PATH: '/bin', HOME: '/h', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1', DB_SSL_MODE: 'disable', LN_STUDIO_TEST_SESSION: 'x', LN_FLAGS_ON: 'a', PORTAL_SOURCE: 'mock' };
  const e = ambienteDoPacote({ declarado: { NODE_ENV: 'production', APP_MODE: 'nodb', ignorado: { x: 1 } }, appEnv: 'staging', base });
  assert.deepEqual(e, { PATH: '/bin', HOME: '/h', NODE_ENV: 'production', APP_MODE: 'nodb', APP_ENV: 'staging' });
  assert.ok(VARIAVEIS_DO_SISTEMA.includes('PATH'));
  assert.equal(ambienteDoPacote({ base: {} }).APP_ENV, undefined);
});

function raizMinima() {
  const d = mkdtempSync(join(tmpdir(), 'ln-ambpkg-'));
  mkdirSync(join(d, 'infra/vertra'), { recursive: true });
  writeFileSync(join(d, 'package.json'), '{"name":"x","version":"0.0.0"}\n');
  return d;
}
const ciChecks = (raiz, env) => spawnSync(process.execPath, [join(S, 'ci-checks.mjs'), '--root', raiz, '--deploy'], { encoding: 'utf8', env });

test('ci-checks --deploy: o CI=true do processo reprova (a regra de runtime está intacta) e o ambiente saneado do pacote passa', () => {
  const d = raizMinima();
  try {
    const semRunner = { ...process.env, CI: 'true', APP_ENV: 'production' }; delete semRunner.GITHUB_ACTIONS; // o runner do GitHub é a única isenção (guards-ci.test.mjs)
    const comCi = ciChecks(d, semRunner);
    assert.equal(comCi.status, 1);
    assert.match(comCi.stderr + comCi.stdout, /CI=true em ambiente de deploy/);
    const saneado = ciChecks(d, ambienteDoPacote({ declarado: { NODE_ENV: 'production' }, appEnv: 'production', base: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' } }));
    assert.equal(saneado.status, 0, saneado.stderr + saneado.stdout);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('ci-checks --deploy: um pacote que DECLARA CI=true (ou DB_SSL_MODE=disable) continua reprovando mesmo com o ambiente saneado', () => {
  const d = raizMinima();
  try {
    const decl = ciChecks(d, ambienteDoPacote({ declarado: { NODE_ENV: 'production', CI: 'true' }, appEnv: 'production', base: process.env }));
    assert.equal(decl.status, 1);
    assert.match(decl.stderr + decl.stdout, /CI=true em ambiente de deploy/);
    const ssl = ciChecks(d, ambienteDoPacote({ declarado: { DB_SSL_MODE: 'disable' }, appEnv: 'staging', base: process.env }));
    assert.equal(ssl.status, 1);
    assert.match(ssl.stderr + ssl.stdout, /DB_SSL_MODE=disable/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('package-web: com CI=true no processo de empacotamento (como no runner) o pacote SAI, e release.json e vertracloud.config não declaram CI', () => {
  const out = mkdtempSync(join(tmpdir(), 'ln-pkgci-'));
  try {
    const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', out, '--profile', 'production', '--subdomain', 'loyaltynews'], { encoding: 'utf8', env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' }, cwd: join(S, '..', '..') });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.ok(existsSync(j.zip));
    const pasta = j.pasta;
    const release = JSON.parse(readFileSync(join(pasta, 'release.json'), 'utf8'));
    assert.ok(!JSON.stringify(release).includes('"CI"'), 'release.json declara CI');
    for (const f of ['vertracloud.config', 'package.json']) {
      const p = join(pasta, f);
      if (existsSync(p)) assert.ok(!/(^|[\s"'])CI\s*[=:]\s*["']?true/m.test(readFileSync(p, 'utf8')), `${f} declara CI=true`);
    }
    const man = JSON.parse(readFileSync(j.manifesto, 'utf8'));
    assert.ok(!JSON.stringify(man.ferramentas ?? {}).includes('CI=true'));
    assert.ok(!(man.variaveis ?? man.envParaDefinir ?? []).some?.((v) => v.nome === 'CI'));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
