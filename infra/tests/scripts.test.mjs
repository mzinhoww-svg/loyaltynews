// Testes dos scripts de infra (node:test, sem dependências). Rodar: node --test infra/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { compareStats } from '../scripts/lib/pg.mjs';

process.env.LN_SAUDE_INTERVALO_MS ??= '20'; // testes: janela de estabilidade do health curta (padrão real: 5000 ms)
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
  const y = readFileSync(join(S, '..', 'github-workflows', 'ci.yml'), 'utf8');
  assert.match(y, /npm run migrate -w @ln\/db\s*$/m);
  assert.doesNotMatch(y, /run:.*--if-present/);
  assert.match(y, /verify-migrations\.mjs/);
  assert.equal((y.match(/vars\.LN_ACTIONS_ENABLED == 'true'/g) || []).length, 2, 'os dois jobs precisam da trava');
  const b = readFileSync(join(S, '..', 'github-workflows', 'backup.yml'), 'utf8');
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
    const itensSeed = estado.semSeed ? [] : [1, 2, 3, 4, 5].map((n) => ({ slug: 'a' + n, editoria: 'e0', titulo: '[' + R + '] Matéria ' + n }));
    if (u === '/api/health') return json(200, { status: 'ok', version: 'abc' });
    if (u === '/api/ready') return json(200, estado.mode === 'nodb' ? { status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a' } : { status: 'ok', mode: 'completo', db: 'ok', redis: 'ok' });
    if (u === '/api/publico/site') return json(200, { nome: 'Loyalty News' });
    if (u === '/api/publico/editorias') return json(200, { data: Array.from({ length: 10 }, (_, i) => ({ slug: 'e' + i })) });
    if (u === '/api/publico/materias') return json(200, { data: itensSeed, total: itensSeed.length });
    if (u === '/api/publico/agenda') return json(200, { data: [{ titulo: '[' + R + '] Evento' }] });
    if (u === '/') return html(200, '<meta name="robots" content="noindex, nofollow"/>' + (estado.semSeed ? '' : '[' + R + '] Matéria 1'));
    if (u === '/noticias') return html(200, estado.semSeed ? 'vazio' : '[' + R + '] Matéria 1');
    if (u === '/noticia/a1' || u === '/editoria/e0') return html(200, estado.semSeed ? 'vazio' : '[' + R + '] Matéria 1');
    if (u === '/midia-kit') return html(200, '<title>Mídia kit — Anuncie | Loyalty News</title><meta name="robots" content="noindex, nofollow"/>');
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
  const a = avaliar(p, 'prod-web', { fase: 'antes', build: 880 });
  assert.equal(a.ok, true, a.problemas.join('|'));
  const s = passos(p, 'prod-web', { pacote: 'C:/pacote', build: 880 });
  assert.deepEqual(s.map((x) => x.usedEsperado), [7552, 7920, 7920, 7920, 7920, 7920, 7552, 7552]);
  assert.deepEqual(s[1].args, { id: 'prod-web', memory: 880 });
  assert.deepEqual(s[6].args, { id: 'prod-web', memory: 512 });
  assert.equal(s[4].args.path, 'C:/pacote');
  // durante: com o alvo em 880 o estado está certo; depois: ainda em 880 é problema (memória esquecida alta)
  const alto = lerPerfil(perfilFalso({ prodWeb: 880 }));
  assert.equal(avaliar(alto, 'prod-web', { fase: 'durante', build: 880 }).ok, true);
  const d = avaliar(alto, 'prod-web', { fase: 'depois', build: 880 });
  assert.equal(d.ok, false);
  assert.match(d.problemas.join('|'), /continua em 880 MB: baixe para 512/);
  assert.equal(avaliar(p, 'prod-web', { fase: 'depois', build: 880 }).ok, true);
});

