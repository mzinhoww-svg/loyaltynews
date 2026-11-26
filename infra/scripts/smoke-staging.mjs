#!/usr/bin/env node
// Smoke tests de STAGING COMPLETO (banco + Redis + worker + seed): provam, numa URL pública, que cada módulo responde de verdade.
// Só lê (GET sem sessão), nunca grava, nunca imprime segredo. Saída: JSON com cada checagem (ok/falhou + motivo) e código 0 se tudo que foi exigido passou.
// Uso: node infra/scripts/smoke-staging.mjs --url https://loyaltynews-stg.vertraweb.app --expect-commit <sha>
//        [--expect-seed] [--expect-orgs 29] [--timeout 8000]
//   --expect-seed   exige o seed de staging (`seed-stg-*`, rótulo "[DEMO · staging]") nas matérias, na agenda e na home (o feed fica SEM itens em staging: R6)
//   --expect-login-form exige o formulário de e-mail e senha em /studio/entrar (hoje a tela é um aviso fixo; sem a flag vira só uma nota)
//   --rollback-app-sem-banco aceita SO o 503 "migracoes_divergentes" do /api/ready (rollback do app com o banco já migrado, build antigo com a sonda)
//   --expect-migracoes exige /api/ready com migracoes:"ok" (builds com ft/backend-2 19cd21e em diante); sem a opção o campo, se existir, só pode ser "ok"
//   --consecutivas N --intervalo MS: o /api/health tem de responder 200 N vezes seguidas (padrão 3, a cada 5000 ms), sempre com a mesma versão (QA 8, 24/11: um 200 logo depois do start não prova nada)
//   --expect-seguranca confere os cabeçalhos de segurança do portal (verificar-seguranca-headers.mjs; achado P2-6)
//   --expect-icones confere /favicon.ico, /icon.svg e /apple-icon.png (200 com content-type de imagem; achado D-2 do Senior Auditor)
//   --expect-cache confere a política de cache do portal (verificar-cache-headers.mjs): s-maxage=60 nas páginas sem pessoas, no-store nas com pessoas, na matéria e no sitemap
//   --expect-flags a,b  exige que /api/health liste EXATAMENTE essas flags (ADR-022; staging com DP-38: intelligencePessoas); --expect-no-flags exige a lista vazia
//   --expect-orgs N exige que /intelligence mostre N empresas cadastradas (hoje o adaptador `api` do portal NÃO as lê: só com o adaptador de Intelligence)
// Login do Studio NÃO é testado aqui (exige usuário e MFA, segredos): só a tela de entrada e a negação sem sessão.
import { pathToFileURL } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';
import { verificar } from './verificar-cache-headers.mjs';
import { verificarSeguranca } from './verificar-seguranca-headers.mjs';
import { configSaude, saudeEstavel } from './lib/saude.mjs';

export const ROTULO_SEED = '[DEMO · staging]';

/** /api/ready de staging COMPLETO: modo completo, banco e Redis ok. Função pura. */
/** Marcadores EXPLÍCITOS de fixture/MOCK do portal: "[MOCK]", "MOCK · dados de exemplo" e "MOCK ·". A palavra MOCK solta NÃO conta: pode aparecer em texto editorial (QA 5, 24/11; mesmo critério do smoke-producao). Função pura. */
export function temMarcadorMock(texto) {
  return /\[MOCK\]|MOCK · dados de exemplo|\bMOCK ·/.test(String(texto ?? ''));
}

export function avaliarReady(j, opts = {}) {
  const p = [];
  if (!j || typeof j !== 'object') return ['corpo sem JSON'];
  if (j.mode !== 'completo') p.push(`mode=${j.mode} (esperado "completo": o staging ainda está em nodb?)`);
  if (j.db !== 'ok') p.push(`db=${j.db}`);
  if (j.redis !== 'ok') p.push(`redis=${j.redis}`);
  if (j.status !== 'ok') p.push(`status=${j.status}`);
  // ft/backend-2 19cd21e: /api/ready confere as migrações (corpo migracoes:"ok"). Sem o campo (builds anteriores) só reprova com opts.exigirMigracoes.
  if (j.migracoes !== undefined && j.migracoes !== 'ok') p.push(`migracoes=${String(j.migracoes).slice(0, 40)}`);
  if (opts.exigirMigracoes && j.migracoes !== 'ok') p.push('campo migracoes ausente ou diferente de ok (o build não confere as migrações)');
  return p;
}

