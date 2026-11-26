#!/usr/bin/env node
// Smoke da PRODUÇÃO (só leitura, nenhum POST, nenhuma credencial). Contraparte do smoke-staging, que EXIGE conteúdo de demonstração; aqui o conteúdo de demonstração é falha.
// Uso: node infra/scripts/smoke-producao.mjs --url https://host --expect-commit <sha40> [--indexavel [--sem-conteudo-ainda]] [--expect-canonical https://www.dominio] [--expect-cache] [--expect-icones] [--expect-seguranca] [--consecutivas 3] [--intervalo 5000] [--timeout 20000]
// Confere: /api/health com APP_ENV production, o commit certo e flags [] (ADR-022: produção não liga flag por variável); /api/ready completo (banco e Redis; migrações se o build as confere);
//   API pública e portal sem MOCK, sem "[DEMO" e sem marcador de vitrine; produção NÃO indexável até o go-live (DP-24: noindex, robots Disallow, sitemap e feed sem itens) ou, com --indexavel (depois
//   do go-live), indexável; Studio sem sessão = 307 para o login; pessoas e moves desligados (disponivel=false). Código 0 = tudo ok; 1 = alguma falha; 2 = uso errado.
import { parseArgs } from './lib/util.mjs';
import { avaliarReady } from './smoke-staging.mjs';
import { verificar } from './verificar-cache-headers.mjs';
import { verificarSeguranca } from './verificar-seguranca-headers.mjs';
import { configSaude, saudeEstavel } from './lib/saude.mjs';
import { pathToFileURL } from 'node:url';