test('memoria-build: recusa dois webs altos, falta de folga, regime errado, perfil que não fecha e app desconhecido', async () => {
  const { lerPerfil, avaliar } = await import('../scripts/memoria-build.mjs');
  // outro web do LN já está em 880: só um por vez
  const dois = avaliar(lerPerfil(perfilFalso({ stgWeb: 880 })), 'prod-web', { fase: 'antes', build: 880 });
  assert.equal(dois.ok, false);
  assert.match(dois.problemas.join('|'), /ln-staging-web está em 880 MB .*só um web sobe por vez/);
  // sem folga: staging com worker 256 e worker de produção 384 (7808 de 8192, sobram 384): subir +368 deixaria 16 MB
  const semFolga = avaliar(lerPerfil(perfilFalso({ stgWorker: 256, prodWorker: 384 })), 'prod-web', { fase: 'antes', build: 880 });
  assert.equal(semFolga.ok, false);
  assert.match(semFolga.problemas.join('|'), /faltam 112 MB.*pico seria 8176 de 8192/);
  // margem mínima: com 8192 e margem 300 o pico (7920, livre 272) é recusado
  const margem = avaliar(lerPerfil(perfilFalso()), 'prod-web', { fase: 'antes', margem: 300, build: 880 });
  assert.equal(margem.ok, false);
  assert.match(margem.problemas.join('|'), /faltam 28 MB.*pico seria 7920 de 8192/);
  // regime errado (um build anterior deixou o web alto)
  assert.match(avaliar(lerPerfil(perfilFalso({ prodWeb: 880 })), 'prod-web', { fase: 'antes', build: 880 }).problemas.join('|'), /não no regime de 512/);
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
  const ok = node('memoria-build.mjs', ['plano', '--profile', join(r, 'perfil.json'), '--app', 'prod-web', '--pacote', 'C:/p', '--build', '880']);
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.passos.length, 8);
  assert.doesNotMatch(ok.stdout, /fulano|Fulano/);
  const ruim = node('memoria-build.mjs', ['conferir', '--profile', join(r, 'perfil-alto.json'), '--app', 'prod-web', '--fase', 'depois']);
  assert.equal(ruim.status, 1);
  assert.equal(JSON.parse(ruim.stdout).ok, false);
  assert.equal(node('memoria-build.mjs', ['conferir', '--profile', join(r, 'perfil-alto.json'), '--app', 'prod-web', '--fase', 'durante', '--build', '880']).status, 0);
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

// ---- ADR-022 (DP-38): LN_FLAGS_ON só no staging, amarrada ao release.json
test('guards: LN_FLAGS_ON só no staging, formato de lista e vínculo com release.json.flagsLigadas', async () => {
  const { envProblems, flagsProblems, flagsNormalizadas, ASSIGN_FLAGS } = await import('../scripts/lib/guards.mjs');
  const stg = { APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' };
  assert.deepEqual(envProblems(stg, { deploy: true }).filter((m) => /LN_FLAGS_ON/.test(m)), []);
  assert.deepEqual(envProblems({ APP_ENV: 'staging', LN_FLAGS_ON: 'a,b' }, { deploy: true }).filter((m) => /LN_FLAGS_ON/.test(m)), []);
  for (const ruim of ['intelligencePessoas, openbotDispatch', "'intelligencePessoas'", 'a;b', '1abc', ',a']) assert.match(envProblems({ ...stg, LN_FLAGS_ON: ruim }, { deploy: true }).join('|'), /LN_FLAGS_ON fora do formato/, ruim);
  assert.match(envProblems({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' }).join('|'), /LN_FLAGS_ON definida em produção/);
  assert.match(envProblems({ APP_ENV: 'producao', LN_FLAGS_ON: 'x' }).join('|'), /em produção/);
  assert.match(envProblems({ APP_ENV: 'homolog', LN_FLAGS_ON: 'x' }, { deploy: true }).join('|'), /só o staging aceita flags/);
  assert.deepEqual(envProblems({ APP_ENV: 'local', LN_FLAGS_ON: 'x' }).filter((m) => /LN_FLAGS_ON/.test(m)), [], 'desenvolvimento local não é barrado');
  assert.equal(flagsNormalizadas(' b, a ,'), 'a,b');
  assert.equal(flagsNormalizadas(['b', 'a']), 'a,b');
  assert.deepEqual(flagsProblems({}, { flagsLigadas: [] }), []);
  assert.deepEqual(flagsProblems({}, {}), []);
  assert.deepEqual(flagsProblems({ LN_FLAGS_ON: 'b,a' }, { flagsLigadas: ['a', 'b'] }), []);
  assert.match(flagsProblems({}, { flagsLigadas: ['intelligencePessoas'] }).join('|'), /defina LN_FLAGS_ON=intelligencePessoas/);
  assert.match(flagsProblems({ LN_FLAGS_ON: 'openbotDispatch' }, { flagsLigadas: ['intelligencePessoas'] }).join('|'), /difere do release\.json/);
  assert.match(flagsProblems({ LN_FLAGS_ON: 'intelligencePessoas' }, {}).join('|'), /não liga nenhuma flag/);
  assert.equal(ASSIGN_FLAGS.test('LN_FLAGS_ON=intelligencePessoas'), true);
  assert.equal(ASSIGN_FLAGS.test("{ LN_FLAGS_ON: 'a' }"), true);
  assert.equal(ASSIGN_FLAGS.test('process.env.LN_FLAGS_ON === undefined'), false);
});

test('guard-env: release.json do pacote manda em LN_FLAGS_ON (web e worker); ci-checks reprova atribuição em arquivo de deploy', () => {
  const r = tmp();
  put(r, 'release.json', JSON.stringify({ appEnv: 'staging', flagsLigadas: ['intelligencePessoas'] }));
  const env = { ...cleanEnvFlags(), APP_ENV: 'staging' };
  const g = (extra) => spawnSync(process.execPath, [join(S, 'guard-env.mjs')], { cwd: r, encoding: 'utf8', env: { ...env, ...extra } });
  assert.equal(g({ LN_FLAGS_ON: 'intelligencePessoas' }).status, 0);
  const falta = g({});
  assert.equal(falta.status, 1);
  assert.match(falta.stderr, /defina LN_FLAGS_ON=intelligencePessoas/);
  assert.equal(g({ LN_FLAGS_ON: 'openbotDispatch' }).status, 1);
  put(r, 'release.json', JSON.stringify({ appEnv: 'staging', flagsLigadas: [] }));
  assert.equal(g({}).status, 0);
  assert.equal(g({ LN_FLAGS_ON: 'intelligencePessoas' }).status, 1);
  rmSync(r, { recursive: true, force: true });
  const c = tmp();
  put(c, 'package.json', '{"name":"x","scripts":{"start":"LN_FLAGS_ON=intelligencePessoas next start"}}');
  put(c, '.github/workflows/deploy.yml', 'env:\n  LN_FLAGS_ON: intelligencePessoas\n');
  const x = node('ci-checks.mjs', ['--root', c], { env: cleanEnvFlags() });
  assert.equal(x.status, 1);
  assert.match(x.stderr, /LN_FLAGS_ON atribuída no script "start"/);
  assert.match(x.stderr, /LN_FLAGS_ON atribuída em \.github\/workflows\/deploy\.yml/);
  rmSync(c, { recursive: true, force: true });
});
function cleanEnvFlags() { const e = { ...process.env }; for (const k of ['APP_ENV', 'LN_FLAGS_ON', 'CI', 'PORTAL_SOURCE', 'PORTAL_MODE', 'LN_STUDIO_TEST_SESSION', 'PORTAL_VITRINE', 'PORTAL_INDEXAVEL', 'DIAG_XFF']) delete e[k]; return e; }

// ---- sharp (binário nativo por plataforma): lockfile do Windows precisa listar o Linux; prova-png.mjs
test('ci-checks: lockfile com sharp exige o binário Linux (sharp-linux-x64 e libvips) com resolved e integrity', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  const lock = (pk) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...pk } });
  const base = { 'node_modules/sharp': { version: '0.35.5', resolved: 'https://r/sharp.tgz', integrity: 'sha512-x' } };
  const linux = { 'node_modules/@img/sharp-linux-x64': { resolved: 'https://r/l.tgz', integrity: 'sha512-y' }, 'node_modules/@img/sharp-libvips-linux-x64': { resolved: 'https://r/v.tgz', integrity: 'sha512-z' } };
  const win = { 'node_modules/@img/sharp-win32-x64': { resolved: 'https://r/w.tgz', integrity: 'sha512-w' } };
  put(r, 'package-lock.json', lock({ ...base, ...win }));
  const sem = node('ci-checks.mjs', ['--root', r]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /sem o binário Linux: falta @img\/sharp-linux-x64/);
  assert.match(sem.stderr, /falta @img\/sharp-libvips-linux-x64/);
  put(r, 'package-lock.json', lock({ ...base, ...win, ...linux }));
  assert.equal(node('ci-checks.mjs', ['--root', r]).status, 0);
  put(r, 'package-lock.json', lock({ ...base, ...win, '@x': {}, 'node_modules/@img/sharp-linux-x64': { resolved: 'https://r/l.tgz' }, 'node_modules/@img/sharp-libvips-linux-x64': linux['node_modules/@img/sharp-libvips-linux-x64'] }));
  assert.match(node('ci-checks.mjs', ['--root', r]).stderr, /falta @img\/sharp-linux-x64/);
  put(r, 'package-lock.json', lock({ 'node_modules/next': { version: '1' } })); // sem sharp: nada a exigir
  assert.equal(node('ci-checks.mjs', ['--root', r]).status, 0);
  rmSync(r, { recursive: true, force: true });
});

test('prova-png: sem sharp instalado devolve 3 com a plataforma e sem caminho de usuário; sem --root usa a pasta atual', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  const x = node('prova-png.mjs', ['--root', r]);
  assert.equal(x.status, 3);
  const j = JSON.parse(x.stdout);
  assert.equal(j.ok, false);
  assert.match(j.plataforma, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(j.erro, 'sharp não carrega nesta plataforma');
  assert.doesNotMatch(x.stdout, /Users[/\\]/);
  rmSync(r, { recursive: true, force: true });
});

test('ensaio-worker-tls: vazamentoDeChave acha o marcador e trechos do corpo da chave (inclusive quebrados em linhas de log); uso e build ausente', async () => {
  const { vazamentoDeChave } = await import('../scripts/ensaio-worker-tls.mjs');
  const corpo = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
  const chave = ['-----BEGIN ' + 'PRIVATE KEY-----', corpo.slice(0, 40), corpo.slice(40), '-----END ' + 'PRIVATE KEY-----'].join('\n');
  assert.deepEqual(vazamentoDeChave('tudo certo; connect ECONNREFUSED 127.0.0.1:5', chave), []);
  assert.deepEqual(vazamentoDeChave('key: ' + "'-----BEGIN " + "PRIVATE KEY-----\n'", chave), ['marcador PRIVATE KEY']);
  // o corpo aparece como no util.inspect: aspas, "+" e \n entre pedaços
  const inspecionado = `key: '${corpo.slice(0, 40)}\n' +\n  '${corpo.slice(40)}\n'`;
  assert.deepEqual(vazamentoDeChave(inspecionado, chave), ['trecho do corpo da chave']);
  const r = tmp();
  assert.equal(node('ensaio-worker-tls.mjs', []).status, 2);
  const sem = node('ensaio-worker-tls.mjs', ['--root', r]);
  assert.equal(sem.status, 3);
  assert.match(sem.stdout, /sem apps\/workers\/dist\/index\.js/);
  rmSync(r, { recursive: true, force: true });
});

// ---- ADR-022 N8: /api/health expõe flags (string[]); healthcheck e smoke conferem; --prova-png do worker
test('healthcheck --expect-flags e --expect-no-flags: conjunto exato, sem ordem; campo ausente reprova (código sem a ADR-022)', async () => {
  const estado = { flags: ['intelligencePessoas'] };
  const s = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: 'abc123', env: 'staging', ...(estado.flags === undefined ? {} : { flags: estado.flags }) }));
  });
  const port = s.address().port;
  try {
    assert.equal((await hc(port, ['--expect-flags', 'intelligencePessoas'])).status, 0);
    assert.equal((await hc(port, ['--expect-flags', ' intelligencePessoas , '])).status, 0, 'espaços e vírgula sobrando');
    const outra = await hc(port, ['--expect-flags', 'openbotDispatch']);
    assert.equal(outra.status, 1);
    assert.match(outra.stdout, /flags=\[intelligencePessoas\] != esperado \[openbotDispatch\]/);
    assert.equal((await hc(port, ['--expect-no-flags'])).status, 1, 'staging com flag ligada reprova a sonda de produção');
    estado.flags = [];
    assert.equal((await hc(port, ['--expect-no-flags'])).status, 0);
    assert.equal((await hc(port, ['--expect-flags', 'intelligencePessoas'])).status, 1);
    estado.flags = ['b', 'a'];
    assert.equal((await hc(port, ['--expect-flags', 'a,b'])).status, 0);
    estado.flags = undefined;
    const sem = await hc(port, ['--expect-no-flags']);
    assert.equal(sem.status, 1);
    assert.match(sem.stdout, /sem o campo flags/);
    assert.equal((await hc(port)).status, 0, 'sem a opção o campo não é exigido');
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('smoke-staging --expect-flags / --expect-no-flags confere o campo flags do /api/health', async () => {
  const estado = { flags: ['intelligencePessoas'] };
  const s = await server((req, res) => {
    res.writeHead(req.url.startsWith('/api/health') ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: 'abc', ...(estado.flags === undefined ? {} : { flags: estado.flags }) }));
  });
  const port = s.address().port;
  const run = (extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-staging.mjs'), '--url', 'http://127.0.0.1:' + port, '--expect-commit', 'abc', ...extra]);
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, stdout }));
  });
  const flagsCheck = (r) => JSON.parse(r.stdout).checagens.find((c) => /flags ligadas/.test(c.nome));
  try {
    assert.equal(flagsCheck(await run(['--expect-flags', 'intelligencePessoas'])).ok, true);
    const errada = flagsCheck(await run(['--expect-flags', 'openbotDispatch']));
    assert.equal(errada.ok, false);
    assert.match(errada.detalhe, /flags=\[intelligencePessoas\]/);
    assert.equal(flagsCheck(await run(['--expect-no-flags'])).ok, false);
    estado.flags = [];
    assert.equal(flagsCheck(await run(['--expect-no-flags'])).ok, true);
    estado.flags = undefined;
    assert.match(flagsCheck(await run(['--expect-no-flags'])).detalhe, /não tem o campo flags/);
    assert.equal((await run([])).stdout.includes('flags ligadas'), false, 'sem a opção não há checagem de flags');
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('prova-png --etapa: uma linha [prova-png:<etapa>] {json} para o log do build e do start da Vertra', () => {
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  const x = node('prova-png.mjs', ['--root', r, '--etapa', 'build']);
  assert.equal(x.status, 3);
  const linhas = x.stdout.trim().split('\n');
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /^\[prova-png:build\] \{"etapa":"build","ok":false,"plataforma":"[a-z0-9]+-[a-z0-9]+"/);
  rmSync(r, { recursive: true, force: true });
});

test('ci-checks: token em teste/doc passa só como placeholder evidente; token real em teste, e qualquer token fora de teste, reprova', async () => {
  const { tokenEhPlaceholder, tokensReais } = await import('../scripts/lib/segredos.mjs');
  // placeholders evidentes (os da ft/backend be051dc): marcador de falsidade no valor, sequência ascendente de 16+ caracteres, poucos caracteres distintos
  for (const p of ['sk-primeira-conta-NAO-VAZAR', 'sk-segunda-conta-nao_vazar', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345678', 'sk-' + 'A'.repeat(32), 'ghp_' + 'ab'.repeat(18), 'AKIAIOSFODNN7EXAMPLE', 'sk-fake-key-for-the-test-1234', 'xoxb-1234567890-exemplo']) assert.equal(tokenEhPlaceholder(p), true, p);
  // aparência de segredo real: mistura aleatória, sem marcador e sem sequência
  for (const p of ['sk-' + 'q8Zr3KmV9tYw2LpX6nBd4HsJ7cFa', 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ2bD4', 'sk-proj-' + 'T3blaH9xQ2mZ8vK1cR7wY5nD4sJ6']) assert.equal(tokenEhPlaceholder(p), false, p);
  const re = /\bsk-[A-Za-z0-9_-]{24,}/;
  const misto = "const A = 'sk-primeira-conta-NAO-VAZAR'; const B = 'sk-" + 'q8Zr3KmV9tYw2LpX6nBd4HsJ7cFa' + "';";
  assert.deepEqual(tokensReais(misto, re, 'packages/x/src/a.test.ts'), ['sk-q8Zr3KmV9tYw2LpX6nBd4HsJ7cFa']);
  assert.equal(tokensReais("'sk-primeira-conta-NAO-VAZAR'", re, 'packages/x/src/a.test.ts').length, 0);
  assert.equal(tokensReais("'sk-primeira-conta-NAO-VAZAR'", re, 'packages/x/src/a.ts').length, 1, 'fora de teste nenhum token passa, nem placeholder');
  assert.equal(tokensReais("sk-primeira-conta-NAO-VAZAR", re, 'docs/guia.md').length, 0, 'documentação com placeholder passa');
  // ponta a ponta no ci-checks
  const r = tmp();
  put(r, 'package.json', '{"name":"x"}');
  put(r, 'packages/openbot/src/__tests__/pilot.test.ts', "const a = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345678'; const b = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';\n");
  put(r, 'packages/intelligence/src/tests/reader-port.test.ts', "const S = { A: 'sk-primeira-conta-NAO-VAZAR' };\n");
  assert.equal(node('ci-checks.mjs', ['--root', r]).status, 0);
  put(r, 'packages/intelligence/src/tests/colado.test.ts', "const real = 'ghp_" + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ2bD4' + "';\n");
  const x = node('ci-checks.mjs', ['--root', r]);
  assert.equal(x.status, 1);
  assert.match(x.stderr, /segredo: token GitHub em packages\/intelligence\/src\/tests\/colado\.test\.ts/);
  rmSync(join(r, 'packages/intelligence/src/tests/colado.test.ts'));
  put(r, 'packages/openbot/src/prod.ts', "export const k = 'sk-primeira-conta-NAO-VAZAR';\n");
  assert.match(node('ci-checks.mjs', ['--root', r]).stderr, /segredo: chave sk- em packages\/openbot\/src\/prod\.ts/);
  rmSync(r, { recursive: true, force: true });
});

// ---- Worker com o job de alertas (Backend 2, af07005): LN_INTELLIGENCE_* amarradas ao release.json.jobsIntelligence
test('guards: jobsProblems exige LN_INTELLIGENCE_ALERTS/PESSOAS = release.json.jobsIntelligence, só staging e com a flag da ADR-022', async () => {
  const { jobsProblems } = await import('../scripts/lib/guards.mjs');
  const ok = { APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas', LN_INTELLIGENCE_ALERTS: 'on', LN_INTELLIGENCE_PESSOAS: 'on' };
  assert.deepEqual(jobsProblems(ok, { jobsIntelligence: ['alertas'] }), []);
  assert.deepEqual(jobsProblems({ APP_ENV: 'staging' }, { jobsIntelligence: [] }), []);
  assert.deepEqual(jobsProblems({ APP_ENV: 'staging' }, {}), [], 'release.json antigo sem o campo');
  assert.match(jobsProblems({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' }, { jobsIntelligence: ['alertas'] }).join('|'), /defina LN_INTELLIGENCE_ALERTS=on/);
  assert.match(jobsProblems({ APP_ENV: 'staging', LN_INTELLIGENCE_ALERTS: 'on' }, { jobsIntelligence: [] }).join('|'), /LN_INTELLIGENCE_ALERTS definida, mas o pacote não liga/);
  assert.match(jobsProblems({ APP_ENV: 'production', LN_INTELLIGENCE_PESSOAS: 'on' }, {}).join('|'), /LN_INTELLIGENCE_PESSOAS definida/);
  assert.match(jobsProblems({ ...ok, LN_INTELLIGENCE_REREAD: 'on' }, { jobsIntelligence: ['alertas'] }).join('|'), /LN_INTELLIGENCE_REREAD definida/);
  assert.match(jobsProblems({ ...ok, LN_FLAGS_ON: '' }, { jobsIntelligence: ['alertas'] }).join('|'), /exige LN_FLAGS_ON com intelligencePessoas/);
  assert.match(jobsProblems({ ...ok, APP_ENV: 'production' }, { jobsIntelligence: ['alertas'] }).join('|'), /só o staging/);
});

test('guards: LN_OPENBOT_PILOT só no staging; LN_FLAGS_ON=openbotDispatch em produção reprova; contrato declara as variáveis do piloto', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  assert.deepEqual(envProblems({ APP_ENV: 'staging', LN_OPENBOT_PILOT: 'on' }, { deploy: true }).filter((m) => /LN_OPENBOT_PILOT/.test(m)), []);
  assert.match(envProblems({ APP_ENV: 'production', LN_OPENBOT_PILOT: 'on' }).join('|'), /LN_OPENBOT_PILOT definida em produção/);
  assert.match(envProblems({ APP_ENV: 'producao', LN_OPENBOT_PILOT: 'on' }).join('|'), /LN_OPENBOT_PILOT definida em produção/);
  assert.match(envProblems({ APP_ENV: 'homolog', LN_OPENBOT_PILOT: 'on' }, { deploy: true }).join('|'), /só existe com APP_ENV=staging/);
  assert.deepEqual(envProblems({ APP_ENV: 'production' }).filter((m) => /OPENBOT/.test(m)), []);
  assert.match(envProblems({ APP_ENV: 'production', LN_FLAGS_ON: 'openbotDispatch' }).join('|'), /LN_FLAGS_ON definida em produção/);
  const c = JSON.parse(readFileSync(join(S, '..', 'vertra', 'env-contract.json'), 'utf8'));
  const nomes = c.variaveis.map((v) => v.nome);
  for (const n of ['OPENBOT_HMAC_SECRET', 'OPENBOT_HMAC_SECRET_PREVIOUS', 'LN_FLAGS_ON', 'LN_OPENBOT_PILOT', 'MLABS_MCP_TOKEN', 'MLABS_MCP_URL', 'MLABS_PROFILE_ID', 'MLABS_CHANNEL_ID']) assert.ok(nomes.includes(n), n);
  for (const n of ['OPENBOT_HMAC_SECRET', 'OPENBOT_HMAC_SECRET_PREVIOUS', 'MLABS_MCP_TOKEN']) assert.equal(c.variaveis.find((v) => v.nome === n).secreto, true, n);
});

test('guards: jobsProblems da releitura (LN_INTELLIGENCE_REREAD + LN_REREAD_SEED + BRIGHTDATA_API_KEY só staging) e contrato declara as variáveis', async () => {
  const { jobsProblems } = await import('../scripts/lib/guards.mjs');
  const ok = { APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas,leitorViaProvedor', LN_INTELLIGENCE_PESSOAS: 'on', LN_INTELLIGENCE_REREAD: 'on', LN_REREAD_SEED: 'seed.public.v7.json', BRIGHTDATA_API_KEY: 'definida-pelo-pm' };
  assert.deepEqual(jobsProblems(ok, { jobsIntelligence: ['releitura'] }), []);
  assert.deepEqual(jobsProblems({ ...ok, LN_INTELLIGENCE_ALERTS: 'on' }, { jobsIntelligence: ['alertas', 'releitura'] }), []);
  assert.match(jobsProblems({ ...ok, LN_REREAD_SEED: '' }, { jobsIntelligence: ['releitura'] }).join('|'), /exige LN_REREAD_SEED/);
  assert.match(jobsProblems({ ...ok, LN_INTELLIGENCE_REREAD: undefined }, { jobsIntelligence: ['releitura'] }).join('|'), /defina LN_INTELLIGENCE_REREAD=on/);
  assert.match(jobsProblems({ ...ok, LN_INTELLIGENCE_ALERTS: 'on' }, { jobsIntelligence: ['releitura'] }).join('|'), /LN_INTELLIGENCE_ALERTS definida, mas o pacote não liga/);
  assert.match(jobsProblems({ APP_ENV: 'staging', LN_REREAD_SEED: 'x' }, {}).join('|'), /LN_REREAD_SEED definida, mas o pacote não liga/);
  assert.match(jobsProblems({ APP_ENV: 'production', BRIGHTDATA_API_KEY: 'x' }, {}).join('|'), /BRIGHTDATA_API_KEY definida fora do staging/);
  assert.deepEqual(jobsProblems({ APP_ENV: 'staging', BRIGHTDATA_API_KEY: 'x' }, {}), [], 'staging com a chave e sem releitura (leitor por provedor) é permitido');
  assert.match(jobsProblems({ ...ok, APP_ENV: 'production' }, { jobsIntelligence: ['releitura'] }).join('|'), /só o staging/);
  assert.match(jobsProblems({ ...ok, LN_FLAGS_ON: '' }, { jobsIntelligence: ['releitura'] }).join('|'), /exige LN_FLAGS_ON com intelligencePessoas/);
  const c = JSON.parse(readFileSync(join(S, '..', 'vertra', 'env-contract.json'), 'utf8'));
  for (const n of ['LN_INTELLIGENCE_ALERTS', 'LN_INTELLIGENCE_PESSOAS', 'LN_INTELLIGENCE_REREAD', 'LN_REREAD_SEED', 'BRIGHTDATA_API_KEY']) assert.ok(c.variaveis.some((v) => v.nome === n && v.so_staging), n);
  assert.equal(c.variaveis.find((v) => v.nome === 'BRIGHTDATA_API_KEY').secreto, true);
});

test('prova-flags-producao: resolvedor que recusa a flag em produção passa; resolvedor frouxo reprova', () => {
  const mk = (frouxo) => {
    const r = tmp();
    mkdirSync(join(r, 'packages', 'contracts', 'src'), { recursive: true });
    writeFileSync(join(r, 'packages', 'contracts', 'src', 'flags.ts'), `
const OK = ['intelligencePessoas'];
export function resolveFlags(env) {
  const amb = String(env.APP_ENV ?? '').toLowerCase();
  const nomes = String(env.LN_FLAGS_ON ?? '').split(',').filter(Boolean);
  for (const n of nomes) {
    if (!OK.includes(n)) throw new Error('Subida recusada: flag desconhecida ' + n + ' em LN_FLAGS_ON (ADR-022)');
    if (amb === 'production' && ${frouxo ? 'false' : 'true'}) throw new Error('Subida recusada: flag ' + n + ' sem decisão para production (ADR-022)');
  }
  return { state: Object.fromEntries(nomes.map((n) => [n, true])), logLine: nomes.length ? 'flags ligadas: ' + nomes.join(',') : 'flags ligadas: nenhuma' };
}
`);
    return r;
  };
  const bom = node('prova-flags-producao.mjs', ['--root', mk(false)]);
  assert.equal(bom.status, 0, bom.stdout + bom.stderr);
  assert.equal(JSON.parse(bom.stdout).ok, true);
  const ruim = node('prova-flags-producao.mjs', ['--root', mk(true)]);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stdout, /"ok":false/);
  assert.equal(node('prova-flags-producao.mjs', []).status, 2);
});

test('smoke-staging: avaliarReady com o campo migracoes (ft/backend-2 19cd21e)', async () => {
  const { avaliarReady } = await import('../scripts/smoke-staging.mjs');
  const base = { status: 'ok', mode: 'completo', db: 'ok', redis: 'ok' };
  assert.deepEqual(avaliarReady(base), [], 'build anterior, sem o campo');
  assert.deepEqual(avaliarReady({ ...base, migracoes: 'ok' }), []);
  assert.match(avaliarReady({ ...base, migracoes: 'pendentes' }).join('|'), /migracoes=pendentes/);
  assert.match(avaliarReady(base, { exigirMigracoes: true }).join('|'), /campo migracoes ausente/);
  assert.deepEqual(avaliarReady({ ...base, migracoes: 'ok' }, { exigirMigracoes: true }), []);
});

test('smoke-staging --rollback-app-sem-banco: aceita só o 503 migracoes_divergentes do /api/ready', async () => {
  let corpo = { status: 'indisponivel', motivo: 'migracoes_divergentes' };
  const s = await server((req, res) => {
    if (req.url.split('?')[0] === '/api/ready') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify(corpo)); }
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  const run = (extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-staging.mjs'), '--url', 'http://127.0.0.1:' + port, ...extra]);
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', () => resolve(JSON.parse(stdout).checagens.find((x) => /^ready:/.test(x.nome))));
  });
  try {
    assert.equal((await run(['--rollback-app-sem-banco'])).ok, true);
    assert.equal((await run([])).ok, false, 'sem a opção o 503 reprova');
    corpo = { status: 'indisponivel', motivo: 'migracoes_pendentes' };
    assert.equal((await run(['--rollback-app-sem-banco'])).ok, false, 'outro motivo continua reprovando');
    corpo = { status: 'indisponivel' };
    assert.equal((await run(['--rollback-app-sem-banco'])).ok, false, '503 sem motivo reprova');
  } finally { s.close(); }
});

test('medir-hops: borda que reescreve usa a posição do cliente; borda que anexa usa contagem − 1; instável, desligado e diferente do atual reprovam', async () => {
  const { resumir } = await import('../scripts/medir-hops.mjs');
  const c = (count, pos = null, match = null) => ({ count, match, pos });
  const cinco = (x) => [x, x, x, x, x];
  // Medição real de 23/11 (staging): contagem 3 com e sem entrada falsa, cliente na 3ª posição da direita.
  const real = resumir(cinco(c(3, '3', 'true')), cinco(c(3)), 3, cinco(c(3, '3', 'true')));
  assert.equal(real.ok, true); assert.equal(real.borda, 'reescreve'); assert.equal(real.hopsMedido, 3); assert.equal(real.metodo, 'posicao_do_cliente');
  assert.equal(real.clienteForjaEntradas, false); assert.equal(real.igualAoAtual, true);
  assert.equal(resumir(cinco(c(3, '3')), cinco(c(3)), 2).ok, false, 'medido 3, atual 2');
  assert.equal(resumir(cinco(c(3)), cinco(c(3)), 3).motivo, 'borda_reescreve_sem_posicao_do_cliente', 'reescreve sem CF-Connecting-IP é inconclusivo');
  assert.equal(resumir(cinco(c(3, 'none')), cinco(c(3)), 3).motivo, 'borda_reescreve_sem_posicao_do_cliente');
  assert.match(resumir(cinco(c(3, '3')), cinco(c(3)), 3, cinco(c(6, '3'))).aviso, /nao confie na posicao/);
  // Borda que anexa: contagem com falso = sem falso + 1.
  const anexa = resumir([c(4, '3'), c(4, '3')], [c(3), c(3)], 3);
  assert.equal(anexa.ok, true); assert.equal(anexa.borda, 'anexa'); assert.equal(anexa.hopsMedido, 3); assert.equal(anexa.metodo, 'contagem_menos_1'); assert.equal(anexa.aviso, undefined);
  assert.equal(resumir([c(3), c(3)], [c(2), c(2)], 3).ok, false, 'medido 2, atual 3');
  assert.equal(resumir([c(4), c(5)], [c(3)], undefined).motivo, 'contagem_instavel');
  assert.equal(resumir([c(null), c(null)], [], 3).motivo, 'diagnostico_desligado');
  assert.equal(resumir([c(1)], [c(0)], undefined).motivo, 'hops_fora_de_1_a_10');
  assert.equal(resumir([c(4, '2')], [c(3)], undefined).aviso, 'posicao_do_cliente_diferente_de_contagem_menos_1: confira a topologia antes de gravar');
  assert.doesNotMatch(JSON.stringify(real), /d+.d+.d+.d+/, 'nenhum IP na saída');
});

test('conferir-staging-admin: avaliar aprova só com um admin .invalid, 2º fator ativo, sem sessão e com auditoria; recusa fora do staging', async () => {
  const { avaliar } = await import('../scripts/conferir-staging-admin.mjs');
  const ok = { admins: 1, adminsInvalid: 1, adminsComDoisFatores: 1, doisFatoresVerificados: 1, sessoes: 0, auditorias: 1 };
  assert.equal(avaliar(ok).ok, true);
  for (const [k, v] of [['admins', 2], ['adminsInvalid', 0], ['adminsComDoisFatores', 0], ['doisFatoresVerificados', 0], ['sessoes', 1], ['auditorias', 0]]) assert.equal(avaliar({ ...ok, [k]: v }).ok, false, k);
  const x = node('conferir-staging-admin.mjs', [], { env: { ...process.env, APP_ENV: 'production' } });
  assert.equal(x.status, 2);
  assert.match(x.stderr, /APP_ENV tem de ser staging/);
});

test('package-web --bench-graph: só worker, só staging; --bench-args em lista fechada separada por vírgula', () => {
  const base = ['--repo', '.', '--commit', 'HEAD', '--out', join(tmp(), 'nada')];
  const web = node('package-web.mjs', [...base, '--profile', 'staging', '--bench-graph']);
  assert.equal(web.status, 2); assert.match(web.stderr, /--bench-graph só vale para o worker/);
  const prod = node('package-web.mjs', [...base, '--profile', 'production', '--app', 'workers', '--bench-graph']);
  assert.equal(prod.status, 2); assert.match(prod.stderr, /só vale no perfil staging/);
  const solto = node('package-web.mjs', [...base, '--profile', 'staging', '--app', 'workers', '--bench-args', 'replace']);
  assert.equal(solto.status, 2); assert.match(solto.stderr, /--bench-args exige --bench-graph/);
  for (const ruim of ['scale=9;rm', 'scale=2', 'rm -rf', 'schema=intelligence', 'with-reference;x']) {
    const x = node('package-web.mjs', [...base, '--profile', 'staging', '--app', 'workers', '--bench-graph', '--bench-args', ruim]);
    assert.equal(x.status, 2, ruim); assert.match(x.stderr, /argumento não permitido/, ruim);
  }
});

test('package-web --bench-fumaca exige --bench-graph', () => {
  const x = node('package-web.mjs', ['--repo', '.', '--commit', 'HEAD', '--out', join(tmp(), 'nada'), '--profile', 'staging', '--app', 'workers', '--bench-fumaca']);
  assert.equal(x.status, 2); assert.match(x.stderr, /--bench-fumaca exige --bench-graph/);
});

test('check-ln-links: link @ln/* para dentro do worktree passa; para outro worktree, node_modules atalhado e link quebrado reprovam', async () => {
  const { symlinkSync } = await import('node:fs');
  const { checarWorktree, dentro } = await import('../scripts/check-ln-links.mjs');
  const base = tmp();
  const mk = (nome) => { const r = join(base, nome); mkdirSync(join(r, 'packages', 'auth'), { recursive: true }); writeFileSync(join(r, 'package.json'), '{}'); mkdirSync(join(r, 'node_modules', '@ln'), { recursive: true }); return r; };
  const a = mk('wt-a'), b = mk('wt-b');
  symlinkSync(join(a, 'packages', 'auth'), join(a, 'node_modules', '@ln', 'auth'), 'junction');
  const ok = checarWorktree(a);
  assert.equal(ok.ok, true); assert.equal(ok.links, 1);
  // link do worktree b apontando para os packages do worktree a: FALSO resultado de teste
  symlinkSync(join(a, 'packages', 'auth'), join(b, 'node_modules', '@ln', 'auth'), 'junction');
  const fora = checarWorktree(b);
  assert.equal(fora.ok, false); assert.equal(fora.fora[0].pacote, '@ln/auth');
  // node_modules inteiro atalhado para o de outro worktree
  const c = join(base, 'wt-c'); mkdirSync(join(c, 'packages'), { recursive: true }); writeFileSync(join(c, 'package.json'), '{}');
  symlinkSync(join(a, 'node_modules'), join(c, 'node_modules'), 'junction');
  const atalho = checarWorktree(c);
  assert.equal(atalho.ok, false); assert.ok(atalho.fora.some((x) => x.pacote === '(node_modules inteiro)'));
  // link quebrado
  const d = mk('wt-d'); symlinkSync(join(base, 'nao-existe'), join(d, 'node_modules', '@ln', 'x'), 'junction');
  assert.equal(checarWorktree(d).ok, false);
  // sem node_modules: só aviso (exigir=false) ou reprova (exigir=true)
  const e = join(base, 'wt-e'); mkdirSync(e); writeFileSync(join(e, 'package.json'), '{}');
  assert.equal(checarWorktree(e).ok, true); assert.equal(checarWorktree(e, { exigir: true }).ok, false);
  assert.equal(dentro('/x/wt-a', '/x/wt-a/packages/auth'), true); assert.equal(dentro('/x/wt-a', '/x/wt-b/packages/auth'), false);
  // CLI: código de saída
  assert.equal(node('check-ln-links.mjs', ['--root', a]).status, 0);
  assert.equal(node('check-ln-links.mjs', ['--root', b]).status, 1);
});

test('limpar-node-modules: remove o node_modules sem atravessar junction (o alvo fica intacto); sem --confirmar só mostra o plano', async () => {
  const { symlinkSync, existsSync: ex, readFileSync: rf, lstatSync: ls } = await import('node:fs');
  const base = tmp();
  const a = join(base, 'wt-a'); mkdirSync(join(a, 'packages', 'auth'), { recursive: true }); writeFileSync(join(a, 'package.json'), '{}'); writeFileSync(join(a, 'packages', 'auth', 'index.ts'), 'export const ok = 1;');
  mkdirSync(join(a, 'node_modules', 'pkg'), { recursive: true }); writeFileSync(join(a, 'node_modules', 'pkg', 'x.js'), 'x');
  // wt-b: node_modules REAL com @ln/auth = junction para os packages de wt-a, mais arquivos de verdade
  const b = join(base, 'wt-b'); mkdirSync(join(b, 'node_modules', '@ln'), { recursive: true }); writeFileSync(join(b, 'package.json'), '{}'); writeFileSync(join(b, 'node_modules', 'real.js'), 'r');
  symlinkSync(join(a, 'packages', 'auth'), join(b, 'node_modules', '@ln', 'auth'), 'junction');
  // wt-c: node_modules INTEIRO é junction para o de wt-a
  const c = join(base, 'wt-c'); mkdirSync(c); writeFileSync(join(c, 'package.json'), '{}');
  symlinkSync(join(a, 'node_modules'), join(c, 'node_modules'), 'junction');
  const plano = node('limpar-node-modules.mjs', ['--root', b]);
  assert.equal(plano.status, 0); assert.equal(JSON.parse(plano.stdout).apagou, false); assert.ok(ex(join(b, 'node_modules', 'real.js')), 'sem --confirmar nada some');
  const r1 = node('limpar-node-modules.mjs', ['--root', b, '--confirmar']);
  assert.equal(r1.status, 0, r1.stderr); assert.equal(JSON.parse(r1.stdout).links, 1);
  assert.equal(ex(join(b, 'node_modules')), false, 'node_modules do wt-b sumiu');
  assert.equal(rf(join(a, 'packages', 'auth', 'index.ts'), 'utf8'), 'export const ok = 1;', 'o ALVO da junction (packages de wt-a) está intacto');
  const r2 = node('limpar-node-modules.mjs', ['--root', c, '--confirmar']);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(ex(join(c, 'node_modules')), false, 'o atalho foi removido');
  assert.equal(rf(join(a, 'node_modules', 'pkg', 'x.js'), 'utf8'), 'x', 'o node_modules do alvo está intacto');
  assert.equal(node('limpar-node-modules.mjs', ['--root', join(base, 'nao-existe')]).status, 2);
  assert.ok(!ls(join(a, 'packages', 'auth')).isSymbolicLink());
});

test('smoke-producao: produção limpa e não indexável passa; demonstração, flag ligada, indexável antes do go-live e Studio aberto reprovam', async () => {
  const SHA = 'a'.repeat(40);
  const estado = { demo: false, flags: [], indexavel: false, studioAberto: false, env: 'production', pessoas: false };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const html = (c, b, h = {}) => { res.writeHead(c, { 'content-type': 'text/html', ...h }); res.end(b); };
    const rot = estado.demo ? '[DEMO · staging] ' : '';
    const meta = estado.indexavel ? '' : '<meta name="robots" content="noindex, nofollow"/>';
    if (u === '/api/health') return json(200, { status: 'ok', version: SHA, env: estado.env, flags: estado.flags });
    if (u === '/api/ready') return json(200, { status: 'ok', mode: 'completo', db: 'ok', redis: 'ok', migracoes: 'ok' });
    if (u === '/api/publico/site') return json(200, { nome: 'Loyalty News' });
    if (u === '/api/publico/editorias') return json(200, { data: Array.from({ length: 10 }, (_, i) => ({ slug: 'e' + i })) });
    if (u === '/api/publico/materias') return json(200, { data: estado.demo ? [{ slug: 'a', titulo: rot + 'x' }] : [], total: 0 });
    if (u === '/api/publico/agenda') return json(200, { data: [] });
    if (u === '/api/publico/intelligence/pessoas' || u === '/api/publico/intelligence/moves') return json(200, { data: [], total: 0, disponivel: estado.pessoas });
    if (['/', '/noticias', '/midia-kit', '/intelligence'].includes(u)) return html(200, meta + rot + 'ok');
    if (u === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(estado.indexavel ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n'); }
    if (u === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(estado.indexavel ? '<urlset><url><loc>https://x/</loc></url></urlset>' : '<urlset></urlset>'); }
    if (u === '/feed.xml') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end('<rss>' + (estado.indexavel ? '<item></item>' : '') + '</rss>'); }
    if (u === '/studio') { if (estado.studioAberto) return html(200, 'painel'); res.writeHead(307, { location: '/studio/entrar?motivo=NO_SESSION' }); return res.end(); }
    if (u === '/studio/entrar') return html(200, 'login');
    res.writeHead(404); res.end();
  });
  const port = s.address().port;
  const run = (extra = []) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-producao.mjs'), '--url', 'http://127.0.0.1:' + port, '--expect-commit', SHA, ...extra]);
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, j: stdout ? JSON.parse(stdout) : null }));
  });
  try {
    const ok = await run();
    assert.equal(ok.status, 0, JSON.stringify(ok.j?.checagens?.filter((c) => !c.ok)));
    estado.demo = true; assert.equal((await run()).status, 1, 'demonstração em produção reprova'); estado.demo = false;
    estado.flags = ['intelligencePessoas']; assert.equal((await run()).status, 1, 'flag ligada reprova'); estado.flags = [];
    estado.env = 'staging'; assert.equal((await run()).status, 1, 'APP_ENV diferente de production reprova'); estado.env = 'production';
    estado.pessoas = true; assert.equal((await run()).status, 1, 'pessoas ligadas reprovam'); estado.pessoas = false;
    estado.studioAberto = true; assert.equal((await run()).status, 1, 'Studio sem login reprova'); estado.studioAberto = false;
    estado.indexavel = true; assert.equal((await run()).status, 1, 'indexável antes do go-live reprova');
    assert.equal((await run(['--indexavel'])).status, 0, 'com --indexavel (go-live) passa'); estado.indexavel = false;
    assert.equal((await run(['--indexavel'])).status, 1, 'não indexável com --indexavel reprova');
  } finally { s.close(); }
});

test('verificar-cache-headers: avaliar 60s e no-store; verificar contra servidor falso (pessoas ficam no-store, sitemap público reprova)', async () => {
  const { avaliar, verificar, CACHE_60S, NO_STORE } = await import('../scripts/verificar-cache-headers.mjs');
  assert.deepEqual(avaliar('60s', 'public, s-maxage=60, stale-while-revalidate=300', null), []);
  assert.match(avaliar('60s', 'private, no-cache, no-store, max-age=0, must-revalidate', null).join('|'), /falta s-maxage=60.*tem no-store/);
  assert.match(avaliar('60s', 'public, s-maxage=60, stale-while-revalidate=300', 'sid=1').join('|'), /Set-Cookie/);
  assert.match(avaliar('60s', 'public, s-maxage=600, stale-while-revalidate=300', null).join('|'), /falta s-maxage=60/, 's-maxage=600 não é 60');
  assert.deepEqual(avaliar('no-store', 'private, no-cache, no-store, max-age=0', null), []);
  assert.match(avaliar('no-store', 'public, max-age=0, must-revalidate', null).join('|'), /esperado no-store/);
  assert.match(avaliar('no-store', undefined, null).join('|'), /sem Cache-Control/);
  const pessoas = /^\/(intelligence|moves)/;
  assert.ok(CACHE_60S.every((r) => !pessoas.test(r)), 'nenhuma rota com pessoas na lista de cache');
  assert.ok(NO_STORE.some((r) => r.startsWith('/intelligence/pessoas')) && NO_STORE.some((r) => r.startsWith('/moves')));
  const estado = { sitemap: 'public, max-age=0, must-revalidate', pessoasCC: 'private, no-cache, no-store, max-age=0' };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    const h = (cc) => { res.writeHead(200, { 'cache-control': cc }); res.end('x'); };
    if (CACHE_60S.map((r) => r.replace('{editoria}', 'mercado')).includes(u)) return h('public, s-maxage=60, stale-while-revalidate=300');
    if (u === '/sitemap.xml') return h(estado.sitemap);
    if (/^\/(intelligence|moves)/.test(u)) return h(estado.pessoasCC);
    return h('private, no-cache, no-store, max-age=0');
  });
  try {
    const url = 'http://127.0.0.1:' + s.address().port;
    const r1 = await verificar({ url, valores: { editoria: 'mercado' } });
    assert.equal(r1.violacoes, 1, JSON.stringify(r1.resultados.filter((x) => !x.ok)));
    assert.equal(r1.resultados.find((x) => !x.ok).rota, '/sitemap.xml');
    estado.sitemap = 'private, no-store'; estado.pessoasCC = 'public, s-maxage=60, stale-while-revalidate=300';
    const r2 = await verificar({ url, valores: { editoria: 'mercado' } });
    assert.ok(r2.resultados.filter((x) => !x.ok).every((x) => /intelligence|moves/.test(x.rota)), 'pessoas com cache público reprovam');
    assert.ok(r2.violacoes >= 5);
  } finally { s.close(); }
});

