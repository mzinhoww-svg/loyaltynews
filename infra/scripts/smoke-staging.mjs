#!/usr/bin/env node
// Smoke tests de STAGING COMPLETO (banco + Redis + worker + seed): provam, numa URL pública, que cada módulo responde de verdade.
// Só lê (GET sem sessão), nunca grava, nunca imprime segredo. Saída: JSON com cada checagem (ok/falhou + motivo) e código 0 se tudo que foi exigido passou.
// Uso: node infra/scripts/smoke-staging.mjs --url https://loyaltynews-stg.vertraweb.app --expect-commit <sha>
//        [--expect-seed] [--expect-orgs 29] [--timeout 8000]
//   --expect-seed   exige o seed de staging (`seed-stg-*`, rótulo "[DEMO · staging]") nas matérias, na agenda e no feed
//   --expect-orgs N exige que /intelligence mostre N empresas cadastradas (hoje o adaptador `api` do portal NÃO as lê: só com o adaptador de Intelligence)
// Login do Studio NÃO é testado aqui (exige usuário e MFA, segredos): só a tela de entrada e a negação sem sessão.
import { pathToFileURL } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';

export const ROTULO_SEED = '[DEMO · staging]';

/** /api/ready de staging COMPLETO: modo completo, banco e Redis ok. Função pura. */
export function avaliarReady(j) {
  const p = [];
  if (!j || typeof j !== 'object') return ['corpo sem JSON'];
  if (j.mode !== 'completo') p.push(`mode=${j.mode} (esperado "completo": o staging ainda está em nodb?)`);
  if (j.db !== 'ok') p.push(`db=${j.db}`);
  if (j.redis !== 'ok') p.push(`redis=${j.redis}`);
  if (j.status !== 'ok') p.push(`status=${j.status}`);
  return p;
}

/** Número de empresas anunciado na página /intelligence ("N cadastrado(s) e verificado(s)" no tile Empresas); null se a página diz "em breve". */
export function empresasNaPagina(html) {
  const m = String(html).match(/data-testid="count-empresas"[^>]*>\s*(\d+)\s+cadastrado/i);
  return m ? Number(m[1]) : null;
}

