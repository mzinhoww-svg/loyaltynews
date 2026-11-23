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
  put(r, 'apps/x.txt', '-----BEGIN ' + 'PRIVATE KEY-----' + String.fromCharCode(10) + 'A'.repeat(120) + String.fromCharCode(10) + '-----END PRIVATE KEY-----');
  put(r, 'apps/fixture.test.ts', "const KEY = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';"); // fixture curta: não é chave
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

// --- variáveis só de teste (alerta do PM, 22/11/2026) ---
const cleanEnv = () => { const e = { ...process.env }; for (const k of ['LN_STUDIO_TEST_SESSION', 'PORTAL_SOURCE', 'PORTAL_MODE', 'APP_ENV']) delete e[k]; return e; };

test('guard-env: reprova LN_STUDIO_TEST_SESSION (qualquer valor) e mock em deploy; aceita ambiente limpo', () => {
  const g = (env, args = []) => spawnSync(process.execPath, [join(S, 'guard-env.mjs'), ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...env } });
  assert.equal(g({}).status, 0);
  assert.equal(g({ APP_ENV: 'staging' }).status, 0);
  assert.equal(g({ LN_STUDIO_TEST_SESSION: '1' }).status, 1);
  assert.equal(g({ LN_STUDIO_TEST_SESSION: '0', APP_ENV: 'production' }).status, 1, 'definida com qualquer valor reprova');
  assert.equal(g({ LN_STUDIO_TEST_SESSION: '' }).status, 0, 'vazia equivale a não definida');
  assert.equal(g({ APP_ENV: 'staging', PORTAL_MODE: 'mock' }).status, 1);
  assert.equal(g({ APP_ENV: 'production', PORTAL_SOURCE: 'MOCK' }).status, 1);
  assert.equal(g({ PORTAL_SOURCE: 'mock' }).status, 0, 'em dev/teste o mock é permitido');
  assert.equal(g({ PORTAL_SOURCE: 'mock' }, ['--deploy']).status, 1, '--deploy força o modo estrito');
  assert.equal(g({ APP_ENV: 'staging', PORTAL_SOURCE: 'empty' }).status, 0);
  assert.equal(g({ APP_ENV: 'staging', PORTAL_SOURCE: 'intelligence' }).status, 1, 'staging: PORTAL_SOURCE vazio, nem mock nem intelligence');
  assert.equal(g({ APP_ENV: 'production', PORTAL_MODE: 'qualquer' }).status, 1, 'só vazio ou empty é aceito em deploy');
  assert.equal(g({ APP_ENV: 'staging', DIAG_XFF: '1' }).status, 0, 'o diagnóstico de proxies é permitido no staging');
  assert.equal(g({ APP_ENV: 'production', DIAG_XFF: '1' }).status, 1, 'e proibido em produção');
  assert.equal(g({ APP_ENV: 'homologacao', PORTAL_MODE: 'mock' }).status, 1, 'vocabulário do scaffold também é estrito');
  assert.equal(g({ APP_ENV: 'producao', LN_STUDIO_TEST_SESSION: '1' }).status, 1);
  assert.equal(g({ APP_ENV: 'staging', DB_SSL_MODE: 'disable' }).status, 1, 'DB_SSL_MODE=disable é só do CI');
  assert.equal(g({ APP_ENV: 'production', CI: 'true' }).status, 1, 'CI=true libera disable: proibido em deploy');
  assert.equal(g({ CI: 'true', DB_SSL_MODE: 'disable' }).status, 0, 'no CI (sem APP_ENV de deploy) é permitido');
  assert.equal(g({ CI: 'true', DB_SSL_MODE: 'disable' }, ['--deploy']).status, 1);
});

test('ci-checks: ambiente com LN_STUDIO_TEST_SESSION reprova mesmo em árvore limpa', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  const x = node('ci-checks.mjs', ['--root', r], { env: { ...cleanEnv(), LN_STUDIO_TEST_SESSION: '1' } });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /LN_STUDIO_TEST_SESSION está definida/);
  assert.equal(node('ci-checks.mjs', ['--root', r], { env: cleanEnv() }).status, 0);
  rmSync(r, { recursive: true, force: true });
});