test('smoke-producao --expect-cache: reprova sem a política de cache e passa com ela', async () => {
  const SHA = 'b'.repeat(40);
  const pessoas = /^\/(intelligence|moves|noticia|agenda\/|sitemap)/;
  const cacheavel = new Set(['/', '/noticias', '/editoria/mercado', '/analises', '/entrevistas', '/opiniao', '/flash', '/em-alta', '/agenda']);
  const estado = { politica: false };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    const cc = estado.politica ? (cacheavel.has(u) ? 'public, s-maxage=60, stale-while-revalidate=30' : pessoas.test(u) ? 'private, no-cache, no-store' : undefined) : undefined;
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', ...(cc ? { 'cache-control': cc } : {}) }); res.end(JSON.stringify(o)); };
    const html = (c, b, h = {}) => { res.writeHead(c, { 'content-type': 'text/html', ...(cc ? { 'cache-control': cc } : {}), ...h }); res.end(b); };
    if (u === '/api/health') return json(200, { status: 'ok', version: SHA, env: 'production', flags: [] });
    if (u === '/api/ready') return json(200, { status: 'ok', mode: 'completo', db: 'ok', redis: 'ok' });
    if (u === '/api/publico/site') return json(200, { nome: 'LN' });
    if (u === '/api/publico/editorias') return json(200, { data: Array.from({ length: 10 }, (_, i) => ({ slug: 'e' + i })) });
    if (u === '/api/publico/materias' || u === '/api/publico/agenda') return json(200, { data: [] });
    if (u.startsWith('/api/publico/intelligence/')) return json(200, { data: [], total: 0, disponivel: false });
    if (['/', '/noticias', '/midia-kit', '/intelligence'].includes(u)) return html(200, '<meta name="robots" content="noindex"/>ok');
    if (u === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }
    if (u === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml', ...(cc ? { 'cache-control': 'private, no-store' } : {}) }); return res.end('<urlset></urlset>'); }
    if (u === '/feed.xml') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end('<rss></rss>'); }
    if (u === '/studio') { res.writeHead(307, { location: '/studio/entrar' }); return res.end(); }
    if (u === '/studio/entrar') return html(200, 'login');
    return html(200, 'ok');
  });
  const run = (extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-producao.mjs'), '--url', 'http://127.0.0.1:' + s.address().port, '--expect-commit', SHA, ...extra]);
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, j: JSON.parse(stdout) }));
  });
  try {
    assert.equal((await run([])).j.checagens.some((x) => /^cache:/.test(x.nome)), false, 'sem a opção não confere cache');
    const sem = await run(['--expect-cache']);
    assert.equal(sem.status, 1); assert.ok(sem.j.checagens.some((x) => /^cache:/.test(x.nome) && !x.ok));
    estado.politica = true;
    const com = await run(['--expect-cache']);
    assert.ok(com.j.checagens.find((x) => /^cache:/.test(x.nome))?.ok, JSON.stringify(com.j.checagens.filter((x) => !x.ok)));
  } finally { s.close(); }
});

