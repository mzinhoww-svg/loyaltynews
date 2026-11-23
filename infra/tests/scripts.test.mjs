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
  // DP-24: produção nasce NÃO indexável (exige noindex) e só dispensa o noindex com o pacote indexável (go-live)
  assert.match(checkHome(`<link rel="canonical" href="${url}"/>`, url, 'production').join('|'), /produção sem meta robots noindex/);
  assert.deepEqual(checkHome(`<link rel="canonical" href="${url}"/><meta name="robots" content="noindex"/>`, url, 'production'), []);
  assert.deepEqual(checkHome(`<link rel="canonical" href="${url}"/>`, url, 'production', false, true), [], 'pacote indexável de produção não exige noindex');
  assert.match(checkHome('<html></html>', url, 'staging').join('|'), /sem link canonical/);
});

test('healthcheck --canonical: confere a home (estática) E /noticias (dinâmica); reprova localhost e URL errada', async () => {
  let home = 'http://localhost:3000';
  let dinamica = 'http://localhost:3000/noticias';
  const s = await server((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.url === '/') { res.writeHead(200); return res.end(`<html><head><link rel="canonical" href="${home}"/></head></html>`); }
    if (req.url === '/noticias') { res.writeHead(200); return res.end(`<html><head><link rel="canonical" href="${dinamica}"/></head></html>`); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  try {
    const want = 'https://loyaltynews-stg.vertraweb.app';
    let r = await hc(port, ['--canonical', want]); assert.equal(r.status, 1); assert.match(r.stdout, /NEXT_PUBLIC_SITE_URL precisa existir no build E no ambiente de execução/);
    home = 'https://outro.vertraweb.app'; dinamica = `${want}/noticias`; assert.equal((await hc(port, ['--canonical', want])).status, 1, 'home com URL errada');
    // o caso do incidente de 22/11: a home (estática, gravada no build) está certa, a página dinâmica lê a variável em execução e sai localhost
    home = want; dinamica = 'http://localhost:3000/noticias';
    r = await hc(port, ['--canonical', want]); assert.equal(r.status, 1); assert.match(r.stdout, /\/noticias: canonical/);
    dinamica = `${want}/noticias`; assert.equal((await hc(port, ['--canonical', want])).status, 0);
    home = `${want}/`; assert.equal((await hc(port, ['--canonical', `${want}/`])).status, 0);
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

test('start-web: startProblems aprova o ambiente do release.json e reprova APP_COMMIT corrompido, URL ausente/localhost/barra, APP_ENV trocado e variáveis de teste', async () => {
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'aa0fa89cfbf3c33db3603fd4b42ff4729e036a7c';
  const rel = { commit: sha, siteUrl: 'https://loyaltynews-stg.vertraweb.app', appEnv: 'staging' };
  const env = { APP_ENV: 'staging', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl, APP_MODE: 'nodb' };
  assert.deepEqual(startProblems(env, rel), []);
  assert.match(startProblems({ ...env, APP_COMMIT: `460e59662459303d${sha}3230dda8` }, rel).join('|'), /APP_COMMIT não é um SHA de 40/);
  assert.match(startProblems({ ...env, APP_COMMIT: 'b'.repeat(40) }, rel).join('|'), /APP_COMMIT=b+ difere do release\.json/);
  assert.match(startProblems({ ...env, APP_COMMIT: undefined }, rel).join('|'), /APP_COMMIT não é um SHA/);
  assert.match(startProblems({ ...env, NEXT_PUBLIC_SITE_URL: '' }, rel).join('|'), /NEXT_PUBLIC_SITE_URL ausente em execução/);
  assert.match(startProblems({ ...env, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }, rel).join('|'), /difere do release\.json/);
  assert.match(startProblems({ ...env, NEXT_PUBLIC_SITE_URL: `${rel.siteUrl}/` }, rel).join('|'), /difere do release\.json/);
  assert.match(startProblems({ ...env, APP_ENV: 'production' }, rel).join('|'), /APP_ENV="production" difere/);
  assert.match(startProblems({ ...env, LN_STUDIO_TEST_SESSION: '1' }, rel).join('|'), /LN_STUDIO_TEST_SESSION/);
  assert.match(startProblems({ ...env, PORTAL_SOURCE: 'mock' }, rel).join('|'), /PORTAL_SOURCE=mock/);
  assert.match(startProblems(env, { commit: sha }).join('|'), /release\.json sem commit\/siteUrl\/appEnv/);
});

test('start-web: sem release.json recusa (código 2); com ambiente errado recusa (código 1) e não imprime segredos', () => {
  const dir = tmp();
  try {
    let r = spawnSync(process.execPath, [join(S, 'start-web.mjs')], { cwd: dir, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.status, 2);
    put(dir, 'release.json', JSON.stringify({ commit: 'a'.repeat(40), siteUrl: 'https://x.vertraweb.app', appEnv: 'staging' }));
    r = spawnSync(process.execPath, [join(S, 'start-web.mjs')], { cwd: dir, encoding: 'utf8', env: { ...process.env, APP_ENV: 'staging', APP_COMMIT: 'curto', NEXT_PUBLIC_SITE_URL: 'https://x.vertraweb.app', BETTER_AUTH_SECRET: 'segredo-que-nao-pode-vazar-0123456789' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AMBIENTE DE EXECUÇÃO REPROVADO/);
    assert.doesNotMatch(r.stdout + r.stderr, /segredo-que-nao-pode-vazar/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('arquivos-orfaos: acha as sobras de upload antigo na árvore do app (JSON aninhado, lista plana e texto) e ignora node_modules/.next', async () => {
  const { arquivosDaArvore, orfaos } = await import('../scripts/arquivos-orfaos.mjs');
  const pacote = ['package.json', 'apps/web/app/page.tsx', 'apps/web/lib/studio/session.ts', 'release.json'];
  const aninhada = { name: '', type: 'directory', children: [
    { name: 'package.json', type: 'file' }, { name: 'release.json', type: 'file' },
    { name: 'node_modules', type: 'directory', children: [{ name: 'x', type: 'file' }] },
    { name: 'apps', type: 'directory', children: [{ name: 'web', type: 'directory', children: [
      { name: '.next', type: 'directory', children: [{ name: 'BUILD_ID', type: 'file' }] },
      { name: 'app', type: 'directory', children: [{ name: 'page.tsx', type: 'file' }, { name: 'velho.tsx', type: 'file' }] },
      { name: 'lib', type: 'directory', children: [{ name: 'studio', type: 'directory', children: [{ name: 'session.ts', type: 'file' }, { name: 'test-seam.prod.ts', type: 'file' }] }] },
    ] }] },
  ] };
  const esperado = ['apps/web/app/velho.tsx', 'apps/web/lib/studio/test-seam.prod.ts'];
  assert.deepEqual(orfaos(arquivosDaArvore(aninhada), pacote), esperado);
  const plana = { files: ['package.json', 'apps/web/app/page.tsx', 'apps/web/app/velho.tsx', 'apps/web/lib/studio/test-seam.prod.ts', 'node_modules/y/index.js', 'apps/web/.next/BUILD_ID'] };
  assert.deepEqual(orfaos(arquivosDaArvore(plana), pacote), esperado);
  assert.deepEqual(orfaos(arquivosDaArvore(JSON.stringify(['./package.json', '/apps/web/app/velho.tsx'])), pacote), ['apps/web/app/velho.tsx']);
  assert.deepEqual(orfaos(arquivosDaArvore('package.json\napps/web/app/velho.tsx\napps/\n'), pacote), ['apps/web/app/velho.tsx']);
  assert.deepEqual(orfaos(arquivosDaArvore(aninhada), [...pacote, ...esperado]), [], 'sem sobras quando o pacote cobre tudo');
});

test('arquivos-orfaos: aceita JSON com BOM UTF-8 e arquivo em UTF-16 (saída do PowerShell 5.1)', async () => {
  const { arquivosDaArvore, orfaos, readTexto } = await import('../scripts/arquivos-orfaos.mjs');
  const dir = tmp();
  try {
    const json = JSON.stringify({ files: ['package.json', 'apps/web/velho.tsx'] });
    assert.deepEqual(orfaos(arquivosDaArvore('﻿' + json), ['package.json']), ['apps/web/velho.tsx']);
    writeFileSync(join(dir, 'bom.json'), '﻿' + json);
    assert.deepEqual(orfaos(arquivosDaArvore(readTexto(join(dir, 'bom.json'))), ['package.json']), ['apps/web/velho.tsx']);
    writeFileSync(join(dir, 'u16.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]));
    assert.deepEqual(orfaos(arquivosDaArvore(readTexto(join(dir, 'u16.json'))), ['package.json']), ['apps/web/velho.tsx']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('arquivos-orfaos: ignora next-env.d.ts (gerado pelo Next)', async () => {
  const { orfaos } = await import('../scripts/arquivos-orfaos.mjs');
  assert.deepEqual(orfaos(['package.json', 'apps/web/next-env.d.ts', 'apps/web/velho.ts'], ['package.json']), ['apps/web/velho.ts']);
});

// ---------- Vitrine do staging (Security 23/11/2026, R1-R3 e R8) ----------
test('vitrine R1/R2: guard aceita só PORTAL_VITRINE=1 com APP_ENV=staging; production/producao/homologacao e outros valores reprovam; PORTAL_SOURCE=mock segue proibido', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const p = (env) => envProblems(env, { deploy: true }).join('|');
  assert.equal(p({ APP_ENV: 'staging', PORTAL_VITRINE: '1' }), '');
  assert.equal(p({ APP_ENV: 'staging' }), '', 'sem vitrine passa');
  assert.equal(p({ APP_ENV: 'staging', PORTAL_VITRINE: '' }), '', 'vazia = ausente');
  for (const e of ['production', 'producao', 'homologacao', '', 'dev']) assert.match(p({ APP_ENV: e, PORTAL_VITRINE: '1' }), /vitrine de demonstração só existe no staging/, e || '(vazio)');
  for (const v of ['0', 'true', 'yes', '2', 'on']) assert.match(p({ APP_ENV: 'staging', PORTAL_VITRINE: v }), /só o valor 1 é aceito/, v);
  assert.match(p({ APP_ENV: 'production', PORTAL_VITRINE: '0' }), /só o valor 1/);
  assert.match(p({ APP_ENV: 'staging', PORTAL_SOURCE: 'mock', PORTAL_VITRINE: '1' }), /PORTAL_SOURCE=mock em ambiente de deploy/, 'a vitrine não reabilita PORTAL_SOURCE=mock');
  assert.match(p({ APP_ENV: 'staging', PORTAL_MODE: 'mock', PORTAL_VITRINE: '1' }), /PORTAL_MODE=mock/);
  assert.equal(envProblems({ PORTAL_VITRINE: '1' }, { deploy: false }).length, 0, 'fora de deploy (dev local) não bloqueia');
});

test('vitrine: guard-env recusa (código 1) em production e aceita em staging', () => {
  const run = (env) => node('guard-env.mjs', [], { env: { ...cleanEnv(), ...env } });
  assert.equal(run({ APP_ENV: 'staging', PORTAL_VITRINE: '1' }).status, 0);
  const x = run({ APP_ENV: 'production', PORTAL_VITRINE: '1' });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /guard-env REPROVADO/);
});

test('vitrine R5/R8: checkHome exige a faixa COM vitrine e proíbe qualquer marcador SEM vitrine', async () => {
  const { checkHome } = await import('../scripts/build-web.mjs');
  const url = 'https://x.vertraweb.app';
  const base = `<link rel="canonical" href="${url}"/><meta name="robots" content="noindex"/>`;
  const faixa = '<div>Conteúdo de demonstração — não publicado</div>';
  assert.deepEqual(checkHome(base + faixa, url, 'staging', true), []);
  assert.match(checkHome(base, url, 'staging', true).join('|'), /não tem a faixa/);
  assert.deepEqual(checkHome(base, url, 'staging', false), []);
  assert.deepEqual(checkHome(base, url, 'staging'), [], 'padrão = sem vitrine');
  for (const m of ['Conteúdo de demonstração', 'MOCK · dados de exemplo', '[MOCK] Matéria de teste']) assert.match(checkHome(base + m, url, 'staging', false).join('|'), /contém marcador/, m);
  assert.match(checkHome(base + faixa, url, 'production', false).join('|'), /contém marcador/, 'produção nunca com marcador');
});

test('vitrine R3: startProblems exige PORTAL_VITRINE igual ao release.json (1 com vitrine; ausente sem)', async () => {
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'a'.repeat(40);
  const rel = { commit: sha, siteUrl: 'https://x.vertraweb.app', appEnv: 'staging' };
  const env = { APP_ENV: 'staging', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl };
  assert.deepEqual(startProblems(env, rel), [], 'release sem campo vitrine = sem vitrine');
  assert.deepEqual(startProblems(env, { ...rel, vitrine: false }), []);
  assert.match(startProblems({ ...env, PORTAL_VITRINE: '1' }, { ...rel, vitrine: false }).join('|'), /pacote NÃO é de vitrine/);
  assert.deepEqual(startProblems({ ...env, PORTAL_VITRINE: '1' }, { ...rel, vitrine: true }), []);
  assert.match(startProblems(env, { ...rel, vitrine: true }).join('|'), /PORTAL_VITRINE ausente em execução/);
  assert.match(startProblems({ ...env, PORTAL_VITRINE: '0' }, { ...rel, vitrine: true }).join('|'), /só o valor 1/);
  assert.match(startProblems({ ...env, APP_ENV: 'production', PORTAL_VITRINE: '1' }, { ...rel, appEnv: 'production', vitrine: true }).join('|'), /só existe no staging/);
});

test('vitrine R3: package-web recusa --vitrine com perfil production (antes de tocar no repositório)', () => {
  const x = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', join(tmp(), 'nada'), '--profile', 'production', '--vitrine']);
  assert.equal(x.status, 2);
  assert.match(x.stderr, /vitrine recusado/);
});

test('vitrine R8: ci-checks reprova PORTAL_VITRINE atribuída na produção (environments.json) e em workflows/Dockerfile/next.config; citar, ler e staging passam', () => {
  const ok = tmp();
  put(ok, 'infra/vertra/environments.json', JSON.stringify({ ambientes: { staging: { recursos: { web: { env: { PORTAL_VITRINE: '1' } } } }, production: { recursos: { web: { env: { APP_ENV: 'production' } } } } }, regras: 'PORTAL_VITRINE=1 só no staging' }));
  put(ok, 'infra/vertra/env-contract.json', '{"regra":"PORTAL_VITRINE=1 só no staging; nunca em produção"}');
  put(ok, 'apps/web/next.config.ts', "// vitrine (PORTAL_VITRINE=1 com APP_ENV=staging)\nconst portalDemo = process.env.PORTAL_VITRINE === '1' && process.env.APP_ENV === 'staging' ? '1' : '0';\nexport default { env: { NEXT_PUBLIC_PORTAL_DEMO: portalDemo } };");
  put(ok, '.github/workflows/ci.yml', '# a vitrine (PORTAL_VITRINE=1) não entra aqui\nname: ci\n');
  put(ok, 'apps/web/package.json', JSON.stringify({ scripts: { 'verify:no-mock': 'node scripts/verify-no-mock.mjs', 'test:portal': 'PORTAL_VITRINE=1 vitest' } }));
  assert.equal(node('ci-checks.mjs', ['--root', ok], { env: cleanEnv() }).status, 0, node('ci-checks.mjs', ['--root', ok], { env: cleanEnv() }).stderr);
  rmSync(ok, { recursive: true, force: true });
  const bad = tmp();
  put(bad, 'infra/vertra/environments.json', JSON.stringify({ ambientes: { production: { recursos: { web: { env: { PORTAL_VITRINE: '1' } } } } } }));
  put(bad, '.github/workflows/deploy.yml', 'env:\n  PORTAL_VITRINE: 1\n');
  put(bad, 'Dockerfile', 'ENV PORTAL_VITRINE=1\n');
  put(bad, 'apps/web/package.json', JSON.stringify({ scripts: { start: 'PORTAL_VITRINE=1 next start' } }));
  const x = node('ci-checks.mjs', ['--root', bad], { env: cleanEnv() });
  assert.equal(x.status, 1);
  for (const s of ['configuração de produção de infra/vertra/environments.json', 'deploy.yml', 'Dockerfile', 'script "start"']) assert.match(x.stderr, new RegExp(s));
  rmSync(bad, { recursive: true, force: true });
  const env = tmp();
  put(env, 'package.json', '{"name":"x"}');
  const e = node('ci-checks.mjs', ['--root', env, '--deploy'], { env: { ...cleanEnv(), APP_ENV: 'production', PORTAL_VITRINE: '1' } });
  assert.equal(e.status, 1);
  assert.match(e.stderr, /vitrine de demonstração só existe no staging/);
  rmSync(env, { recursive: true, force: true });
});

test('vitrine R8: healthcheck --no-mock reprova marcadores da vitrine (produção); --vitrine exige a faixa (staging com vitrine)', async () => {
  let home = '<h1>Loyalty News</h1>';
  const s = await server((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.url === '/') { res.writeHead(200); return res.end(home); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  try {
    assert.equal((await hc(port, ['--no-mock', '/'])).status, 0, 'home limpa');
    const v = await hc(port, ['--vitrine', '/']);
    assert.equal(v.status, 1);
    assert.match(v.stdout, /sem a faixa/);
    home = '<div>Conteúdo de demonstração — não publicado</div>';
    const a = await hc(port, ['--no-mock', '/']);
    assert.equal(a.status, 1);
    assert.match(a.stdout, /marcador\(es\) da vitrine/);
    assert.equal((await hc(port, ['--vitrine', '/'])).status, 0);
    home = '<span>MOCK · dados de exemplo</span>';
    assert.equal((await hc(port, ['--no-mock', '/'])).status, 1);
  } finally { s.closeAllConnections?.(); s.close(); }
});

// ---------- Provisionamento completo (staging com banco e produção) ----------
test('guard: PORTAL_SOURCE=api é aceito em deploy (dados reais); mock, intelligence e outros seguem reprovados; PORTAL_MODE só vazio/empty', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const p = (env) => envProblems({ APP_ENV: 'production', ...env }, { deploy: true }).join('|');
  assert.equal(p({ PORTAL_SOURCE: 'api' }), '');
  assert.equal(p({ PORTAL_SOURCE: 'empty' }), '');
  assert.equal(p({}), '');
  for (const v of ['mock', 'intelligence', 'real', 'apis']) assert.match(p({ PORTAL_SOURCE: v }), /PORTAL_SOURCE=.* deve ficar vazio ou api/, v);
  assert.match(p({ PORTAL_MODE: 'api' }), /PORTAL_MODE=api/);
  assert.match(p({ PORTAL_MODE: 'mock' }), /PORTAL_MODE=mock/);
});

test('pg: parseUserTables lê a saída do psql (vazio = banco novo; uma linha por tabela)', async () => {
  const { parseUserTables } = await import('../scripts/lib/pg.mjs');
  assert.deepEqual(parseUserTables([]), []);
  assert.deepEqual(parseUserTables(undefined), []);
  assert.deepEqual(parseUserTables([{ t: 'public.users' }, { t: ' public.articles ' }, { t: '' }]), ['public.users', 'public.articles']);
  const { pgClientConfig } = await import('../scripts/lib/pg.mjs');
  assert.throws(() => pgClientConfig({}), /variáveis ausentes: DATABASE_URL/);
  const cfg = pgClientConfig({ DATABASE_URL: 'postgres://u:p@h:1/d', DB_SSL_CA_PEM: 'a', DB_SSL_CERT_PEM: 'b', DB_SSL_KEY_PEM: 'c' });
  assert.equal(cfg.ssl.rejectUnauthorized, true);
  assert.deepEqual([cfg.ssl.ca, cfg.ssl.cert, cfg.ssl.key], ['a', 'b', 'c']);
});

test('package-web: --app só aceita web ou workers; --vitrine não vale para workers', () => {
  const dir = join(tmp(), 'nada');
  const a = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--app', 'banco']);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /--app deve ser web ou workers/);
  const b = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--app', 'workers', '--vitrine']);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /--vitrine só vale para o web/);
});

test('migrate: produção exige --confirm-production e vínculo; --first-run-empty não contorna o vínculo nem o ambiente', () => {
  const base = { ...cleanEnv(), APP_ENV: 'production', DATABASE_URL: 'postgres://u:p@abc.db.usa1.vertraweb.app:1/vertracloud', DB_SSL_CA_PEM: 'x', DB_SSL_CERT_PEM: 'x', DB_SSL_KEY_PEM: 'x' };
  const sem = node('migrate.mjs', ['--env', 'production', '--first-run-empty'], { env: base });
  assert.notEqual(sem.status, 0);
  assert.match(sem.stderr, /sem vínculo|NÃO corresponde|bindings/, 'o vínculo com bindings.json vem antes de qualquer outra coisa');
  const errado = node('migrate.mjs', ['--env', 'production', '--first-run-empty'], { env: { ...base, APP_ENV: 'staging' } });
  assert.notEqual(errado.status, 0);
  assert.match(errado.stderr, /não corresponde a --env production/);
});

test('check-conexoes: redisTlsFromEnv exige rediss://, as 3 variáveis PEM e devolve o servername; sem env recusa', async () => {
  const { redisTlsFromEnv } = await import('../scripts/check-conexoes.mjs');
  const pem = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n';
  const env = { REDIS_URL: 'rediss://vertracloud:senha@abc.db.usa1.vertraweb.app:12345', REDIS_SSL_CA_PEM: pem, REDIS_SSL_CERT_PEM: pem, REDIS_SSL_KEY_PEM: pem };
  const ok = redisTlsFromEnv(env);
  assert.equal(ok.host, 'abc.db.usa1.vertraweb.app');
  assert.equal(ok.tls.servername, 'abc.db.usa1.vertraweb.app');
  assert.equal(ok.tls.rejectUnauthorized, true);
  assert.throws(() => redisTlsFromEnv({ ...env, REDIS_URL: 'redis://x:y@h:1' }), /rediss/);
  assert.throws(() => redisTlsFromEnv({ ...env, REDIS_SSL_KEY_PEM: undefined }), /ausentes: REDIS_SSL_KEY_PEM/);
  assert.throws(() => redisTlsFromEnv({ ...env, REDIS_SSL_CA_PEM: 'texto' }), /não parece PEM/);
});

test('check-conexoes: sem --env recusa (código 2) e sem vínculo em bindings.json o postgres falha fechado sem imprimir segredo', () => {
  assert.equal(node('check-conexoes.mjs', []).status, 2);
  const x = node('check-conexoes.mjs', ['--env', 'staging', '--pg'], { env: { ...cleanEnv(), DATABASE_URL: 'postgres://vertracloud:SEGREDO123@abc.db.usa1.vertraweb.app:1/vertracloud', DB_SSL_CA_PEM: 'x', DB_SSL_CERT_PEM: 'x', DB_SSL_KEY_PEM: 'x' } });
  assert.equal(x.status, 1);
  assert.match(x.stdout, /postgres FALHOU/);
  assert.doesNotMatch(x.stdout + x.stderr, /SEGREDO123/);
});

// ---------- Decisão 12 do Security: PORTAL_SOURCE=api (A1-A4; casos 1-5) ----------
test('decisao 12 caso 1: staging e producao com PORTAL_SOURCE=api passam no guard (build e start via envProblems)', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  for (const appEnv of ['staging', 'production']) assert.deepEqual(envProblems({ APP_ENV: appEnv, PORTAL_SOURCE: 'api' }, { deploy: true }), [], appEnv);
  const run = (env) => node('guard-env.mjs', ['--deploy'], { env: { ...cleanEnv(), ...env } });
  assert.equal(run({ APP_ENV: 'production', PORTAL_SOURCE: 'api' }).status, 0);
  assert.equal(run({ APP_ENV: 'staging', PORTAL_SOURCE: 'api' }).status, 0);
});

test('decisao 12 caso 2 (A2): só a grafia exata api; API e " api " são reprovados', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  for (const v of ['API', ' api ', 'Api', 'api ']) assert.match(envProblems({ APP_ENV: 'staging', PORTAL_SOURCE: v }, { deploy: true }).join('|'), /exatamente api/, JSON.stringify(v));
  assert.equal(node('guard-env.mjs', ['--deploy'], { env: { ...cleanEnv(), APP_ENV: 'production', PORTAL_SOURCE: 'API' } }).status, 1);
});

test('decisao 12 caso 3 (A3): PORTAL_VITRINE junto com PORTAL_SOURCE=api é reprovado em staging; vitrine sozinha segue válida', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  assert.match(envProblems({ APP_ENV: 'staging', PORTAL_SOURCE: 'api', PORTAL_VITRINE: '1' }, { deploy: true }).join('|'), /uma fonte por pacote/);
  assert.deepEqual(envProblems({ APP_ENV: 'staging', PORTAL_VITRINE: '1' }, { deploy: true }), []);
  assert.deepEqual(envProblems({ APP_ENV: 'staging', PORTAL_SOURCE: 'empty', PORTAL_VITRINE: '1' }, { deploy: true }), []);
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'a'.repeat(40);
  const rel = { commit: sha, siteUrl: 'https://x.vertraweb.app', appEnv: 'staging', vitrine: true };
  assert.match(startProblems({ APP_ENV: 'staging', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl, PORTAL_VITRINE: '1', PORTAL_SOURCE: 'api' }, rel).join('|'), /uma fonte por pacote/);
});

test('decisao 12 caso 4 (A4): PORTAL_API_BASE_URL em deploy só ausente ou loopback http', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const p = (v) => envProblems({ APP_ENV: 'production', PORTAL_SOURCE: 'api', ...(v === undefined ? {} : { PORTAL_API_BASE_URL: v }) }, { deploy: true }).join('|');
  assert.equal(p(undefined), '');
  assert.equal(p(''), '');
  assert.equal(p('http://127.0.0.1:3000'), '');
  assert.equal(p('http://localhost'), '');
  for (const v of ['https://exemplo.invalid', 'http://exemplo.invalid', 'https://127.0.0.1', 'http://10.0.0.5:80', 'http://127.0.0.1.evil.test', 'nao-e-url']) assert.match(p(v), /PORTAL_API_BASE_URL/, v);
});

test('decisao 12 caso 5: mock e intelligence continuam reprovados (regressão), com ou sem api no meio', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  for (const v of ['mock', 'intelligence', 'MOCK']) assert.match(envProblems({ APP_ENV: 'production', PORTAL_SOURCE: v }, { deploy: true }).join('|'), /PORTAL_SOURCE=.* deve ficar vazio ou api/, v);
  assert.match(envProblems({ APP_ENV: 'staging', PORTAL_MODE: 'mock' }, { deploy: true }).join('|'), /PORTAL_MODE=mock/);
});

// ---------- DP-24: produção NÃO indexável até o go-live; DP-23: dispensa de backup externo com prazo ----------
test('DP-24: PORTAL_INDEXAVEL=1 só com APP_ENV=production; qualquer outro valor ou ambiente reprova; ausente é o padrão (não indexável)', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const p = (env) => envProblems(env, { deploy: true }).join('|');
  assert.equal(p({ APP_ENV: 'production' }), '');
  assert.equal(p({ APP_ENV: 'production', PORTAL_INDEXAVEL: '1' }), '');
  assert.equal(p({ APP_ENV: 'producao', PORTAL_INDEXAVEL: '1' }), '');
  assert.match(p({ APP_ENV: 'staging', PORTAL_INDEXAVEL: '1' }), /so a producao pode ser indexavel/);
  assert.match(p({ APP_ENV: 'production', PORTAL_INDEXAVEL: '0' }), /so o valor 1/);
  assert.match(p({ APP_ENV: 'production', PORTAL_INDEXAVEL: 'true' }), /so o valor 1/);
  assert.match(p({ PORTAL_INDEXAVEL: '1' }), /so a producao pode ser indexavel/);
});

test('DP-24: start-web exige PORTAL_INDEXAVEL igual ao release.json (1 só com pacote indexável; ausente nos demais)', async () => {
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'b'.repeat(40);
  const rel = { commit: sha, siteUrl: 'https://x.vertraweb.app', appEnv: 'production' };
  const env = { APP_ENV: 'production', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl };
  assert.deepEqual(startProblems(env, rel), [], 'padrão: não indexável');
  assert.match(startProblems({ ...env, PORTAL_INDEXAVEL: '1' }, rel).join('|'), /pacote NÃO é indexável/);
  assert.deepEqual(startProblems({ ...env, PORTAL_INDEXAVEL: '1' }, { ...rel, indexavel: true }), []);
  assert.match(startProblems(env, { ...rel, indexavel: true }).join('|'), /PORTAL_INDEXAVEL ausente em execução/);
});

test('DP-24: package-web --indexavel só para o web de production (não staging, não worker, não vitrine)', () => {
  const dir = join(tmp(), 'nada');
  for (const extra of [['--profile', 'staging'], ['--profile', 'staging-min'], ['--profile', 'production', '--app', 'workers']]) {
    const x = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--indexavel', ...extra]);
    assert.equal(x.status, 2, extra.join(' '));
    assert.match(x.stderr, /--indexavel so vale para o web do perfil production/);
  }
  const v = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--profile', 'production', '--indexavel', '--vitrine']);
  assert.equal(v.status, 2);
});

test('DP-23: waiverProblem aceita só DP-23, data futura de até 60 dias; recusa referência errada, data inválida, vencida ou longa demais', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(S, 'migrate.mjs'), 'utf8');
  assert.match(src, /export function waiverProblem/);
  // a função é pura, mas migrate.mjs executa ao ser importado; extrai e avalia só a função
  const corpo = src.slice(src.indexOf('export function waiverProblem'), src.indexOf('\n}\n', src.indexOf('export function waiverProblem')) + 3).replace('export ', '');
  const waiverProblem = new Function(corpo + '; return waiverProblem;')();
  const hoje = new Date('2026-11-23T12:00:00Z');
  const snap = '2026-11-23T06:00:00Z'; // 6 h antes de 'hoje'
  assert.equal(waiverProblem('2026-12-20', 'DP-23', hoje, snap), '');
  assert.match(waiverProblem('2026-12-20', 'DP-23', hoje), /SNAPSHOT_AT/, 'sem snapshot recusa (B2)');
  assert.match(waiverProblem('2026-12-20', 'DP-23', hoje, '2026-11-22T06:00:00Z'), /mais de 24 h/);
  assert.match(waiverProblem('2026-12-20', 'DP-23', hoje, '2026-11-24T06:00:00Z'), /futuro/);
  assert.match(waiverProblem('2026-12-20', 'DP-23', hoje, 'ontem'), /SNAPSHOT_AT/);
  assert.match(waiverProblem('2026-12-20', 'outro', hoje, snap), /DP-23/);
  assert.match(waiverProblem('20/12/2026', 'DP-23', hoje, snap), /AAAA-MM-DD/);
  assert.match(waiverProblem('2026-11-20', 'DP-23', hoje, snap), /venceu/);
  assert.match(waiverProblem('2027-06-01', 'DP-23', hoje, snap), /60 dias/);
  assert.match(waiverProblem('', 'DP-23', hoje, snap), /AAAA-MM-DD/);
});

test('DP-23: migrate de produção com --waive-external-backup sem referência/prazo recusa (código 2) e sem a flag exige o backup', () => {
  const base = { ...cleanEnv(), APP_ENV: 'production', DATABASE_URL: 'postgres://u:p@abc.db.usa1.vertraweb.app:1/vertracloud', DB_SSL_CA_PEM: 'x', DB_SSL_CERT_PEM: 'x', DB_SSL_KEY_PEM: 'x' };
  const x = node('migrate.mjs', ['--env', 'production', '--confirm-production', '--waive-external-backup'], { env: base });
  assert.notEqual(x.status, 0);
  assert.doesNotMatch(x.stdout + x.stderr, /ATENCAO \(DP-23\)/, 'sem vínculo a migração nem chega à dispensa');
});

test('B1 (decisão 13): as variáveis da dispensa de backup reprovam em app/build/CI e só passam no processo da migração; atribuição em config reprova no ci-checks', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const env = { APP_ENV: 'production', LN_BACKUP_WAIVER_REF: 'DP-23', LN_BACKUP_WAIVER_UNTIL: '2026-12-20', LN_BACKUP_VERTRA_SNAPSHOT_AT: '2026-11-23T06:00:00Z' };
  assert.equal(envProblems(env, { deploy: true }).filter((m) => /DP-23/.test(m)).length, 3);
  assert.equal(envProblems(env, { deploy: true, migracao: true }).filter((m) => /DP-23/.test(m)).length, 0);
  assert.equal(node('guard-env.mjs', [], { env: { ...cleanEnv(), ...env } }).status, 1);
  const bad = tmp();
  put(bad, '.github/workflows/migrar.yml', 'env:\n  LN_BACKUP_WAIVER_REF: DP-23\n');
  const x = node('ci-checks.mjs', ['--root', bad], { env: cleanEnv() });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /dispensa de backup \(DP-23\) atribuída em .*migrar\.yml/);
  rmSync(bad, { recursive: true, force: true });
  const ok = tmp();
  put(ok, 'docs/nota.md', 'A dispensa usa LN_BACKUP_WAIVER_REF=DP-23 so no processo da migracao.');
  assert.equal(node('ci-checks.mjs', ['--root', ok], { env: cleanEnv() }).status, 0, 'citar o nome em texto não reprova');
  rmSync(ok, { recursive: true, force: true });
});

test('I4 (decisão 13): PORTAL_INDEXAVEL com espaço (" 1", "1 ") reprova; só "1" exato em production; start-web também compara exato', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  for (const v of [' 1', '1 ', ' 1 ', '01']) assert.match(envProblems({ APP_ENV: 'production', PORTAL_INDEXAVEL: v }, { deploy: true }).join('|'), /so o valor 1/, JSON.stringify(v));
  assert.deepEqual(envProblems({ APP_ENV: 'production', PORTAL_INDEXAVEL: '1' }, { deploy: true }), []);
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'c'.repeat(40);
  const rel = { commit: sha, siteUrl: 'https://x.vertraweb.app', appEnv: 'production', indexavel: true };
  assert.match(startProblems({ APP_ENV: 'production', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl, PORTAL_INDEXAVEL: ' 1' }, rel).join('|'), /PORTAL_INDEXAVEL ausente|so o valor 1/);
});

// ---------- Opção (e) do PM: typecheck fora do build da Vertra, só com relatório verde do MESMO commit ----------
test('opção (e): typecheckReportProblem aceita só relatório do mesmo commit com a etapa typecheck verde', async () => {
  const { typecheckReportProblem } = await import('../scripts/lib/typecheck-report.mjs');
  const sha = 'd'.repeat(40);
  const ok = { head: sha, ok: true, verificacao: [{ etapa: 'lint', ok: true }, { etapa: 'typecheck', ok: true }] };
  assert.equal(typecheckReportProblem(ok, sha), '');
  assert.match(typecheckReportProblem(ok, 'e'.repeat(40)), /OUTRO commit/);
  assert.match(typecheckReportProblem({ ...ok, verificacao: [{ etapa: 'typecheck', ok: false }] }, sha), /FALHOU/);
  assert.match(typecheckReportProblem({ ...ok, verificacao: [{ etapa: 'lint', ok: true }] }, sha), /não tem a etapa typecheck/);
  assert.match(typecheckReportProblem({ ...ok, head: 'curto' }, sha), /sem "head"/);
  assert.match(typecheckReportProblem(null, sha), /ilegível/);
  assert.match(typecheckReportProblem({ ...ok, verificacao: 'x' }, sha), /não tem a etapa typecheck/);
});

test('opção (e): typecheckEnv só liga LN_BUILD_SKIP_TYPECHECK quando o release.json dispensa; o painel nunca decide', async () => {
  const { typecheckEnv } = await import('../scripts/lib/typecheck-report.mjs');
  assert.deepEqual(typecheckEnv({ semTypecheckNoBuild: true }), { LN_BUILD_SKIP_TYPECHECK: '1' });
  assert.deepEqual(typecheckEnv({ semTypecheckNoBuild: false }), {});
  assert.deepEqual(typecheckEnv({}), {});
  assert.deepEqual(typecheckEnv(null), {});
  assert.deepEqual(typecheckEnv({ semTypecheckNoBuild: 'true' }), {}, 'só o booleano true');
});

test('opção (e): package-web --sem-typecheck-no-build exige o relatório, recusa worker e relatório de outro commit', () => {
  const dir = join(tmp(), 'nada');
  const sem = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--sem-typecheck-no-build']);
  assert.equal(sem.status, 2);
  assert.match(sem.stderr, /exige --typecheck-report/);
  const w = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--app', 'workers', '--sem-typecheck-no-build', '--typecheck-report', 'x.json']);
  assert.equal(w.status, 2);
  assert.match(w.stderr, /so vale para o web/);
  const d = tmp();
  put(d, 'rel.json', JSON.stringify({ head: 'f'.repeat(40), ok: true, verificacao: [{ etapa: 'typecheck', ok: true }] }));
  const outro = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--sem-typecheck-no-build', '--typecheck-report', join(d, 'rel.json')]);
  assert.notEqual(outro.status, 0);
  assert.match(outro.stderr, /OUTRO commit/);
  const ruim = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', dir, '--sem-typecheck-no-build', '--typecheck-report', join(d, 'nao-existe.json')]);
  assert.equal(ruim.status, 2);
  assert.match(ruim.stderr, /ilegivel/);
  rmSync(d, { recursive: true, force: true });
});

test('opção (e): start-web reprova LN_BUILD_SKIP_TYPECHECK em execução (a variável é só do build)', async () => {
  const { startProblems } = await import('../scripts/start-web.mjs');
  const sha = 'a'.repeat(40);
  const rel = { commit: sha, siteUrl: 'https://x.vertraweb.app', appEnv: 'staging' };
  const env = { APP_ENV: 'staging', APP_COMMIT: sha, NEXT_PUBLIC_SITE_URL: rel.siteUrl };
  assert.deepEqual(startProblems(env, rel), []);
  assert.match(startProblems({ ...env, LN_BUILD_SKIP_TYPECHECK: '1' }, rel).join('|'), /LN_BUILD_SKIP_TYPECHECK definida em execução/);
});

test('build leve: buildLeveEnv só liga CIRCLE_NODE_TOTAL=2 (1 worker do Next) quando o release.json pede', async () => {
  const { buildLeveEnv } = await import('../scripts/lib/typecheck-report.mjs');
  assert.deepEqual(buildLeveEnv({ buildLeve: true }), { CIRCLE_NODE_TOTAL: '2', LN_BUILD_LEVE: '1' });
  assert.deepEqual(buildLeveEnv({ buildLeve: false }), {});
  assert.deepEqual(buildLeveEnv({}), {});
  assert.deepEqual(buildLeveEnv(null), {});
  assert.deepEqual(buildLeveEnv({ buildLeve: 'true' }), {}, 'só o booleano true');
});

test('build leve: package-web --build-leve recusa worker', () => {
  const x = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', join(tmp(), 'nada'), '--app', 'workers', '--build-leve']);
  assert.equal(x.status, 2);
  assert.match(x.stderr, /--build-leve so vale para o web/);
});

// ---------- Fase 3 do staging: smoke tests (smoke-staging.mjs) ----------
test('smoke-staging: avaliarReady e empresasNaPagina (funções puras)', async () => {
  const { avaliarReady, empresasNaPagina } = await import('../scripts/smoke-staging.mjs');
  assert.deepEqual(avaliarReady({ status: 'ok', mode: 'completo', db: 'ok', redis: 'ok' }), []);
  assert.match(avaliarReady({ status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a' }).join('|'), /mode=nodb/);
  assert.match(avaliarReady({ status: 'indisponivel', mode: 'completo', db: 'falha', redis: 'ok' }).join('|'), /db=falha/);
  assert.match(avaliarReady({ status: 'indisponivel', mode: 'completo', db: 'ok', redis: 'nao_configurado' }).join('|'), /redis=nao_configurado/);
  assert.deepEqual(avaliarReady(null), ['corpo sem JSON']);
  assert.equal(empresasNaPagina('<p class="pt-meta" data-testid="count-empresas">29 cadastrado(s) e verificado(s)</p>'), 29);
  assert.equal(empresasNaPagina('<p data-testid="count-empresas">Cadastros verificados: em breve</p>'), null);
  assert.equal(empresasNaPagina('<html></html>'), null);
});

test('smoke-staging: staging completo com seed passa; nodb, seed ausente e /intelligence em breve reprovam com o motivo', async () => {
  const R = 'DEMO · staging';
  const estado = { mode: 'completo', semSeed: false, orgs: 29, feedComItem: false, loginForm: true };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const html = (c, b, h = {}) => { res.writeHead(c, { 'content-type': 'text/html', ...h }); res.end(b); };
    const itensSeed = estado.semSeed ? [] : [1, 2, 3, 4, 5].map((n) => ({ slug: 'a' + n, titulo: '[' + R + '] Matéria ' + n }));
    if (u === '/api/health') return json(200, { status: 'ok', version: 'abc' });
    if (u === '/api/ready') return json(200, estado.mode === 'nodb' ? { status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a' } : { status: 'ok', mode: 'completo', db: 'ok', redis: 'ok' });
    if (u === '/api/publico/site') return json(200, { nome: 'Loyalty News' });
    if (u === '/api/publico/editorias') return json(200, { data: Array.from({ length: 10 }, (_, i) => ({ slug: 'e' + i })) });
    if (u === '/api/publico/materias') return json(200, { data: itensSeed, total: itensSeed.length });
    if (u === '/api/publico/agenda') return json(200, { data: [{ titulo: '[' + R + '] Evento' }] });
    if (u === '/') return html(200, '<meta name="robots" content="noindex, nofollow"/>' + (estado.semSeed ? '' : '[' + R + '] Matéria 1'));
    if (u === '/noticias') return html(200, estado.semSeed ? 'vazio' : '[' + R + '] Matéria 1');
    if (u === '/feed.xml') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end('<rss>' + (estado.feedComItem ? '<item><title>x</title></item>' : '') + '</rss>'); }
    if (u === '/intelligence') return html(200, estado.orgs ? '<p data-testid="count-empresas">' + estado.orgs + ' cadastrado(s) e verificado(s)</p>' : '<p data-testid="count-empresas">Cadastros verificados: em breve</p>');
    if (u === '/studio') { res.writeHead(307, { location: '/studio/entrar?motivo=NO_SESSION' }); return res.end(); }
    if (u === '/studio/entrar') return html(200, estado.loginForm ? '<form><input type="password"/></form>' : '<p>O login do Studio ainda não está disponível neste ambiente.</p>');
    if (u === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  // spawn ASSÍNCRONO: o servidor falso roda neste processo e o spawnSync bloquearia o laço de eventos
  const run = (extra = [], semUrl = false) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-staging.mjs'), ...(semUrl ? [] : ['--url', 'http://127.0.0.1:' + port, '--expect-commit', 'abc']), ...extra]);
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, stdout }));
  });
  try {
    const ok = await run(['--expect-seed', '--expect-orgs', '29']);
    assert.equal(ok.status, 0, ok.stdout);
    assert.equal(JSON.parse(ok.stdout).falhas, 0);
    estado.mode = 'nodb';
    const nodb = await run();
    assert.equal(nodb.status, 1);
    assert.match(nodb.stdout, /mode=nodb/);
    estado.mode = 'completo'; estado.semSeed = true;
    assert.equal((await run()).status, 0, 'sem --expect-seed o seed não é exigido');
    const sem = await run(['--expect-seed']);
    assert.equal(sem.status, 1);
    assert.match(sem.stdout, /seed publicado/);
    estado.semSeed = false; estado.orgs = 0;
    const emBreve = await run(['--expect-orgs', '29']);
    assert.equal(emBreve.status, 1);
    assert.match(emBreve.stdout, /adaptador api do portal ainda não lê Intelligence/);
    // feed de staging com item = vazamento (R6); tela de entrada em aviso: nota sem falha, e falha só com --expect-login-form; detalhe de falha não aparece no que passou
    estado.orgs = 29; estado.feedComItem = true;
    const feed = await run();
    assert.equal(feed.status, 1);
    assert.match(feed.stdout, /SEM itens \(staging não indexável, R6\)/);
    estado.feedComItem = false; estado.loginForm = false;
    const aviso = await run(['--expect-seed']);
    assert.equal(aviso.status, 0, aviso.stdout);
    assert.match(JSON.parse(aviso.stdout).notas.join('|'), /login real do Studio está BLOQUEADO/);
    for (const c of JSON.parse(aviso.stdout).checagens) if (c.ok) assert.equal(c.detalhe, undefined, 'check que passou não carrega detalhe de falha: ' + c.nome);
    const exige = await run(['--expect-login-form']);
    assert.equal(exige.status, 1);
    assert.match(exige.stdout, /a tela é só um aviso/);
    assert.equal((await run([], true)).status, 2, 'sem --url recusa');
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('ci-checks: URL de conexão com senha em teste/doc só passa com host obviamente falso; host real, e qualquer host fora de teste/doc, reprova', async () => {
  const { conexoesComSenhaReais } = await import('../scripts/lib/segredos.mjs');
  const f1 = "const a = 'postgres://u:p@h/db'; const b = 'postgres://postgres:postgres@127.0.0.1:55432/postgres'; const c = 'postgres://u:p@db.example:5432/ln?x=1';";
  assert.deepEqual(conexoesComSenhaReais(f1, 'packages/db/src/tls.test.ts'), []);
  assert.deepEqual(conexoesComSenhaReais('postgres://usuario:senha@127.0.0.1:PORTA/postgres', 'packages/modelops/docs/ledger.md'), []);
  assert.deepEqual(conexoesComSenhaReais('rediss://u:p@localhost:6379', 'apps/web/lib/x.spec.ts'), []);
  const real = 'postgres://vertracloud:abc123@862011ce0c0a4472a2a1dbb341808f00.db.usa1.vertraweb.app:24684/vertracloud';
  assert.equal(conexoesComSenhaReais(real, 'packages/db/src/tls.test.ts').length, 1, 'host da Vertra em teste continua reprovado');
  assert.equal(conexoesComSenhaReais(real, 'docs/nota.md').length, 1, 'host da Vertra em doc continua reprovado');
  assert.equal(conexoesComSenhaReais(f1, 'apps/web/app/api/x.ts').length, 3, 'fora de teste/doc nada muda');
  assert.equal(conexoesComSenhaReais('postgres://u:p@meu-servidor.com.br/db', 'apps/a.test.ts').length, 1, 'host desconhecido reprova');
  assert.equal(conexoesComSenhaReais('postgres://u:p@localhost.evil.com/db', 'apps/a.test.ts').length, 1, 'localhost.evil.com não é loopback');
  assert.deepEqual(conexoesComSenhaReais('postgres://u:p@staging.exemplo.internal:5432/x postgres://u:p@10.0.0.7:5432/x postgres://u:p@192.168.1.9/x', 'packages/a/src/x.test.ts'), [], 'hosts internos e faixas privadas em teste');
  assert.equal(conexoesComSenhaReais('postgres://u:p@8.8.8.8/x', 'packages/a/src/x.test.ts').length, 1, 'IP publico em teste reprova');
  assert.equal(conexoesComSenhaReais('postgres://u:p@10.0.0.7:5432/x', 'apps/web/lib/x.ts').length, 1, 'faixa privada fora de teste reprova');
});

test('ci-checks: árvore com fixture falsa em teste passa; com URL real da Vertra em teste reprova (ponta a ponta)', () => {
  const ok = tmp();
  put(ok, 'package.json', '{"name":"x"}');
  put(ok, 'packages/db/src/tls.test.ts', "export const U = 'postgres://u:p@h/db';");
  assert.equal(node('ci-checks.mjs', ['--root', ok], { env: cleanEnv() }).status, 0);
  rmSync(ok, { recursive: true, force: true });
  const bad = tmp();
  put(bad, 'package.json', '{"name":"x"}');
  put(bad, 'packages/db/src/tls.test.ts', "export const U = 'postgres://vertracloud:abc@0123456789abcdef.db.usa1.vertraweb.app:1/vertracloud';");
  const x = node('ci-checks.mjs', ['--root', bad], { env: cleanEnv() });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /string de conexão com senha em packages\/db\/src\/tls\.test\.ts/);
  rmSync(bad, { recursive: true, force: true });
});

test('PEM em UMA linha com \\n escapado (como a Vertra entrega) é normalizado igual ao multilinha: normalizarPem, pgClientConfig e redisTlsFromEnv', async () => {
  const { normalizarPem, pgClientConfig } = await import('../scripts/lib/pg.mjs');
  const { redisTlsFromEnv } = await import('../scripts/check-conexoes.mjs');
  const multi = '-----BEGIN CERTIFICATE-----\nAAAA\nBBBB\n-----END CERTIFICATE-----\n';
  const umaLinha = multi.trim().split('\n').join('\\n');
  assert.ok(!umaLinha.includes('\n'), 'a versão de uma linha não tem quebra real');
  assert.equal(normalizarPem(umaLinha), multi);
  assert.equal(normalizarPem(multi), multi);
  assert.equal(normalizarPem('"' + umaLinha + '"'), multi, 'aspas ao redor');
  assert.equal(normalizarPem(''), undefined);
  assert.equal(normalizarPem(undefined), undefined);
  const a = pgClientConfig({ DATABASE_URL: 'postgres://u:p@h:1/d', DB_SSL_CA_PEM: umaLinha, DB_SSL_CERT_PEM: umaLinha, DB_SSL_KEY_PEM: umaLinha });
  assert.deepEqual([a.ssl.ca, a.ssl.cert, a.ssl.key], [multi, multi, multi]);
  const r = redisTlsFromEnv({ REDIS_URL: 'rediss://u:p@abc.db.usa1.vertraweb.app:1', REDIS_SSL_CA_PEM: umaLinha, REDIS_SSL_CERT_PEM: umaLinha, REDIS_SSL_KEY_PEM: umaLinha });
  assert.deepEqual([r.tls.ca, r.tls.cert, r.tls.key], [multi, multi, multi]);
});

// ---- memoria-build.mjs: guarda da troca de memória do web no build (880 só no build; 512 em regime)
const perfilFalso = ({ stgWeb = 512, prodWeb = 512, stgWorker = 128, prodWorker = 256, extraUsed = 0, limit = 8192 } = {}) => {
  const apps = [
    { id: 'stg-web', name: 'ln-staging-web', type: 2, ram: stgWeb, status: 'up' },
    { id: 'stg-wk', name: 'ln-staging-workers', type: 1, ram: stgWorker, status: 'up' },
    { id: 'prod-web', name: 'ln-prod-web', type: 2, ram: prodWeb, status: 'up' },
    { id: 'prod-wk', name: 'ln-prod-workers', type: 1, ram: prodWorker, status: 'up' },
    { id: 'o1', name: 'camarim-magico', type: 2, ram: 512, status: 'up' },
    { id: 'o2', name: 'agencia-worker', type: 1, ram: 128, status: 'up' },
    { id: 'o3', name: 'revela-face-engine', type: 1, ram: 384, status: 'up' },
    { id: 'o4', name: 'wa-gateway', type: 2, ram: 512, status: 'up' },
    { id: 'o5', name: 'agencia-web', type: 2, ram: 512, status: 'up' },
  ];
  const databases = [{ id: 'd1', name: 'agencia-db', ram: 1024 }, { id: 'd2', name: 'ln-staging-db', ram: 1024 }, { id: 'd3', name: 'ln-staging-redis', ram: 512 }, { id: 'd4', name: 'ln-prod-db', ram: 1024 }, { id: 'd5', name: 'ln-prod-redis', ram: 512 }];
  const soma = apps.reduce((s, a) => s + a.ram, 0) + databases.reduce((s, d) => s + d.ram, 0);
  return { name: 'Fulano', email: 'fulano@example.invalid', applications: apps, databases, plan: { name: 'pro-8', memory: { limit, used: soma + extraUsed } } };
};

test('memoria-build: regime (7552 de 8192) pode subir um web a 880; pico 7920; volta a 7552', async () => {
  const { lerPerfil, avaliar, passos } = await import('../scripts/memoria-build.mjs');
  const p = lerPerfil(perfilFalso());
  assert.equal(p.used, 7552);
  assert.equal(p.soma, 7552);
  const a = avaliar(p, 'prod-web', { fase: 'antes' });
  assert.equal(a.ok, true, a.problemas.join('|'));
  const s = passos(p, 'prod-web', { pacote: 'C:/pacote' });
  assert.deepEqual(s.map((x) => x.usedEsperado), [7552, 7920, 7920, 7920, 7920, 7920, 7552, 7552]);
  assert.deepEqual(s[1].args, { id: 'prod-web', memory: 880 });
  assert.deepEqual(s[6].args, { id: 'prod-web', memory: 512 });
  assert.equal(s[4].args.path, 'C:/pacote');
  // durante: com o alvo em 880 o estado está certo; depois: ainda em 880 é problema (memória esquecida alta)
  const alto = lerPerfil(perfilFalso({ prodWeb: 880 }));
  assert.equal(avaliar(alto, 'prod-web', { fase: 'durante' }).ok, true);
  const d = avaliar(alto, 'prod-web', { fase: 'depois' });
  assert.equal(d.ok, false);
  assert.match(d.problemas.join('|'), /continua em 880 MB: baixe para 512/);
  assert.equal(avaliar(p, 'prod-web', { fase: 'depois' }).ok, true);
});

test('memoria-build: recusa dois webs altos, falta de folga, regime errado, perfil que não fecha e app desconhecido', async () => {
  const { lerPerfil, avaliar } = await import('../scripts/memoria-build.mjs');
  // outro web do LN já está em 880: só um por vez
  const dois = avaliar(lerPerfil(perfilFalso({ stgWeb: 880 })), 'prod-web', { fase: 'antes' });
  assert.equal(dois.ok, false);
  assert.match(dois.problemas.join('|'), /ln-staging-web está em 880 MB .*só um web sobe por vez/);
  // sem folga: staging com worker 256 e worker de produção 384 (7808 de 8192, sobram 384): subir +368 deixaria 16 MB
  const semFolga = avaliar(lerPerfil(perfilFalso({ stgWorker: 256, prodWorker: 384 })), 'prod-web', { fase: 'antes' });
  assert.equal(semFolga.ok, false);
  assert.match(semFolga.problemas.join('|'), /faltam 112 MB.*pico seria 8176 de 8192/);
  // margem mínima: com 8192 e margem 300 o pico (7920, livre 272) é recusado
  const margem = avaliar(lerPerfil(perfilFalso()), 'prod-web', { fase: 'antes', margem: 300 });
  assert.equal(margem.ok, false);
  assert.match(margem.problemas.join('|'), /faltam 28 MB.*pico seria 7920 de 8192/);
  // regime errado (um build anterior deixou o web alto)
  assert.match(avaliar(lerPerfil(perfilFalso({ prodWeb: 880 })), 'prod-web', { fase: 'antes' }).problemas.join('|'), /não no regime de 512/);
  // leitura que não fecha (used diferente da soma)
  assert.match(avaliar(lerPerfil(perfilFalso({ extraUsed: 256 })), 'prod-web', { fase: 'antes' }).problemas.join('|'), /não fecha/);
  // app desconhecido e envelope { response }
  assert.equal(avaliar(lerPerfil({ response: perfilFalso() }), 'nao-existe', { fase: 'antes' }).ok, false);
  assert.throws(() => lerPerfil({ foo: 1 }), /não parece um get_profile/);
});

test('memoria-build: CLI plano/conferir (códigos de saída, sem e-mail nem nome na saída)', () => {
  const r = tmp();
  put(r, 'perfil.json', JSON.stringify(perfilFalso()));
  put(r, 'perfil-alto.json', JSON.stringify(perfilFalso({ prodWeb: 880 })));
  const ok = node('memoria-build.mjs', ['plano', '--profile', join(r, 'perfil.json'), '--app', 'prod-web', '--pacote', 'C:/p']);
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.passos.length, 8);
  assert.doesNotMatch(ok.stdout, /fulano|Fulano/);
  const ruim = node('memoria-build.mjs', ['conferir', '--profile', join(r, 'perfil-alto.json'), '--app', 'prod-web', '--fase', 'depois']);
  assert.equal(ruim.status, 1);
  assert.equal(JSON.parse(ruim.stdout).ok, false);
  assert.equal(node('memoria-build.mjs', ['conferir', '--profile', join(r, 'perfil-alto.json'), '--app', 'prod-web', '--fase', 'durante']).status, 0);
  assert.equal(node('memoria-build.mjs', ['plano', '--app', 'x']).status, 2);
  assert.equal(node('memoria-build.mjs', ['conferir', '--profile', join(r, 'perfil.json'), '--app', 'prod-web']).status, 2);
  rmSync(r, { recursive: true, force: true });
});

// ---- erros-log.mjs: segredo em log de erro (incidente 23/11/2026; decisão 17 da Security)
test('erros-log R1: conexão sem .on(error) no arquivo reprova; com ouvinte, em teste ou em comentário passa', async () => {
  const { conexoesSemOuvinteDeErro, ehCodigoDeProduto } = await import('../scripts/lib/erros-log.mjs');
  const sem = "import { Pool } from 'pg';\nimport IORedis from 'ioredis';\nconst pool = new Pool(cfg);\nconst r = new IORedis(url);\n";
  assert.deepEqual(conexoesSemOuvinteDeErro(sem).map((a) => [a.construtor, a.linha]), [['new Pool', 3], ['new IORedis', 4]]);
  assert.deepEqual(conexoesSemOuvinteDeErro(sem + "pool.on('error', (e) => log(safeErr(e)));\n"), []);
  assert.deepEqual(conexoesSemOuvinteDeErro(sem + 'r.once("error", h);\n'), []);
  assert.equal(conexoesSemOuvinteDeErro("import { Queue, Worker } from 'bullmq';\nnew Queue('a');\nnew Worker('a', fn);\n").length, 2);
  // sem importar a biblioteca, `new Client`/`new Queue` são outra coisa
  assert.deepEqual(conexoesSemOuvinteDeErro("class Client {}\nconst c = new Client();\nconst q = new Queue();\n"), []);
  // comentário não conta, nem como conexão nem como ouvinte
  assert.deepEqual(conexoesSemOuvinteDeErro("import { Pool } from 'pg';\n// new Pool(x)\n/* pool.on('error', h) */\n"), []);
  assert.equal(conexoesSemOuvinteDeErro("import { Pool } from 'pg';\nconst p = new Pool(c);\n// pool.on('error', h)\n").length, 1);
  // escopo: só apps/ e packages/, fora de teste
  assert.equal(ehCodigoDeProduto('apps/workers/src/main.ts'), true);
  assert.equal(ehCodigoDeProduto('packages/auth/src/runtime.ts'), true);
  for (const r of ['apps/workers/src/main.test.ts', 'apps/web/e2e/x.ts', 'packages/db/src/__tests__/a.ts', 'apps/web/scripts/build.mjs', 'infra/scripts/check-conexoes.mjs', 'packages/db/src/x.d.ts', 'apps/web/app/page.css']) assert.equal(ehCodigoDeProduto(r), false, r);
});

test('erros-log R2: console.* com o erro inteiro reprova; {name, code, message} e e.message passam', async () => {
  const { logsDeErroBruto } = await import('../scripts/lib/erros-log.mjs');
  const ruins = [
    "console.error(e);", "console.error('falhou', err);", "console.warn(error)", "console.log('x', { err });", "console.error({ error: e, id });",
    "console.error('x', util.inspect(err, { depth: 5 }));", "console.error(JSON.stringify(e));", "console.error('x', e.cause);", "console.error(err.options)",
    "client.on('error', console.error);", "console.error(`${id}`, dbError);", "console.error(...err);",
  ];
  for (const c of ruins) assert.equal(logsDeErroBruto(c).length, 1, c);
  const boas = [
    "console.error('falhou', e.message);", "console.error(safeErr(e));", "console.error({ name: e.name, code: e.code, message: e.message });",
    "console.error(`[workers] falhou: ${String(e)}`);", "console.log('ok', id, total);", "console.error('x', (e as Error).message);",
    "// console.error(e)", "/* console.error(err) */ console.log('a');", "const s = \"console.error(e)\";", "console.error('erro:', errors.length);",
  ];
  for (const c of boas) assert.equal(logsDeErroBruto(c).length, 0, c);
  assert.equal(logsDeErroBruto("a();\nb();\nconsole.error(e);\n")[0].linha, 3);
});

test('ci-checks: segredo em log de erro avisa por padrão e REPROVA com --producao (e package-web production usa --producao)', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  put(r, 'apps/workers/src/main.ts', "import { Pool } from 'pg';\nconst pool = new Pool(cfg);\ntry { await pool.query('select 1'); } catch (e) { console.error(e); }\n");
  put(r, 'apps/workers/src/main.test.ts', "import { Pool } from 'pg';\nnew Pool(cfg);\nconsole.error(e);\n");
  put(r, 'packages/auth/src/ok.ts', "import { Pool } from 'pg';\nconst p = new Pool(cfg);\np.on('error', (e) => console.error(safeErr(e)));\n");
  const aviso = node('ci-checks.mjs', ['--root', r]);
  assert.equal(aviso.status, 0, aviso.stderr);
  assert.match(aviso.stderr, /AVISO.*2 ocorrência/s);
  assert.match(aviso.stderr, /apps\/workers\/src\/main\.ts:2 \[R1\]/);
  assert.match(aviso.stderr, /apps\/workers\/src\/main\.ts:3 \[R2\]/);
  assert.doesNotMatch(aviso.stderr, /main\.test\.ts|ok\.ts/);
  for (const flag of ['--producao', '--logs-estritos']) {
    const x = node('ci-checks.mjs', ['--root', r, flag]);
    assert.equal(x.status, 1, flag);
    assert.match(x.stderr, /segredo em log de erro: apps\/workers\/src\/main\.ts:2 \[R1\]/);
  }
  put(r, 'apps/workers/src/main.ts', "import { Pool } from 'pg';\nconst pool = new Pool(cfg);\npool.on('error', (e) => console.error(safeErr(e)));\n");
  assert.equal(node('ci-checks.mjs', ['--root', r, '--producao']).status, 0);
  rmSync(r, { recursive: true, force: true });
});