// Só marcadores EXPLÍCITOS de demonstração/fixture. A palavra solta MOCK não entra: pode aparecer legitimamente em texto editorial (ressalva do QA 5); o marcador do portal é "[MOCK]" / "MOCK ·".
const DEMO = /\[DEMO\b|DEMO ·|Conteúdo de demonstração|MOCK · dados de exemplo|\[MOCK\]|\bMOCK ·/;

export async function rodar({ url, commit, indexavel = false, semConteudoAinda = false, canonical = '', cache = false, icones = false, seguranca = false, timeout = 20000, consecutivas, intervaloMs }) {
  const base = url.replace(/\/+$/, '');
  const out = [];
  const check = (nome, ok, detalhe = '') => out.push({ nome, ok: Boolean(ok), ...(!ok && detalhe ? { detalhe } : {}) });
  const get = async (p, json = false) => {
    const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ln-smoke-producao/1', accept: json ? 'application/json' : '*/*' } });
    const body = await r.text();
    let j = null;
    if (json) { try { j = JSON.parse(body); } catch { /* não-JSON */ } }
    return { status: r.status, body, j, h: r.headers };
  };
  const tentar = async (nome, fn) => { try { await fn(); } catch (e) { check(`${nome}: a sonda falhou`, false, String(e?.name ?? 'Erro')); } };
  const noindex = (r) => /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(r.body) || /noindex/i.test(r.h.get('x-robots-tag') ?? '');

  await tentar('health', async () => {
    // Nunca um único 200 logo depois do start (QA 8, 24/11): N respostas 200 seguidas (padrão 3 em ~10 s), mesma versão e o commit esperado.
    const cfg = configSaude({ consecutivas, intervalo: intervaloMs });
    const est = await saudeEstavel({ amostrar: () => get('/api/health', true), n: cfg.n, intervaloMs: cfg.intervaloMs, commit });
    const r = est.ultima ?? { status: 0, j: null };
    check(`health: ${cfg.n} resposta(s) 200 seguidas (~${Math.round(((cfg.n - 1) * cfg.intervaloMs) / 1000)} s), status ok, mesma versão` + (commit ? ' e o commit certo' : ''), est.ok, est.problemas.join(' | '));
    check('health: APP_ENV production', r.j?.env === 'production', `env=${r.j?.env}`);
    check('health: flags ligadas = [] (ADR-022)', Array.isArray(r.j?.flags) && r.j.flags.length === 0, Array.isArray(r.j?.flags) ? `flags=${r.j.flags.join(',')}` : 'campo flags ausente');
  });
  await tentar('ready', async () => {
    const r = await get('/api/ready', true);
    const p = r.status === 200 ? avaliarReady(r.j) : [`HTTP ${r.status}${r.j?.motivo ? ` (${String(r.j.motivo).replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 40)})` : ''}`];
    check('ready: completo (banco e Redis respondem, migrações conferidas se o build as confere)', p.length === 0, p.join(' | '));
  });
  await tentar('api-publica', async () => {
    const s = await get('/api/publico/site', true);
    check('publico/site: 200 JSON, sem demonstração', s.status === 200 && s.j !== null && !DEMO.test(s.body), `HTTP ${s.status}`);
    const e = await get('/api/publico/editorias', true);
    check('publico/editorias: as 10 editorias oficiais', e.status === 200 && Array.isArray(e.j?.data) && e.j.data.length === 10, `HTTP ${e.status}`);
    const m = await get('/api/publico/materias', true);
    check('publico/materias: 200 JSON, nenhuma matéria de demonstração', m.status === 200 && Array.isArray(m.j?.data) && !DEMO.test(m.body), `HTTP ${m.status}`);
    const a = await get('/api/publico/agenda', true);
    check('publico/agenda: 200 JSON, nenhum evento de demonstração', a.status === 200 && a.j !== null && !DEMO.test(a.body), `HTTP ${a.status}`);
  });
  await tentar('portal', async () => {
    const h = await get('/');
    check('home: 200, sem MOCK, sem demonstração e sem faixa de vitrine', h.status === 200 && !DEMO.test(h.body), `HTTP ${h.status}`);
    check(indexavel ? 'home: indexável (go-live)' : 'home: NÃO indexável até o go-live (noindex, DP-24)', indexavel ? !noindex(h) : noindex(h));
    if (canonical) {
      // A-01 (revisão 25/11): o canonical e o og:image têm de apontar para a URL CANÔNICA do go-live (www), nunca para o host da Vertra (*.vertraweb.app); o host que se sonda pode ser outro (antes do DNS)
      const origem = canonical.replace(/\/+$/, '');
      const pega =(re) => (h.body.match(re) || [])[1] ?? '';
      const can = pega(/<link[^>]+rel="canonical"[^>]*href="([^"]*)"/i) || pega(/<link[^>]+href="([^"]*)"[^>]*rel="canonical"/i);
      const og = pega(/<meta[^>]+property="og:image"[^>]*content="([^"]*)"/i) || pega(/<meta[^>]+content="([^"]*)"[^>]*property="og:image"/i);
      const noDominio = (u) => u === origem || u.startsWith(origem + '/');
      check(`home: canonical aponta para ${origem}`, noDominio(can), `canonical=${can || '(ausente)'}`);
      check(`home: og:image aponta para ${origem}`, noDominio(og), `og:image=${og || '(ausente)'}`);
    }
    const n = await get('/noticias');
    check('noticias: 200, sem demonstração', n.status === 200 && !DEMO.test(n.body), `HTTP ${n.status}`);
    const mk = await get('/midia-kit');
    check('midia-kit: 200, sem MOCK', mk.status === 200 && !DEMO.test(mk.body), `HTTP ${mk.status}`);
    const i = await get('/intelligence');
    check('intelligence: 200, sem demonstração', i.status === 200 && !DEMO.test(i.body), `HTTP ${i.status}`);
  });
  await tentar('indexacao', async () => {
    const rb = await get('/robots.txt');
    check(indexavel ? 'robots.txt: libera o rastreio (go-live)' : 'robots.txt: Disallow / (não indexável até o go-live)', indexavel ? !/^\s*Disallow:\s*\/\s*$/im.test(rb.body) : rb.status === 200 && /^\s*Disallow:\s*\/\s*$/im.test(rb.body), `HTTP ${rb.status}`);
    const sm = await get('/sitemap.xml');
    const locs = (sm.body.match(/<loc>/g) || []).length;
    if (canonical && indexavel) {
      const origem = canonical.replace(/\/+$/, '');
      const fora = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).filter((u) => !(u === origem || u.startsWith(origem + '/')));
      check(`sitemap.xml: todas as URLs em ${origem}`, fora.length === 0, `${fora.length} fora do domínio (ex.: ${fora[0] ?? ''})`);
      const smRobots = (rb.body.match(/^\s*Sitemap:\s*(\S+)/im) || [])[1];
      if (smRobots) check(`robots.txt: Sitemap em ${origem}`, smRobots === origem || smRobots.startsWith(origem + '/'), `Sitemap: ${smRobots}`);
    }
    // --sem-conteudo-ainda (só com --indexavel; DP-54): no go-live SEM matéria publicada o sitemap pode estar vazio e o feed sem itens/404. Aceita SÓ isso, de forma explícita no nome da checagem;
    // home sem noindex, robots que libera e o resto continuam exigidos. Com URLs presentes, passa como sempre.
    check(indexavel ? (semConteudoAinda ? 'sitemap.xml: lista URLs, ou está vazio (sem conteúdo ainda: aceito por --sem-conteudo-ainda)' : 'sitemap.xml: lista URLs (go-live)') : 'sitemap.xml: sem URLs até o go-live', (sm.status === 200 || sm.status === 404) && (indexavel ? (locs > 0 || semConteudoAinda) : locs === 0), `HTTP ${sm.status}, ${locs} url(s)`);
    const fd = await get('/feed.xml');
    const itens = (fd.body.match(/<item\b/g) || []).length;
    check(indexavel ? (semConteudoAinda ? 'feed.xml: RSS válido, ou ausente (sem conteúdo ainda: aceito por --sem-conteudo-ainda)' : 'feed.xml: RSS válido') : 'feed.xml: sem itens até o go-live', (fd.status === 200 || fd.status === 404) && (indexavel ? (/<rss/.test(fd.body) || (semConteudoAinda && fd.status === 404)) : itens === 0), `HTTP ${fd.status}, ${itens} item(ns)`);
  });
  await tentar('studio', async () => {
    const st = await get('/studio');
    check('studio: sem sessão = 307 para o login', st.status === 307 && /\/studio\/entrar/.test(st.h.get('location') ?? ''), `HTTP ${st.status}`);
    const en = await get('/studio/entrar');
    check('studio/entrar: 200', en.status === 200, `HTTP ${en.status}`);
  });
  await tentar('pessoas-moves', async () => {
    for (const rota of ['pessoas', 'moves']) {
      const r = await get(`/api/publico/intelligence/${rota}`, true);
      check(`intelligence/${rota}: desligada em produção (disponivel=false, sem dado de pessoa)`, r.status === 200 && r.j?.disponivel === false, `HTTP ${r.status} disponivel=${r.j?.disponivel}`);
    }
  });
  // Política de cache do portal (PM, 24/11): 60 s só nas páginas SEM pessoas; pessoas/moves/Intelligence/sitemap e a matéria ficam no-store. Prova de caixa-preta: verificar-cache-headers.mjs.
  // Ícones do portal (achado D-2 do Senior Auditor, 24/11): /favicon.ico respondia 404 no staging com o app servindo 200 na origem. Era um 404 pré-renderizado do Next com
  // s-maxage de 1 ano guardado no Cloudflare desde o 1º deploy (sem o ícone). Quando falha, o detalhe mostra cf-cache-status e age para distinguir cache velho de ícone ausente.
  if (icones) await tentar('icones', async () => {
    for (const [caminho, tipo] of [['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/], ['/icon.svg', /image\/svg/], ['/apple-icon.png', /image\/png/]]) {
      const r = await get(caminho);
      const ct = r.h.get('content-type') ?? '';
      check(`icones: ${caminho} 200 com content-type de imagem`, r.status === 200 && tipo.test(ct), `HTTP ${r.status} ${ct.split(';')[0]} cf-cache-status=${r.h.get('cf-cache-status') ?? '-'} age=${r.h.get('age') ?? '-'}`);
    }
  });
  // Cabeçalhos de segurança (achado P2-6, 24/11): HSTS de produção (1 ano, sem includeSubDomains/preload), nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, CSP.
  if (seguranca) await tentar('seguranca', async () => {
    const v = await verificarSeguranca({ url: base, ambiente: 'production' });
    check(`seguranca: ${v.total} rotas/estáticos com os cabeçalhos de segurança (HSTS de produção; estáticos: só nosniff)${v.avisos ? ` [AVISO: ${v.avisos} cópia(s) antiga(s) na borda sem cabeçalhos, origem OK; purge_cache por URL completa: ${v.purgar.join(' ')}]` : ''}`, v.violacoes === 0, v.resultados.filter((x) => !x.ok).map((x) => `${x.rota}: ${x.problemas.join('; ')}`).join(' | ').slice(0, 700));
  });
  if (cache) await tentar('cache', async () => {
    const v = await verificar({ url: base, valores: { editoria: 'mercado' } });
    check(`cache: ${v.total} rotas conforme a política (60 s sem pessoas; no-store com pessoas, matéria e sitemap)`, v.violacoes === 0, v.resultados.filter((x) => !x.ok).map((x) => `${x.rota}: ${x.problemas.join('; ')}`).join(' | ').slice(0, 700));
  });
  const falhas = out.filter((c) => !c.ok).length;
  return { url: base, exigiu: { commit: commit ?? null, indexavel }, total: out.length, falhas, checagens: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url ?? '');
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1[:/]/.test(url)) { console.error('use --url https://host'); process.exit(2); }
  const commit = args['expect-commit'] && args['expect-commit'] !== true ? String(args['expect-commit']) : undefined;
  if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit)) { console.error('--expect-commit exige o SHA de 40 caracteres'); process.exit(2); }
  if (args['sem-conteudo-ainda'] && !args.indexavel) { console.error('--sem-conteudo-ainda só vale junto com --indexavel (sem go-live o sitemap e o feed já têm de estar vazios)'); process.exit(2); }
  const canonicalArg = args['expect-canonical'] && args['expect-canonical'] !== true ? String(args['expect-canonical']) : '';
  if (args['expect-canonical'] !== undefined && !/^https:\/\/[a-z0-9.-]+$/.test(canonicalArg.replace(/\/+$/, ''))) { console.error('--expect-canonical exige a URL https do domínio, sem caminho (ex.: https://www.loyaltynews.com.br)'); process.exit(2); }
  const cfgS = configSaude(args);
  const r = await rodar({ url, commit, indexavel: Boolean(args.indexavel), semConteudoAinda: Boolean(args['sem-conteudo-ainda']), canonical: canonicalArg, cache: Boolean(args['expect-cache']), icones: Boolean(args['expect-icones']), seguranca: Boolean(args['expect-seguranca']), consecutivas: cfgS.n, intervaloMs: cfgS.intervaloMs, timeout: Number(args.timeout ?? 20000) || 20000 });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.falhas ? 1 : 0);
}