test('start-web: o next start roda de DENTRO de apps/web, sem o argumento de pasta (next.config.ts com import .ts irmão não carrega a partir da raiz)', async () => {
  const { nextStartInvocation } = await import('../scripts/start-web.mjs');
  const inv = nextStartInvocation('/app', '/app/node_modules/next/dist/bin/next', 80, '0.0.0.0');
  assert.deepEqual(inv.args, ['/app/node_modules/next/dist/bin/next', 'start', '-p', '80', '-H', '0.0.0.0']);
  assert.equal(inv.cwd.split(sep).join('/').replace(/^[A-Za-z]:/, ''), '/app/apps/web');
  assert.ok(!inv.args.includes('apps/web'), 'sem o argumento de pasta');
});

test('guard-env (linha 1 do piloto): em produção cada variável do piloto recusa com o NOME dela; em staging aceita; o contrato marca as quatro como só_staging', async () => {
  const { envProblems } = await import('../scripts/lib/guards.mjs');
  const PROD = { APP_ENV: 'production' };
  const casos = [
    [{ LN_FLAGS_ON: 'openbotDispatch' }, /LN_FLAGS_ON definida em produção.*openbotDispatch.*nunca liga em produção/],
    [{ LN_FLAGS_ON: 'intelligencePessoas,openbotDispatch' }, /LN_FLAGS_ON definida em produção.*openbotDispatch/],
    [{ LN_OPENBOT_PILOT: '1' }, /LN_OPENBOT_PILOT definida em produção/],
    [{ OPENBOT_HMAC_SECRET: 'valor-ficticio-de-teste' }, /OPENBOT_HMAC_SECRET definida em produção/],
    [{ OPENBOT_HMAC_SECRET_PREVIOUS: 'valor-ficticio-de-teste' }, /OPENBOT_HMAC_SECRET_PREVIOUS definida em produção/],
    [{ LN_OPENBOT_PILOT_WIRING: 'valor-ficticio-de-teste' }, /LN_OPENBOT_PILOT_WIRING definida em produção/],
    [{ LN_OPENBOT_GATEWAY_TIMEOUT_MS: '60000' }, /LN_OPENBOT_GATEWAY_TIMEOUT_MS definida em produção/],
  ];
  for (const [vars, esperado] of casos) {
    const msg = envProblems({ ...PROD, ...vars }, { deploy: true }).join('|');
    assert.match(msg, esperado, JSON.stringify(Object.keys(vars)));
    assert.doesNotMatch(msg, /valor-ficticio-de-teste/, 'a mensagem nunca repete o valor');
    assert.doesNotMatch(envProblems({ APP_ENV: 'staging', ...vars }, { deploy: true }).join('|'), /definida em produção/, 'staging aceita');
  }
  assert.deepEqual(envProblems({ APP_ENV: 'production' }, { deploy: true }).filter((m) => /OPENBOT|LN_FLAGS_ON|PILOT/.test(m)), [], 'produção limpa não reprova');
  assert.match(envProblems({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' }, { deploy: true }).join('|'), /LN_FLAGS_ON definida em produção/);
  assert.doesNotMatch(envProblems({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' }, { deploy: true }).join('|'), /openbotDispatch/, 'só cita openbotDispatch quando ela está no valor');
  const c = JSON.parse(readFileSync(join(S, '..', 'vertra', 'env-contract.json'), 'utf8'));
  for (const n of ['OPENBOT_HMAC_SECRET', 'OPENBOT_HMAC_SECRET_PREVIOUS', 'LN_FLAGS_ON', 'LN_OPENBOT_PILOT', 'LN_OPENBOT_PILOT_WIRING', 'LN_OPENBOT_GATEWAY_TIMEOUT_MS']) assert.equal(c.variaveis.find((v) => v.nome === n)?.so_staging, true, `${n} so_staging`);
  assert.equal(c.variaveis.find((v) => v.nome === 'OPENBOT_HMAC_SECRET').secreto, true);
  assert.doesNotMatch(JSON.stringify(c), /"valor"\s*:\s*"[^"]{8,}"/, 'o contrato só tem nomes, nenhum valor');
});

test('guard-env (item 5 do piloto): a CLI real sai 1 em produção com QUALQUER variável do piloto e 0 sem elas (controle negativo); staging aceita; toda variável OPENBOT/PILOT lida pelo código do piloto está no contrato como só_staging', () => {
  const run = (env) => node('guard-env.mjs', ['--deploy'], { env: { ...cleanEnv(), ...env } });
  const piloto = { LN_OPENBOT_PILOT: '1', OPENBOT_HMAC_SECRET: 'valor-ficticio-de-teste', OPENBOT_HMAC_SECRET_PREVIOUS: 'valor-ficticio-de-teste', LN_OPENBOT_PILOT_WIRING: '@ln/outro', LN_OPENBOT_GATEWAY_TIMEOUT_MS: '60000' };
  assert.equal(run({ APP_ENV: 'production' }).status, 0, 'controle negativo: produção sem variável do piloto passa');
  for (const [nome, valor] of Object.entries(piloto)) {
    const r = run({ APP_ENV: 'production', [nome]: valor });
    assert.equal(r.status, 1, nome + ' em produção deve reprovar');
    assert.ok((r.stderr + r.stdout).includes(nome), 'a mensagem cita o nome ' + nome);
    assert.ok(!(r.stderr + r.stdout).includes(valor) || valor === '1' || valor === '60000', 'a mensagem não repete o valor de ' + nome);
    assert.equal(run({ APP_ENV: 'staging', [nome]: valor }).status, 0, nome + ' em staging é aceita');
  }
  assert.equal(run({ APP_ENV: 'production', ...piloto }).status, 1, 'todas juntas em produção reprovam');
  const c = JSON.parse(readFileSync(join(S, '..', 'vertra', 'env-contract.json'), 'utf8'));
  const nomes = new Set(c.variaveis.map((v) => v.nome));
  for (const n of Object.keys(piloto)) assert.ok(nomes.has(n) && c.variaveis.find((v) => v.nome === n).so_staging === true, n + ' no contrato como só_staging');
});

test('memoria-build: o padrão do build é 2048 (24/11/2026): sem produção, o web sobe a 2048 (pico = used + 1536) e volta; produção em regime (7552) NÃO cabe', async () => {
  const { lerPerfil, avaliar, passos, BUILD_PADRAO } = await import('../scripts/memoria-build.mjs');
  assert.equal(BUILD_PADRAO, 2048);
  const base = perfilFalso();
  const apps = base.applications.filter((a) => !a.id.startsWith('prod-'));
  const databases = base.databases.filter((d) => d.id !== 'd4');
  const soma = apps.reduce((t, a) => t + a.ram, 0) + databases.reduce((t, d) => t + d.ram, 0);
  const stg = lerPerfil({ ...base, applications: apps, databases, plan: { name: 'pro-8', memory: { limit: 8192, used: soma } } });
  const a = avaliar(stg, 'stg-web', { fase: 'antes' });
  assert.equal(a.ok, true, a.problemas.join('|'));
  const pico = soma + (2048 - 512);
  const st = passos(stg, 'stg-web', { pacote: 'C:/pacote' });
  assert.deepEqual(st.map((x) => x.usedEsperado), [soma, pico, pico, pico, pico, pico, soma, soma]);
  assert.deepEqual(st[1].args, { id: 'stg-web', memory: 2048 });
  assert.match(st[1].nota, /4096 MB/);
  const prod = avaliar(lerPerfil(perfilFalso()), 'prod-web', { fase: 'antes' });
  assert.equal(prod.ok, false);
  assert.match(prod.problemas.join('|'), /pico seria 9088 de 8192/);
});

test('saude estável (QA 8, 24/11): saudeEstavel e configSaude; um 200 seguido de queda, versão que muda ou erro reprovam', async () => {
  const { saudeEstavel, configSaude } = await import('../scripts/lib/saude.mjs');
  assert.deepEqual(configSaude({}), { n: 3, intervaloMs: 20 }, 'padrão: 3 amostras; intervalo vem do LN_SAUDE_INTERVALO_MS dos testes');
  assert.deepEqual(configSaude({ consecutivas: '5', intervalo: '100' }), { n: 5, intervaloMs: 100 });
  assert.equal(configSaude({ consecutivas: '999' }).n, 3, 'fora de 1..20 volta ao padrão');
  const sha = 'a'.repeat(40);
  const ok = (v = sha) => async () => ({ status: 200, j: { status: 'ok', version: v } });
  const sem = async () => {};
  assert.equal((await saudeEstavel({ amostrar: ok(), n: 3, commit: sha, dormir: sem })).ok, true);
  // a janela do achado: 200 uma vez, depois o servidor cai
  let k = 0;
  const caiu = await saudeEstavel({ amostrar: async () => { k++; if (k === 1) return { status: 200, j: { status: 'ok', version: sha } }; throw Object.assign(new Error('x'), { name: 'TypeError' }); }, n: 3, commit: sha, dormir: sem });
  assert.equal(caiu.ok, false); assert.match(caiu.problemas.join('|'), /amostra 2 de 3: a requisição falhou/);
  let m = 0;
  const cinco = await saudeEstavel({ amostrar: async () => { m++; return m === 1 ? { status: 200, j: { status: 'ok', version: sha } } : { status: 503, j: { status: 'indisponivel' } }; }, n: 3, dormir: sem });
  assert.equal(cinco.ok, false); assert.match(cinco.problemas.join('|'), /HTTP 503/);
  let v = 0;
  const muda = await saudeEstavel({ amostrar: async () => ({ status: 200, j: { status: 'ok', version: v++ === 0 ? 'a'.repeat(40) : 'b'.repeat(40) } }), n: 2, dormir: sem });
  assert.equal(muda.ok, false); assert.match(muda.problemas.join('|'), /a versão mudou entre as amostras/);
  assert.match((await saudeEstavel({ amostrar: ok('c'.repeat(40)), n: 2, commit: sha, dormir: sem })).problemas.join('|'), /version=.* != /);
  assert.equal((await saudeEstavel({ amostrar: ok(), n: 1, dormir: sem })).ok, true, 'n=1 é o comportamento antigo (não use no aceite)');
});

test('healthcheck CLI e smoke-producao exigem N 200 seguidos: um 200 logo depois do start e depois queda REPROVA (--consecutivas 1 mostra o risco antigo)', async () => {
  const SHA = 'd'.repeat(40);
  const estado = { vezes: 0, quedaApos: 1 };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/api/health') {
      estado.vezes++;
      if (estado.vezes > estado.quedaApos) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"status":"indisponivel"}'); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ status: 'ok', version: SHA, env: 'production', flags: [] }));
    }
    res.writeHead(404); res.end();
  });
  try {
    const port = s.address().port;
    // 200 uma vez e depois 503: 3 seguidas reprovam; 1 aprova (o risco que o QA 8 achou)
    estado.vezes = 0;
    const tres = await hc(port, ['--expect-commit', SHA, '--consecutivas', '3']);
    assert.equal(tres.status, 1, tres.stdout); assert.match(tres.stdout, /instável/);
    estado.vezes = 0;
    const um = await hc(port, ['--expect-commit', SHA, '--consecutivas', '1']);
    assert.equal(um.status, 0, um.stdout);
    assert.match(um.stdout, /não prova estabilidade/);
    // estável de verdade: passa e informa
    estado.vezes = 0; estado.quedaApos = 99;
    const estavel = await hc(port, ['--expect-commit', SHA]);
    assert.equal(estavel.status, 0, estavel.stdout);
    assert.deepEqual(JSON.parse(estavel.stdout).estabilidade, { consecutivas: 3, intervaloMs: 20, ok: true });
    // smoke-producao: a checagem de health reprova quando cai depois do 1º 200
    estado.vezes = 0; estado.quedaApos = 1;
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, [join(S, 'smoke-producao.mjs'), '--url', 'http://127.0.0.1:' + port, '--expect-commit', SHA]);
      let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(JSON.parse(out)));
    });
    const h = r.checagens.find((x) => /^health: \d+ resposta/.test(x.nome));
    assert.ok(h && h.ok === false, JSON.stringify(h)); assert.match(h.detalhe, /amostra 2 de 3/);
  } finally { s.close(); }
});