test('ci-checks: atribuição em deploy/IaC/scripts de produção reprova; citar o nome ou usar em script de teste não', () => {
  const r = tmp();
  put(r, 'infra/vertra/env-contract.json', '{"proibidas":[{"nome":"LN_STUDIO_TEST_SESSION","regra":"nunca"}]}'); // só cita
  put(r, 'apps/web/package.json', JSON.stringify({ scripts: { e2e: 'LN_STUDIO_TEST_SESSION=1 playwright test', 'test:portal': 'PORTAL_MODE=mock vitest' } }));
  assert.equal(node('ci-checks.mjs', ['--root', r], { env: cleanEnv() }).status, 0);
  rmSync(r, { recursive: true, force: true });
  const bad = tmp();
  put(bad, 'apps/web/package.json', JSON.stringify({ scripts: { start: 'LN_STUDIO_TEST_SESSION=1 next start', build: 'PORTAL_SOURCE=mock next build' } }));
  put(bad, 'infra/vertra/environments.json', '{"env":{"LN_STUDIO_TEST_SESSION":"1"}}');
  put(bad, '.github/workflows/deploy.yml', 'env:\n  PORTAL_MODE: mock\n  LN_STUDIO_TEST_SESSION: 1\n');
  put(bad, 'apps/web/next.config.ts', 'export default { env: { LN_STUDIO_TEST_SESSION: process.env.LN_STUDIO_TEST_SESSION } };');
  const x = node('ci-checks.mjs', ['--root', bad], { env: cleanEnv() });
  assert.equal(x.status, 1);
  for (const s of ['script "start"', 'script "build"', 'LN_STUDIO_TEST_SESSION atribuída em infra/vertra/environments.json', 'deploy.yml', 'next.config injeta']) assert.match(x.stderr, new RegExp(s));
  rmSync(bad, { recursive: true, force: true });
});

test('ci-checks: next.config que só LÊ a variável para recusar o build passa; injetar via env reprova', () => {
  const ok = tmp();
  put(ok, 'apps/web/next.config.ts', "if (process.env.LN_STUDIO_TEST_SESSION) { throw new Error('recusado'); } export default {};");
  assert.equal(node('ci-checks.mjs', ['--root', ok], { env: cleanEnv() }).status, 0);
  rmSync(ok, { recursive: true, force: true });
});