/** Itens de uma lista pública `{ data: [...] }`. */
export const itens = (j) => (Array.isArray(j?.data) ? j.data : []);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || args.url === true) fail('use --url https://host', 2);
  const base = String(args.url).replace(/\/$/, '');
  const timeout = Number(args.timeout ?? 8000);
  const seed = Boolean(args['expect-seed']);
  const orgs = args['expect-orgs'] && args['expect-orgs'] !== true ? Number(args['expect-orgs']) : null;
  const out = [];
  const check = (nome, ok, detalhe = '') => out.push({ nome, ok: Boolean(ok), ...(detalhe ? { detalhe } : {}) });
  const get = async (p, { json = false } = {}) => {
    const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ln-smoke/1', accept: json ? 'application/json' : 'text/html' } });
    const body = await r.text();
    let j = null;
    if (json) { try { j = JSON.parse(body); } catch { /* não-JSON */ } }
    return { status: r.status, body, j, h: r.headers };
  };
  const tentar = async (nome, fn) => { try { await fn(); } catch (e) { check(nome, false, e.name === 'TimeoutError' ? `timeout ${timeout} ms` : String(e.message).slice(0, 160)); } };

  await tentar('health', async () => {
    const r = await get('/api/health', { json: true });
    const ok = r.status === 200 && r.j?.status === 'ok' && (!args['expect-commit'] || r.j?.version === args['expect-commit']);
    check('health: processo vivo' + (args['expect-commit'] ? ' com o commit certo' : ''), ok, ok ? '' : `HTTP ${r.status} version=${r.j?.version}`);
  });
  await tentar('ready', async () => {
    const r = await get('/api/ready', { json: true });
    const p = r.status === 200 ? avaliarReady(r.j) : [`HTTP ${r.status}`];
    check('ready: staging completo (banco e Redis respondem, não é nodb)', p.length === 0, p.join(' | '));
  });
  await tentar('site', async () => {
    const r = await get('/api/publico/site', { json: true });
    check('publico/site: 200 JSON, sem MOCK', r.status === 200 && r.j !== null && !/\bMOCK\b/.test(r.body), `HTTP ${r.status}`);
  });
  await tentar('editorias', async () => {
    const r = await get('/api/publico/editorias', { json: true });
    const n = itens(r.j).length || (Array.isArray(r.j) ? r.j.length : 0);
    check('publico/editorias: as editorias oficiais (10)', r.status === 200 && n >= 10, `HTTP ${r.status}, ${n} editorias`);
  });
  await tentar('materias', async () => {
    const r = await get('/api/publico/materias?limit=50', { json: true });
    const lista = itens(r.j);
    const rot = lista.filter((m) => String(m.titulo ?? '').includes(ROTULO_SEED)).length;
    check('publico/materias: 200 com lista', r.status === 200 && Array.isArray(r.j?.data), `HTTP ${r.status}, ${lista.length} itens`);
    if (seed) check(`publico/materias: seed publicado, todo item rotulado "${ROTULO_SEED}"`, lista.length >= 5 && rot === lista.length, `${rot} de ${lista.length} rotulados`);
    check('publico/materias: sem MOCK', !/\bMOCK\b/.test(r.body));
  });
  await tentar('agenda', async () => {
    const r = await get('/api/publico/agenda', { json: true });
    check('publico/agenda: 200 JSON', r.status === 200 && r.j !== null, `HTTP ${r.status}`);
    if (seed) check(`publico/agenda: eventos do seed rotulados "${ROTULO_SEED}"`, r.body.includes(ROTULO_SEED), 'rótulo ausente');
  });
  await tentar('home', async () => {
    const r = await get('/');
    check('home: 200 sem faixa/marcador de vitrine e sem MOCK', r.status === 200 && !/Conteúdo de demonstração|MOCK · dados de exemplo|\[MOCK\]|\bMOCK\b/.test(r.body), `HTTP ${r.status}`);
    if (seed) check(`home: mostra matéria do seed ("${ROTULO_SEED}")`, r.body.includes(ROTULO_SEED), 'a home não mostra o seed (portal em fonte vazia ou sem publicação)');
    const noindex = /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(r.body) || /noindex/i.test(r.h.get('x-robots-tag') ?? '');
    check('home: staging não indexável (noindex)', noindex);
  });
  await tentar('noticias', async () => {
    const r = await get('/noticias');
    check('noticias: 200', r.status === 200, `HTTP ${r.status}`);
    if (seed) check('noticias: lista o seed', r.body.includes(ROTULO_SEED));
  });
  await tentar('feed', async () => {
    const r = await get('/feed.xml');
    check('feed.xml: 200 RSS' + (seed ? ' com itens do seed' : ''), r.status === 200 && /<rss/.test(r.body) && (!seed || r.body.includes(ROTULO_SEED)), `HTTP ${r.status}`);
  });
  await tentar('intelligence', async () => {
    const r = await get('/intelligence');
    const n = empresasNaPagina(r.body);
    check('intelligence: 200', r.status === 200, `HTTP ${r.status}`);
    if (orgs !== null) check(`intelligence: ${orgs} empresas cadastradas`, n === orgs, n === null ? 'a página diz "em breve": o adaptador api do portal ainda não lê Intelligence' : `a página mostra ${n}`);
  });
  await tentar('studio', async () => {
    const neg = await get('/studio');
    check('studio: sem sessão = 307 para o login', neg.status === 307 && /\/studio\/entrar/.test(neg.h.get('location') ?? ''), `HTTP ${neg.status} ${neg.h.get('location') ?? ''}`);
    const ent = await get('/studio/entrar');
    check('studio/entrar: 200 com formulário de entrada', ent.status === 200 && /<form/i.test(ent.body) && /type="password"/i.test(ent.body), `HTTP ${ent.status}`);
  });
  await tentar('robots', async () => {
    const r = await get('/robots.txt');
    check('robots.txt: Disallow / (staging)', r.status === 200 && /^disallow:\s*\/\s*$/im.test(r.body) && !/^allow:\s*\/\s*$/im.test(r.body), `HTTP ${r.status}`);
  });

  const falhas = out.filter((c) => !c.ok);
  console.log(JSON.stringify({ url: base, exigiu: { seed, orgs, commit: args['expect-commit'] ?? null }, total: out.length, falhas: falhas.length, checagens: out }, null, 2));
  process.exit(falhas.length ? 1 : 0);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