test('pacote de worker leva infra/vertra/bindings.json (as CLIs do worker o importam no build) e o ensaio-worker-pacote recusa manifesto que não é de worker', () => {
  const src = readFileSync(join(S, 'package-web.mjs'), 'utf8');
  assert.match(src, /if \(appKey === 'workers'\) INCLUDE\.push\('infra\/vertra\/bindings\.json'\)/);
  assert.match(src, /pacote de worker sem infra\/vertra\/bindings\.json/);
  const d = tmp();
  put(d, 'm.json', JSON.stringify({ tipo: 'web', ferramentas: { create_app: { path: d, build: 'x' } }, depois_do_create: { set_env: [] } }));
  const x = node('ensaio-worker-pacote.mjs', ['--manifest', join(d, 'm.json')]);
  assert.equal(x.status, 2); assert.match(x.stderr, /não é de um pacote de worker/);
  assert.equal(node('ensaio-worker-pacote.mjs', []).status, 2);
});

test('smoke-staging: temMarcadorMock só reprova marcadores explícitos de MOCK; a palavra solta em texto editorial não (QA 5, 24/11)', async () => {
  const { temMarcadorMock } = await import('../scripts/smoke-staging.mjs');
  for (const ruim of ['<span>[MOCK] Matéria de teste</span>', '<i>MOCK · dados de exemplo</i>', 'Faixa MOCK · demonstração']) assert.equal(temMarcadorMock(ruim), true, ruim);
  for (const bom of ['Como um MOCK de interface acelera o design', 'o mock-up do app', '[DEMO · staging] Programa fictício', 'Comprador MOCKADO', '', null, undefined]) assert.equal(temMarcadorMock(bom), false, String(bom));
  const src = readFileSync(join(S, 'smoke-staging.mjs'), 'utf8');
  assert.equal((src.match(/bMOCK(?!\s·)/g) ?? []).length, 0, 'nenhum \bMOCK\b solto sobrou no smoke-staging');
});

