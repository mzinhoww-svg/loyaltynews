/**
 * Relatório por fonte do piloto (tarefa 17, proximas-tarefas-2026-11-24-0920.md): Senado, Câmara, as fontes classe D de
 * packages/editorial/docs/piloto-fontes.data.json e as gov.br do cadastro com feed/sitemap. Para cada fonte:
 *  - método de descoberta (RSS/Atom/sitemap/listagem) e resultado do parse (itens, com data, frescor);
 *  - 2 matérias lidas DIRETAMENTE (DirectReader: guarda SSRF, sem provedor, sem chave) → critério editorial v2, data, evidência de
 *    corpo e guarda de paywall com os marcadores da R5;
 *  - fixture local (ANAC) parseada sem rede.
 * ZERO chamadas tarifadas e nenhuma chave: só fetch direto de páginas públicas, ≥ 3 s por host (ritmo do coletor), 1 rodada.
 * Grava só métricas, títulos (≤ 300), datas e hashes (DP-29). Saída: data/pilot/pilot-report.json.
 * Uso: npx tsx packages/scraping-benchmark/scripts/pilot-report.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseFeed, discoveryMetrics } from '../src/discovery.ts';
import { DirectReader, BENCH_UA, ssrfResolve } from '../src/direct-reader.ts';
import { politeGet } from '../src/polite-get.ts';
import { evaluate, bodyEvidence, detectWall, sameDate, sha256 } from '../src/quality.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'packages', 'scraping-benchmark', 'data', 'pilot');
const pilot = JSON.parse(readFileSync(join(ROOT, 'packages', 'editorial', 'docs', 'piloto-fontes.data.json'), 'utf8')) as { fontes: Array<{ id: string; nome: string; classe: string; feed: string | null; sitemap: string | null; urlListagem: string; status: { cadastro: string } }> };

interface Src { id: string; nome: string; classe: string; origem: string; feed: string | null; sitemap: string | null; lista: string; cadastro: string }
const sources: Src[] = [
  ...pilot.fontes.map((f) => ({ id: f.id, nome: f.nome, classe: f.classe, origem: 'piloto-fontes.data.json', feed: f.feed, sitemap: f.sitemap, lista: f.urlListagem, cadastro: f.status.cadastro })),
  // gov.br do cadastro (packages/editorial/src/sources/seed.ts) com feed ou sitemap documentado
  { id: 'cvm-noticias', nome: 'CVM — notícias', classe: 'seed', origem: 'seed.ts', feed: 'https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS' /* o /2026/rss.xml do cadastro deu 404 em 24/11; o /RSS raiz também está no cadastro */, sitemap: null, lista: 'https://www.gov.br/cvm/pt-br/assuntos/noticias', cadastro: 'desabilitada' },
  { id: 'anac-noticias', nome: 'ANAC — notícias', classe: 'seed', origem: 'seed.ts', feed: null, sitemap: 'https://www.gov.br/anac/sitemap-index.xml', lista: 'https://www.gov.br/anac/pt-br/assuntos/noticias', cadastro: 'desabilitada' },
];

const lastHit = new Map<string, number>();
async function pace(url: string) {
  const h = new URL(url).hostname;
  const wait = (lastHit.get(h) ?? 0) + 3_500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(h, Date.now());
}

let directCalls = 0;
async function getXml(url: string) {
  const bad = await ssrfResolve(url);
  if (bad.reason) return { status: 0, body: '', ms: 0, err: `ssrf:${bad.reason}` };
  await pace(url);
  directCalls++;
  const t0 = Date.now();
  try {
    const r = await politeGet(url, { userAgent: BENCH_UA, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' });
    if (r.err || r.status < 200 || r.status >= 300) return { status: r.status, body: '', ms: Date.now() - t0, ...(r.err ? { err: r.err } : {}) };
    // sitemaps .xml.gz (gov.br/anac): o corpo vem comprimido como arquivo, não como Content-Encoding
    const buf = r.body;
    const body = /\.gz$/i.test(new URL(url).pathname) && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return { status: r.status, body, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: '', ms: Date.now() - t0, err: String((e as Error).message).slice(0, 120) };
  }
}

const reader = new DirectReader();
const ONLY = process.argv.slice(2); // ids para refazer (as outras fontes são mantidas do relatório anterior)
const prev = (() => { try { return JSON.parse(readFileSync(join(OUT, 'pilot-report.json'), 'utf8')) as { sources: Array<{ id: string }>; directCalls: number }; } catch { return null; } })();
/** Listagem HTML sem feed/sitemap: extrai links de matéria do mesmo host (href com slug longo). */
function listingLinks(html: string, base: string) {
  const host = new URL(base).hostname;
  const seen = new Set<string>();
  const out: Array<{ url: string; title: string; publishedAt: string | null }> = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(m[1]!, base); } catch { continue; }
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const title = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (u.hostname !== host || last.length < 25 || (last.match(/-/g) ?? []).length < 3 || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ url: u.href, title: title.slice(0, 300), publishedAt: null });
  }
  return out;
}
const now = new Date();
const rows: unknown[] = [];