test('healthcheck --denied e --no-mock: prova de runtime de que a sessão simulada e o MOCK estão desligados', async () => {
  let studio = 302; let home = '<h1>Loyalty News</h1>';
  const s = await server((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.url === '/studio') { res.writeHead(studio, studio === 302 ? { location: '/studio/entrar' } : {}); return res.end('painel do studio'); }
    if (req.url === '/') { res.writeHead(200); return res.end(home); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  try {
    assert.equal((await hc(port, ['--denied', '/studio', '--no-mock', '/'])).status, 0);
    studio = 200; // sessão simulada ativa: /studio abre sem login
    const a = await hc(port, ['--denied', '/studio']);
    assert.equal(a.status, 1);
    assert.match(a.stdout, /sessão simulada pode estar ativa/);
    studio = 401; assert.equal((await hc(port, ['--denied', '/studio'])).status, 0);
    home = '<div class="faixa">MOCK</div>'; // fixtures ativas
    const b = await hc(port, ['--no-mock', '/']);
    assert.equal(b.status, 1);
    assert.match(b.stdout, /contém \\"MOCK\\"/);
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('healthcheck --noindex: reprova staging indexável; aprova robots fechado + sitemap vazio + noindex (meta ou cabeçalho)', async () => {
  let mode = 'aberto';
  const s = await server((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.url === '/robots.txt') { res.writeHead(200); return res.end(mode === 'aberto' ? 'User-Agent: *\nAllow: /\nSitemap: http://x/sitemap.xml\n' : 'User-Agent: *\nDisallow: /\n'); }
    if (req.url === '/sitemap.xml') { res.writeHead(200); return res.end(mode === 'aberto' ? '<urlset><url><loc>http://x/</loc></url></urlset>' : '<urlset></urlset>'); }
    if (req.url === '/') {
      res.writeHead(200, mode === 'header' ? { 'x-robots-tag': 'noindex, nofollow' } : {});
      return res.end(mode === 'meta' ? '<html><head><meta name="robots" content="noindex, nofollow"></head></html>' : '<html><head></head></html>');
    }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  try {
    let r = await hc(port, ['--noindex', '/']); assert.equal(r.status, 1); assert.match(r.stdout, /seria indexável|publica URLs/); // robots Allow + sitemap com URL + sem noindex
    mode = 'semNoindex'; r = await hc(port, ['--noindex', '/']); assert.equal(r.status, 1); assert.match(r.stdout, /sem noindex/);
    mode = 'meta'; assert.equal((await hc(port, ['--noindex', '/'])).status, 0);
    mode = 'header'; assert.equal((await hc(port, ['--noindex', '/'])).status, 0);
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('build-web: checkHome aprova canonical do ambiente + noindex e reprova localhost, outra URL e falta de noindex', async () => {
  const { checkHome } = await import('../scripts/build-web.mjs');
  const url = 'https://loyaltynews-stg.vertraweb.app';
  const ok = `<html><head><link rel="canonical" href="${url}"/><meta name="robots" content="noindex, nofollow, nocache"/></head></html>`;
  assert.deepEqual(checkHome(ok, url, 'staging'), []);
  assert.deepEqual(checkHome(`<link href="${url}/x" rel="canonical"/><meta content="noindex" name="robots"/>`, url, 'staging'), [], 'ordem dos atributos não importa');
  assert.match(checkHome(ok.replace(url, 'http://localhost:3000'), url, 'staging').join('|'), /canonical da home é "http:\/\/localhost:3000"/);
  assert.match(checkHome(ok.replace(url, 'https://loyaltynews-staging.vertraweb.app'), url, 'staging').join('|'), /esperado começar com/);
  assert.match(checkHome(`<link rel="canonical" href="${url}"/>`, url, 'staging').join('|'), /sem meta robots noindex/);
  assert.deepEqual(checkHome(`<link rel="canonical" href="${url}"/>`, url, 'production'), [], 'em produção não exige noindex');
  assert.match(checkHome('<html></html>', url, 'staging').join('|'), /sem link canonical/);
});

test('healthcheck --canonical: reprova localhost e URL errada, aprova a URL do ambiente', async () => {
  let canon = 'http://localhost:3000';
  const s = await server((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.url === '/') { res.writeHead(200); return res.end(`<html><head><link rel="canonical" href="${canon}"/></head></html>`); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  try {
    const want = 'https://loyaltynews-stg.vertraweb.app';
    let r = await hc(port, ['--canonical', want]); assert.equal(r.status, 1); assert.match(r.stdout, /NEXT_PUBLIC_SITE_URL não entrou no build/);
    canon = 'https://outro.vertraweb.app'; assert.equal((await hc(port, ['--canonical', want])).status, 1);
    canon = want; assert.equal((await hc(port, ['--canonical', want])).status, 0);
    canon = `${want}/`; assert.equal((await hc(port, ['--canonical', `${want}/`])).status, 0);
  } finally { s.closeAllConnections?.(); s.close(); }
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

test('verify-migrations: journal vs aplicadas (CI não pode ficar verde sem migrar)', async () => {
  const { journalCount, verify } = await import('../scripts/verify-migrations.mjs');
  const r = tmp();
  assert.throws(() => journalCount(r), /ausente/);
  put(r, 'packages/db/drizzle/meta/_journal.json', JSON.stringify({ entries: [] }));
  assert.throws(() => journalCount(r), /vazio/);
  put(r, 'packages/db/drizzle/meta/_journal.json', JSON.stringify({ entries: [{ idx: 0 }, { idx: 1 }, { idx: 2 }] }));
  assert.equal(journalCount(r), 3);
  assert.deepEqual(await verify({ root: r, query: async () => 3 }), { expected: 3, applied: 3, ok: true });
  assert.equal((await verify({ root: r, query: async () => 0 })).ok, false, 'nenhuma migração aplicada (migrate pulado) reprova');
  assert.equal((await verify({ root: r, query: async () => 2 })).ok, false, 'faltou migração');
  assert.equal((await verify({ root: r, query: async () => 4 })).ok, false, 'migração a mais');
  rmSync(r, { recursive: true, force: true });
});

test('ci.yml: migrations sem --if-present, com verify-migrations e travado por LN_ACTIONS_ENABLED', async () => {
  const { readFileSync } = await import('node:fs');
  const y = readFileSync(join(S, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(y, /npm run migrate -w @ln\/db\s*$/m);
  assert.doesNotMatch(y, /run:.*--if-present/);
  assert.match(y, /verify-migrations\.mjs/);
  assert.equal((y.match(/vars\.LN_ACTIONS_ENABLED == 'true'/g) || []).length, 2, 'os dois jobs precisam da trava');
  const b = readFileSync(join(S, '..', '..', '.github', 'workflows', 'backup.yml'), 'utf8');
  assert.match(b, /vars\.LN_ACTIONS_ENABLED == 'true'/);
});