test('smoke-producao --expect-icones (achado D-2): favicon.ico em 404 (cache velho do edge) reprova mostrando cf-cache-status e age; com os três ícones servidos passa', async () => {
  const { rodar } = await import('../scripts/smoke-producao.mjs');
  const estado = { favicon: 404 };
  const s = await server((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/favicon.ico') {
      if (estado.favicon === 404) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cf-cache-status': 'HIT', age: '130611' }); return res.end('nao encontrado'); }
      res.writeHead(200, { 'content-type': 'image/x-icon' }); return res.end('ico');
    }
    if (u === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg/>'); }
    if (u === '/apple-icon.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('png'); }
    res.writeHead(404); res.end();
  });
  try {
    const url = 'http://127.0.0.1:' + s.address().port;
    const ruim = (await rodar({ url, icones: true, consecutivas: 1, intervaloMs: 0 })).checagens.filter((c) => /^icones:/.test(c.nome));
    assert.equal(ruim.length, 3);
    const fav = ruim.find((c) => /favicon/.test(c.nome));
    assert.equal(fav.ok, false); assert.match(fav.detalhe, /HTTP 404.*cf-cache-status=HIT age=130611/);
    assert.ok(ruim.filter((c) => !/favicon/.test(c.nome)).every((c) => c.ok));
    estado.favicon = 200;
    const bom = (await rodar({ url, icones: true, consecutivas: 1, intervaloMs: 0 })).checagens.filter((c) => /^icones:/.test(c.nome));
    assert.ok(bom.length === 3 && bom.every((c) => c.ok), JSON.stringify(bom));
    assert.equal((await rodar({ url, consecutivas: 1, intervaloMs: 0 })).checagens.some((c) => /^icones:/.test(c.nome)), false, 'sem a opção não confere ícones');
  } finally { s.close(); }
});