for (const s of sources.filter((x) => !ONLY.length || ONLY.includes(x.id))) {
  const method = s.feed ? 'rss/atom' : s.sitemap ? 'sitemap' : 'listagem HTML (sem feed/sitemap)';
  const discoveryUrl = s.feed ?? s.sitemap ?? s.lista;
  let disc = await getXml(discoveryUrl);
  let parsed = disc.body ? parseFeed(disc.body) : { kind: 'unknown' as const, items: [] as Array<{ url: string; title: string; publishedAt: string | null }> };
  // índice de sitemap: desce no 1º sitemap filho que pareça de notícias (1 leitura a mais)
  if (parsed.kind === 'sitemapindex' && parsed.items.length) {
    const child = parsed.items.find((i) => /noticia|news|imprensa/i.test(i.url)) ?? parsed.items[0]!;
    disc = await getXml(child.url);
    parsed = disc.body ? parseFeed(disc.body) : parsed;
  }
  if (parsed.kind === 'unknown' && disc.body && /<html|<a\s/i.test(disc.body)) parsed = { kind: 'unknown', items: listingLinks(disc.body, discoveryUrl) };
  const articles = parsed.items.filter((i) => /^https?:/.test(i.url) && !/\.(pdf|jpe?g|png|zip|docx?)$/i.test(i.url) && (s.id !== 'livelo-imprensa' || /\/imprensa\//.test(i.url)) && (s.id !== 'anac-noticias' || /\/noticias\//.test(i.url))).slice(0, 2);
  const reads = [];
  for (const a of articles) {
    await pace(a.url);
    directCalls++;
    const t0 = Date.now();
    const r = await reader.read({ url: a.url });
    const v = evaluate(r.text, r.html, a.title || '', r.httpStatus);
    const b = bodyEvidence(r.text, r.html);
    reads.push({
      url: a.url,
      httpStatus: r.httpStatus ?? null,
      ok: r.ok,
      failure: r.failure ?? null,
      ms: Date.now() - t0,
      titleRef: (a.title || '').slice(0, 300),
      titlePage: v.meta.title?.slice(0, 300) ?? null,
      titleMatch: +v.titleMatch.toFixed(3),
      // sem título de referência (sitemap sem news:title): título não verificável; critério = texto ≥ 600 e sem login/paywall
      editorialV2: r.ok && (a.title ? v.editorialSuccess : v.textLength >= 600 && b.longParagraphs >= 1 && !detectWall({ text: r.text, html: r.html, httpStatus: r.httpStatus })),
      titleVerifiable: !!a.title,
      reason: v.reason,
      dateMatch: sameDate(v.meta.publishedAt, a.publishedAt),
      textLength: v.textLength,
      longestParagraphChars: b.longestParagraphChars,
      longParagraphs: b.longParagraphs,
      wall: r.ok ? detectWall({ text: r.text, html: r.html, httpStatus: r.httpStatus }) : null, // marcadores R5
      contentHash: r.text ? sha256(r.text) : null,
    });
  }
  rows.push({
    ...s,
    method,
    discovery: { url: discoveryUrl, ...discoveryMetrics(discoveryUrl, method, parsed.items, disc.ms, now, { httpStatus: disc.status }), parsedAs: parsed.kind, error: (disc as { err?: string }).err ?? null },
    reads,
    tariffedCalls: 0,
    keysUsed: 0,
  });
  console.log(`${s.id}: ${disc.status} ${parsed.kind} ${parsed.items.length} itens; leituras ${reads.map((r) => `${r.httpStatus}/${r.editorialV2 ? 'ok' : r.reason}/${r.wall ?? '-'}`).join(' ')}`);
}

// fixture local, sem rede (gov.br/anac)
const fixtures = ['sitemap1-http.sample.xml', 'sitemap1-https.sample.xml'].map((f) => {
  const xml = readFileSync(join(ROOT, 'packages', 'editorial', 'fixtures', 'anac-sitemap1', f), 'utf8');
  const p = parseFeed(xml);
  return { fixture: `packages/editorial/fixtures/anac-sitemap1/${f}`, parsedAs: p.kind, items: p.items.length, withDate: p.items.filter((i) => i.publishedAt).length, sampleUrl: p.items[0]?.url ?? null };
});

mkdirSync(OUT, { recursive: true });
const merged = ONLY.length && prev ? sources.map((x) => (rows as Array<{ id: string }>).find((r) => r.id === x.id) ?? prev.sources.find((p) => p.id === x.id)).filter(Boolean) : rows;
const totalDirect = directCalls + (ONLY.length && prev ? prev.directCalls : 0);
writeFileSync(join(OUT, 'pilot-report.json'), JSON.stringify({ generatedAt: now.toISOString(), base: 'int/019 7fd57ac', tariffedCalls: 0, keysUsed: 0, directCalls: totalDirect, pacing: '≥ 3,5 s por host, 1 requisição por vez', sources: merged, fixtures }, null, 2));
console.log(`chamadas diretas (não tarifadas): ${directCalls}; tarifadas: 0; chaves: 0`);
