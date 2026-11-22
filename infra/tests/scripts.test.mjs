// Testes dos scripts de infra (node:test, sem dependências). Rodar: node --test infra/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { compareStats } from '../scripts/lib/pg.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(S, script), ...args], { encoding: 'utf8', ...opts });
const tmp = () => mkdtempSync(join(tmpdir(), 'ln-infra-test-'));
const put = (root, rel, txt) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt); };

test('ci-checks: árvore limpa passa', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x","dependencies":{"next":"1"}}');
  put(r, 'packages/db/migrations/001.sql', 'create extension if not exists pgcrypto;\ncreate extension "uuid-ossp";');
  put(r, 'infra/vertra/environments.json', '{}');
  assert.equal(node('ci-checks.mjs', ['--root', r]).status, 0);
  rmSync(r, { recursive: true, force: true });
});

test('ci-checks: reprova pilha proibida, extensão fora da lista e segredos', () => {
  const r = tmp();
  put(r, 'package.json', '{"dependencies":{"@supabase/supabase-js":"1"}}');
  put(r, 'packages/db/migrations/001.sql', 'CREATE EXTENSION vector;\nCREATE EXTENSION pgvector;');
  put(r, '.env', 'X=1');
  put(r, 'apps/x.txt', '-----BEGIN ' + 'PRIVATE KEY-----');
  put(r, 'apps/y.txt', 'postgres://user:' + 'senha123@host/db');
  const x = node('ci-checks.mjs', ['--root', r]);
  assert.equal(x.status, 1);
  for (const s of ['ADR-001: "supabase"', 'extensão "vector"', 'extensão "pgvector"', 'arquivo .env', 'chave privada', 'string de conexão']) assert.match(x.stderr, new RegExp(s));
  rmSync(r, { recursive: true, force: true });
});

test('ci-checks: .env.example é permitido e vercel só importa em dependências/IaC', () => {
  const r = tmp();
  put(r, '.env.example', 'DB_HOST=');
  put(r, 'docs/nota.md', 'não usar vercel nem supabase');
  assert.equal(node('ci-checks.mjs', ['--root', r]).status, 0);
  rmSync(r, { recursive: true, force: true });
});

test('ci-checks: lockfile só reprova pacote INSTALADO; peer opcional não conta', () => {
  const ok = tmp();
  put(ok, 'package-lock.json', JSON.stringify({ packages: { '': {}, 'node_modules/drizzle-orm': { peerDependencies: { '@vercel/postgres': '>=0.8.0' }, peerDependenciesMeta: { '@vercel/postgres': { optional: true } } } } }));
  assert.equal(node('ci-checks.mjs', ['--root', ok]).status, 0);
  rmSync(ok, { recursive: true, force: true });
  const bad = tmp();
  put(bad, 'package-lock.json', JSON.stringify({ packages: { '': {}, 'node_modules/@supabase/supabase-js': { version: '1.0.0' }, 'node_modules/foo/node_modules/@vercel/og': { version: '1.0.0' } } }));
  const x = node('ci-checks.mjs', ['--root', bad]);
  assert.equal(x.status, 1);
  assert.match(x.stderr, /pacote instalado "@supabase\/supabase-js"/);
  assert.match(x.stderr, /pacote instalado "@vercel\/og"/);
  rmSync(bad, { recursive: true, force: true });
});

test('compareStats detecta divergência, ausência e tabela inesperada', () => {
  const a = { 'public.a': { rows: 2, md5: 'aaaaaaaa11' }, 'public.b': { rows: 1, md5: 'bbbbbbbb22' } };
  assert.deepEqual(compareStats(a, a), []);
  const d = compareStats(a, { 'public.a': { rows: 3, md5: 'aaaaaaaa11' }, 'public.c': { rows: 0, md5: 'cccccccc33' } });
  assert.equal(d.length, 3);
});

function server(handler) {
  return new Promise((res) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => res(s)); });
}
// spawn ASSÍNCRONO: spawnSync bloquearia o servidor HTTP que roda neste mesmo processo.
const hc = (port, extra = []) => new Promise((res) => {
  const p = spawn(process.execPath, [join(S, 'healthcheck.mjs'), '--url', `http://127.0.0.1:${port}`, '--retries', '0', '--timeout', '800', ...extra]);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', (status) => res({ status, stdout: out }));
});

test('healthcheck: ok, 5xx, commit errado, corpo inválido e timeout', async () => {
  let mode = 'ok';
  const s = await server((req, res) => {
    if (mode === 'timeout') return; // nunca responde
    if (mode === '500') { res.writeHead(500); return res.end('{}'); }
    if (mode === 'html') { res.writeHead(200); return res.end('<html>'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/ready' ? { status: 'degraded', checks: { db: 'ok', redis: 'down' } } : { status: 'ok', version: 'abc123', env: 'staging', time: new Date().toISOString() }));
  });
  const port = s.address().port;
  try {
    assert.equal((await hc(port)).status, 0);
    assert.equal((await hc(port, ['--expect-commit', 'abc123'])).status, 0);
    assert.equal((await hc(port, ['--expect-commit', 'outro'])).status, 1);
    assert.equal((await hc(port, ['--ready'])).status, 0); // degraded é aceito no ready (alerta separado)
    mode = '500'; assert.equal((await hc(port)).status, 1);
    mode = 'html'; assert.equal((await hc(port)).status, 1);
    mode = 'timeout'; assert.equal((await hc(port)).status, 1);
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('migrate: recusa sem packages/db, sem script migrate e produção sem confirmação', () => {
  const r = tmp();
  const m = (args, env = {}) => spawnSync(process.execPath, [join(S, 'migrate.mjs'), ...args], { cwd: r, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(m(['--env', 'staging']).status, 2); // sem packages/db
  put(r, 'packages/db/package.json', '{"scripts":{}}');
  assert.match(m(['--env', 'staging']).stderr, /sem script "migrate"/);
  put(r, 'packages/db/package.json', '{"scripts":{"migrate":"echo ok"}}');
  const envs = Object.fromEntries(['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CA_PEM', 'CLIENT_CERT_PEM', 'CLIENT_KEY_PEM'].map((k) => [`DB_${k}`, 'x']));
  // ci-checks roda com o cwd do repo de teste: precisa existir o script
  mkdirSync(join(r, 'infra/scripts'), { recursive: true });
  for (const f of ['ci-checks.mjs', 'backup-freshness.mjs']) writeFileSync(join(r, 'infra/scripts', f), `import(${JSON.stringify('file:///' + join(S, f).replace(/\\/g, '/'))});`);
  const p = m(['--env', 'production'], envs);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /--confirm-production/);
  const q = m(['--env', 'production', '--confirm-production'], { ...envs, BACKUP_DEST: join(r, 'vazio') });
  assert.equal(q.status, 1);
  assert.match(q.stderr, /sem backup fresco/);
  const d = m(['--env', 'staging', '--dry-run'], envs);
  assert.equal(d.status, 0);
  rmSync(r, { recursive: true, force: true });
});