/** Número de empresas anunciado na página /intelligence. Prefere `data-count` (o zero honesto também é número); sem ele, lê "N cadastrado(s)"; null quando a página não mostra contagem (indisponível, não publicado ou sem o tile). */
export function empresasNaPagina(html) {
  const tag = String(html).match(/<[^>]*data-testid="count-empresas"[^>]*>/)?.[0];
  const attr = tag?.match(/data-count="(\d+)"/);
  if (attr) return Number(attr[1]);
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
  const flagsEsp = args['expect-no-flags'] ? [] : args['expect-flags'] && args['expect-flags'] !== true ? String(args['expect-flags']).split(',').map((s) => s.trim()).filter(Boolean).sort() : null;
  const orgs = args['expect-orgs'] && args['expect-orgs'] !== true ? Number(args['expect-orgs']) : null;
  const out = [];
  const notas = [];
  // O detalhe descreve a FALHA: só entra no resultado quando a checagem falha (fix 23/11: checagens que passavam traziam o texto de erro).
  const check = (nome, ok, detalhe = '') => out.push({ nome, ok: Boolean(ok), ...(!ok && detalhe ? { detalhe } : {}) });
  const get = async (p, { json = false } = {}) => {
    const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ln-smoke/1', accept: json ? 'application/json' : 'text/html' } });
    const body = await r.text();
    let j = null;
    if (json) { try { j = JSON.parse(body); } catch { /* não-JSON */ } }
    return { status: r.status, body, j, h: r.headers };
  };
  const tentar = async (nome, fn) => { try { await fn(); } catch (e) { check(nome, false, e.name === 'TimeoutError' ? `timeout ${timeout} ms` : String(e.message).slice(0, 160)); } };

  await tentar('health', async () => {
    // Nunca um único 200 logo depois do start (QA 8, 24/11): N respostas 200 seguidas (padrão 3 em ~10 s), mesma versão e, se pedida, a versão esperada.
    const cfg = configSaude(args);
    const est = await saudeEstavel({ amostrar: () => get('/api/health', { json: true }), n: cfg.n, intervaloMs: cfg.intervaloMs, commit: args['expect-commit'] && args['expect-commit'] !== true ? String(args['expect-commit']) : undefined });
    const r = est.ultima ?? { status: 0, j: null };
    check(`health: ${cfg.n} resposta(s) 200 seguidas (~${Math.round(((cfg.n - 1) * cfg.intervaloMs) / 1000)} s)` + (args['expect-commit'] ? ' com o commit certo' : ''), est.ok, est.problemas.join(' | '));
    if (flagsEsp) {
      const got = Array.isArray(r.j?.flags) ? [...new Set(r.j.flags.map(String))].sort() : null;
      check(`health: flags ligadas = [${flagsEsp.join(',')}] (ADR-022)`, got !== null && got.join(',') === flagsEsp.join(','), got === null ? 'o /api/health não tem o campo flags (código sem a ADR-022)' : `flags=[${got.join(',')}]`);
    }
  });
  await tentar('ready', async () => {
    const r = await get('/api/ready', { json: true });
    const motivo = String(r.j?.motivo ?? r.j?.reason ?? '').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 60);
    // Rollback do APP sem rollback do banco (ft/backend-2 19cd21e, igualdade estrita): o build antigo que já tem a sonda responde 503 "migracoes_divergentes" porque o banco avançou.
    // Com --rollback-app-sem-banco SÓ esse 503 é aceito (outro motivo, ou 503 sem motivo, continua reprovando).
    if (args['rollback-app-sem-banco'] && r.status === 503 && motivo === 'migracoes_divergentes') {
      check('ready: rollback do app sem rollback do banco: 503 migracoes_divergentes aceito (banco à frente do build)', true);
      return;
    }
    const p = r.status === 200 ? avaliarReady(r.j, { exigirMigracoes: Boolean(args['expect-migracoes']) }) : [`HTTP ${r.status}${motivo ? ` (${motivo})` : ''}`];
    check('ready: staging completo (banco e Redis respondem, não é nodb)', p.length === 0, p.join(' | '));
  });
  await tentar('site', async () => {
    const r = await get('/api/publico/site', { json: true });
    check('publico/site: 200 JSON, sem MOCK', r.status === 200 && r.j !== null && !temMarcadorMock(r.body), `HTTP ${r.status}`);
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
    check('publico/materias: sem MOCK', !temMarcadorMock(r.body));
  });
  await tentar('agenda', async () => {
    const r = await get('/api/publico/agenda', { json: true });
    check('publico/agenda: 200 JSON', r.status === 200 && r.j !== null, `HTTP ${r.status}`);
    if (seed) check(`publico/agenda: eventos do seed rotulados "${ROTULO_SEED}"`, r.body.includes(ROTULO_SEED), 'rótulo ausente');
  });
  await tentar('home', async () => {
    const r = await get('/');
    check('home: 200 sem faixa/marcador de vitrine e sem MOCK', r.status === 200 && !(/Conteúdo de demonstração/.test(r.body) || temMarcadorMock(r.body)), `HTTP ${r.status}`);
    if (seed) check(`home: mostra matéria do seed ("${ROTULO_SEED}")`, r.body.includes(ROTULO_SEED), 'a home não mostra o seed (portal em fonte vazia ou sem publicação)');
    const noindex = /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(r.body) || /noindex/i.test(r.h.get('x-robots-tag') ?? '');
    check('home: staging não indexável (noindex)', noindex);
  });
  await tentar('noticias', async () => {
    const r = await get('/noticias');
    check('noticias: 200', r.status === 200, `HTTP ${r.status}`);
    if (seed) check('noticias: lista o seed', r.body.includes(ROTULO_SEED));
  });
  // Portal int/009: página de matéria e de editoria (provam portal-materia e portal-editorias). Só com --expect-seed (precisa de matéria rotulada); matéria inexistente = 404.
  if (seed) await tentar('materia-editoria', async () => {
    const api = JSON.parse((await get('/api/publico/materias')).body);
    const m = (api.data ?? []).find((x) => String(x.titulo ?? '').includes(ROTULO_SEED));
    if (!m) { check('materia: seed com slug e editoria na API', false, 'nenhuma matéria rotulada'); return; }
    const rm = await get(`/noticia/${encodeURIComponent(m.slug)}`);
    check('materia: página da matéria do seed (200, rotulada, sem MOCK)', rm.status === 200 && rm.body.includes(ROTULO_SEED) && !temMarcadorMock(rm.body), `HTTP ${rm.status}`);
    const re = await get(`/editoria/${encodeURIComponent(m.editoria)}`);
    check('editoria: página da editoria da matéria do seed (200, lista o seed, sem MOCK)', re.status === 200 && re.body.includes(ROTULO_SEED) && !temMarcadorMock(re.body), `HTTP ${re.status}`);
    const r404 = await get('/noticia/materia-que-nao-existe-smoke');
    check('materia: slug inexistente = 404', r404.status === 404, `HTTP ${r404.status}`);
  });
  // ADR-022 / DP-38: com --expect-flags ou --expect-no-flags, as rotas públicas de pessoas e Moves têm de refletir a flag (desligada: 200 vazio com disponivel=false; ligada: disponivel=true).
  // Política de cache do portal (PM, 24/11): 60 s só nas páginas SEM pessoas; pessoas/moves/Intelligence/sitemap e a matéria ficam no-store. Prova de caixa-preta: verificar-cache-headers.mjs.
  // Ícones do portal (achado D-2 do Senior Auditor, 24/11): /favicon.ico respondia 404 no staging com o app servindo 200 na origem. Era um 404 pré-renderizado do Next com
  // s-maxage de 1 ano guardado no Cloudflare desde o 1º deploy (sem o ícone). Quando falha, o detalhe mostra cf-cache-status e age para distinguir cache velho de ícone ausente.
  if (args['expect-icones']) await tentar('icones', async () => {
    for (const [caminho, tipo] of [['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/], ['/icon.svg', /image\/svg/], ['/apple-icon.png', /image\/png/]]) {
      const r = await get(caminho);
      const ct = r.h.get('content-type') ?? '';
      check(`icones: ${caminho} 200 com content-type de imagem`, r.status === 200 && tipo.test(ct), `HTTP ${r.status} ${ct.split(';')[0]} cf-cache-status=${r.h.get('cf-cache-status') ?? '-'} age=${r.h.get('age') ?? '-'}`);
    }
  });
  if (args['expect-cache']) await tentar('cache', async () => {
    const v = await verificar({ url: base, valores: { editoria: 'mercado' } });
    check(`cache: ${v.total} rotas conforme a política (60 s sem pessoas; no-store com pessoas, matéria e sitemap)`, v.violacoes === 0, v.resultados.filter((x) => !x.ok).map((x) => `${x.rota}: ${x.problemas.join('; ')}`).join(' | ').slice(0, 700));
  });
  // Cabeçalhos de segurança (achado P2-6, 24/11): nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, CSP aplicada e em relatório, HSTS do staging.
  if (args['expect-seguranca']) await tentar('seguranca', async () => {
    const v = await verificarSeguranca({ url: base, ambiente: 'staging' });
    check(`seguranca: ${v.total} rotas/estáticos com os cabeçalhos de segurança (estáticos: só nosniff)${v.avisos ? ` [AVISO: ${v.avisos} cópia(s) antiga(s) na borda sem cabeçalhos, origem OK; purge_cache por URL completa: ${v.purgar.join(' ')}]` : ''}`, v.violacoes === 0, v.resultados.filter((x) => !x.ok).map((x) => `${x.rota}: ${x.problemas.join('; ')}`).join(' | ').slice(0, 700));
  });
  if (flagsEsp !== null) await tentar('pessoas-moves', async () => {
    const ligada = flagsEsp.includes('intelligencePessoas');
    for (const rota of ['pessoas', 'moves']) {
      const r = await get(`/api/publico/intelligence/${rota}`, { json: true });
      check(`intelligence/${rota}: ${ligada ? 'ligada pela flag (disponivel=true)' : 'desligada (disponivel=false, sem dado de pessoa)'}`, r.status === 200 && r.j?.disponivel === ligada, `HTTP ${r.status} disponivel=${r.j?.disponivel}`);
    }
  });
  await tentar('feed', async () => {
    const r = await get('/feed.xml');
    // Staging NÃO é indexável: por desenho (Security R6) o feed é um canal RSS válido SEM itens, igual ao sitemap. Item no feed de staging seria vazamento de conteúdo para agregadores.
    const itensFeed = (r.body.match(/<item\b/g) || []).length;
    check('feed.xml: canal RSS válido e SEM itens (staging não indexável, R6)', r.status === 200 && /<rss/.test(r.body) && itensFeed === 0, `HTTP ${r.status}, ${itensFeed} itens`);
  });
  await tentar('midia-kit', async () => {
    const r = await get('/midia-kit');
    const noindex = /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(r.body) || /noindex/i.test(r.h.get('x-robots-tag') ?? '');
    check('midia-kit: 200, título "Mídia kit", sem MOCK e não indexável', r.status === 200 && /<title>[^<]*Mídia kit/i.test(r.body) && !temMarcadorMock(r.body) && noindex, `HTTP ${r.status}`);
  });
  await tentar('intelligence', async () => {
    const r = await get('/intelligence');
    const n = empresasNaPagina(r.body);
    check('intelligence: 200', r.status === 200, `HTTP ${r.status}`);
    // A página TEM de refletir a API: com dados na API e "em breve" na página é falha real (adaptador), não "esperada".
    const api = await get('/api/publico/intelligence/empresas');
    // Só vale contagem de resposta 200 com `total` inteiro: erro ou total ausente/nulo não pode "concordar" com o 0 da página.
    let apiTotal = null;
    try { const t = JSON.parse(api.body).total; if (api.status === 200 && Number.isInteger(t) && t >= 0) apiTotal = t; } catch { /* corpo sem JSON */ }
    const semContagem = 'a página não mostra contagem';
    check('intelligence: página e API concordam', apiTotal !== null && n === apiTotal,
      apiTotal === null ? `a API respondeu HTTP ${api.status} sem total válido; ${n === null ? semContagem : `página ${n}`}`
        : n === null ? `a API tem ${apiTotal} empresa(s) e ${semContagem}` : `página ${n}, API ${apiTotal}`);
    if (orgs !== null) check(`intelligence: ${orgs} empresas cadastradas`, n === orgs, n === null ? semContagem : `a página mostra ${n}`);
  });
  await tentar('studio', async () => {
    const neg = await get('/studio');
    check('studio: sem sessão = 307 para o login', neg.status === 307 && /\/studio\/entrar/.test(neg.h.get('location') ?? ''), `HTTP ${neg.status} ${neg.h.get('location') ?? ''}`);
    const ent = await get('/studio/entrar');
    const temForm = /<form/i.test(ent.body) && /type="password"/i.test(ent.body);
    check('studio/entrar: 200', ent.status === 200, `HTTP ${ent.status}`);
    if (args['expect-login-form']) check('studio/entrar: formulário de entrada (e-mail e senha)', temForm, 'a tela é só um aviso: o login do Studio ainda não foi entregue (Studio Engineer) e o 1º admin depende da CLI staging-admin (Backend)');
    else if (!temForm) notas.push('studio/entrar: a tela é um aviso fixo ("login ainda não disponível"), sem formulário: o login real do Studio está BLOQUEADO até a interface de entrada (Studio Engineer) e a CLI staging-admin (Backend, 1º admin com TOTP) entrarem; use --expect-login-form para exigir');
  });
  await tentar('robots', async () => {
    const r = await get('/robots.txt');
    check('robots.txt: Disallow / (staging)', r.status === 200 && /^disallow:\s*\/\s*$/im.test(r.body) && !/^allow:\s*\/\s*$/im.test(r.body), `HTTP ${r.status}`);
  });

  const falhas = out.filter((c) => !c.ok);
  console.log(JSON.stringify({ url: base, exigiu: { seed, orgs, flags: flagsEsp, loginForm: Boolean(args['expect-login-form']), commit: args['expect-commit'] ?? null }, total: out.length, falhas: falhas.length, notas, checagens: out }, null, 2));
  process.exit(falhas.length ? 1 : 0);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
