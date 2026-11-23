import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector, StopGuard, capText } from '../collector/collector';
import type { FetchOptions, HttpResponse, ReaderPort, ReaderResult } from '../collector/collector';
import { isAllowedByRobots, parseRobots } from '../collector/robots';
import { TavilyReader, parseTavilyKeys } from '../collector/tavily-reader';
import { StoreReadBudget } from '../factory/read-budget';
import { InMemoryEditorialStore } from '../api/store';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import type { Source } from '../types';

// QA 2, 3ª rodada (r0-preparacao/qa/ft-fabrica-editorial.md): um teste por item.

const HOST = 'ri.mock.example';
const u = (p: string) => `https://${HOST}${p}`;
const resolver = () => new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]], 'blog.mock.example': [[MOCK_PUBLIC_IP]] });
const OPEN = 'User-agent: *\nDisallow: /privado/';
const PAGE = (n: number | string) => `<html><head><title>MOCK ${n}</title></head><body><article><h1>MOCK ${n}</h1><p>Texto da matéria ${n}: o programa fictício anunciou novas regras de acúmulo para os participantes, com vigência e condições descritas no comunicado oficial publicado hoje.</p><p>Segundo parágrafo da matéria ${n} com mais detalhes do comunicado e das condições, apenas para passar do tamanho mínimo exigido.</p></article></body></html>`;
class Clock { t = Date.parse('2026-11-25T12:00:00Z'); now = () => new Date(this.t); sleep = async (ms: number) => { this.t += ms; }; }
class Logged extends MockFetcher {
  log: string[] = [];
  override async get(url: string, opts: FetchOptions): Promise<HttpResponse> { this.log.push(url); return super.get(url, opts); }
}
const mk = (routes: Record<string, HttpResponse | string>, over: ConstructorParameters<typeof Collector>[1] = {}) => {
  const clock = new Clock();
  const f = new Logged({ [u('/robots.txt')]: OPEN, ...routes });
  return { clock, f, c: new Collector(f, { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, minSpacingMs: 0, ...over }) };
};
const SM = (n: number) => `<urlset>${Array.from({ length: n }, (_, i) => `<url><loc>${u(`/noticias/${i + 1}`)}</loc><lastmod>2026-11-2${i}</lastmod></url>`).join('')}</urlset>`;
const SRC_SM: Source = { ...MOCK_SOURCE, id: 'mock-sm', feedUrl: null, sitemapUrl: u('/sitemap.xml'), sitemapPathPrefix: '/noticias/' };
const INDEX = `<sitemapindex><sitemap><loc>${u('/s-a.xml')}</loc><lastmod>2026-11-20</lastmod></sitemap><sitemap><loc>${u('/s-b.xml')}</loc><lastmod>2026-11-10</lastmod></sitemap></sitemapindex>`;
const CHALLENGE = `<html><head><title>Just a moment...</title></head><body><div id="challenge-form"><p>Verifying you are human.</p></div>${'<p>x</p>'.repeat(80)}<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>`;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === '.next') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs)$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
}

test('(1) nenhum código de produção (worker incluído) injeta intervalo zero; o padrão do coletor é 3 s por host e 10 s na DP-31', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url)); // raiz do repositório
  const files = [...walk(join(root, 'apps/workers/src')), ...walk(join(root, 'packages/editorial/src')), ...walk(join(root, 'apps/web/app/api/_lib'))];
  const bad = files.filter((f) => /(minSpacingMs|dp31SpacingMs)\s*:\s*0\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, [], 'intervalo zero só é permitido em arquivo de teste');
  const col = readFileSync(join(root, 'packages/editorial/src/collector/collector.ts'), 'utf8');
  assert.match(col, /opts\.minSpacingMs \?\? 3000/); assert.match(col, /opts\.dp31SpacingMs \?\? 10_000/); assert.match(col, /opts\.dp31MaxPagesPerDay \?\? 5/);
  const worker = readFileSync(join(root, 'apps/workers/src/editorial-factory.ts'), 'utf8');
  assert.match(worker, /new Collector\(createNodeFetcher\(\), \{ now, resolver: systemResolver, flags, readBudget: new StoreReadBudget\(store\)/, 'o worker usa o padrão (sem override) e o orçamento global');
});

test('(2) robots.ts não tem mais parser/comparador próprio: tudo decide pelo módulo comum, inclusive no redirecionamento; Crawl-delay pelo token exato', async () => {
  const r = parseRobots('User-agent: loyaltynews\nCrawl-delay: 99\n\nUser-agent: LoyaltyNewsBot\nCrawl-delay: 5\nDisallow: /a/\n\nUser-agent: *\nCrawl-delay: 20\nDisallow: /b/', 'LoyaltyNewsBot/0.1 (+x)');
  assert.deepEqual(Object.keys(r).sort(), ['crawlDelaySec', 'decide', 'ruleCount'], 'sem listas allow/disallow próprias');
  assert.equal(r.crawlDelaySec, 5, 'grupo do token exato (substring "loyaltynews" não vale)');
  assert.equal(isAllowedByRobots(r, '/a/x'), false); assert.equal(isAllowedByRobots(r, '/b/x'), true);
  assert.equal(isAllowedByRobots(parseRobots('User-agent: *\nDisallow: /privado/', 'x/1'), '/%70rivado/y'), false, 'normalização percent-encoded do módulo comum');
  const src = readFileSync(fileURLToPath(new URL('../collector/robots.ts', import.meta.url)), 'utf8');
  assert.ok(!/matchLen|new RegExp|\.allow\b|\.disallow\b/.test(src), 'robots.ts sem comparador próprio');
  // redirecionamento: o destino é decidido pelo MESMO módulo
  const { f, c } = mk({ [u('/noticias/a')]: { status: 301, headers: { location: '/%70rivado/relatorio' }, body: '' }, [u('/privado/relatorio')]: PAGE('p') });
  const res = await c.collectUrl(MOCK_SOURCE, u('/noticias/a'));
  assert.equal(res.skip?.code, 'robots_disallow');
  assert.ok(!f.log.includes(u('/%70rivado/relatorio')));
});

test('(3) sitemap: depois de 403, desafio ou 429 num filho do índice (ou no próprio sitemap) NÃO se continua', async () => {
  for (const [name, bad] of [['403', { status: 403, headers: {}, body: '' }], ['429', { status: 429, headers: {}, body: '' }], ['desafio', { status: 200, headers: {}, body: CHALLENGE }]] as const) {
    const { f, c } = mk({ [u('/sitemap.xml')]: INDEX, [u('/s-a.xml')]: bad, [u('/s-b.xml')]: SM(2), [u('/noticias/1')]: PAGE(1), [u('/noticias/2')]: PAGE(2) });
    const r = await c.collectSitemap(SRC_SM);
    assert.equal(r.evidences.length, 0, name);
    assert.ok(!f.log.includes(u('/s-b.xml')), `${name}: o segundo filho do índice não foi aberto`);
    assert.ok(!f.log.some((l) => l.includes('/noticias/')), `${name}: nenhuma página lida`);
  }
  const top = mk({ [u('/sitemap.xml')]: { status: 403, headers: {}, body: '' } });
  assert.deepEqual((await top.c.collectSitemap(SRC_SM)).skipped.map((s) => s.code), ['http_error']);
});

test('(4) falha por URL e gates PARAM a rodada: 2 login/paywall seguidos, 3 falhas seguidas, falha do serviço de leitura na hora; sucesso zera', async () => {
  // StopGuard direto
  const g = new StopGuard();
  const gated = { url: 'x', code: 'gated' as const, detail: '' }; const err = { url: 'x', code: 'http_error' as const, detail: '404' };
  assert.equal(g.note(gated), false); assert.equal(g.note(gated), true, '2 gated seguidos');
  const h = new StopGuard();
  assert.equal(h.note(err), false); assert.equal(h.note(err), false); assert.equal(h.note(undefined), false); assert.equal(h.note(err), false); assert.equal(h.note(err), false); assert.equal(h.note(err), true, '3 falhas seguidas (o sucesso zerou antes)');
  assert.equal(new StopGuard().note({ url: 'x', code: 'http_error', detail: 'reader_failed' }), true);
  assert.equal(new StopGuard().note({ url: 'x', code: 'robots_disallow', detail: '' }), false, 'robots/url_rejected não são hostilidade da fonte');
  // no feed: 5 itens, todos com login → para no 2º
  const feed = `<rss><channel>${[1, 2, 3, 4, 5].map((n) => `<item><title>MOCK ${n}</title><link>${u(`/noticias/${n}`)}</link></item>`).join('')}</channel></rss>`;
  const LOGIN = '<html><body><article><h1>Exclusivo</h1><p>Assine para ler o restante deste conteúdo. Faça login para continuar.</p></article></body></html>';
  const a = mk({ [u('/feed.xml')]: feed, ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [u(`/noticias/${n}`), LOGIN])) });
  const ra = await a.c.collectFeed(MOCK_SOURCE);
  assert.deepEqual(ra.skipped.map((s) => s.code), ['gated', 'gated']);
  assert.equal(a.f.log.filter((l) => l.includes('/noticias/')).length, 2, 'não leu as demais');
  // 404 em série: 3 e para
  const b = mk({ [u('/feed.xml')]: feed });
  const rb = await b.c.collectFeed(MOCK_SOURCE);
  assert.equal(rb.skipped.length, 3);
  // DP-31: serviço não conseguiu ler a URL → para na hora, sem repetir
  const DP: Source = { ...MOCK_SOURCE, id: 'dp', host: 'blog.mock.example', kind: 'blog', acesso: 'risco-aceito-dp31', feedUrl: null, listingUrl: 'https://blog.mock.example/' };
  const calls: string[] = [];
  const reader: ReaderPort = { name: 'x', read: async (url) => { calls.push(url); return { status: 502, body: '', failedUrl: true }; }, discover: async () => [1, 2, 3].map((n) => ({ url: `https://blog.mock.example/p${n}` })) };
  const d = new Collector(new MockFetcher({}), { now: new Clock().now, sleep: async () => {}, resolver: resolver(), flags: COLLECT_ON, reader });
  const rd = await d.collectFeed(DP);
  assert.deepEqual(rd.skipped.map((s) => `${s.code}:${s.detail}`), ['http_error:reader_failed']);
  assert.equal(calls.length, 1);
});

test('(5) limite diário e espaçamento DP-31 são GLOBAIS: duas instâncias do coletor sobre o mesmo banco somam as leituras', async () => {
  const store = new InMemoryEditorialStore();
  const clock = new Clock();
  const DP: Source = { ...MOCK_SOURCE, id: 'dp', host: 'blog.mock.example', kind: 'blog', acesso: 'risco-aceito-dp31', feedUrl: null, listingUrl: 'https://blog.mock.example/' };
  const reads: Array<{ who: string; at: number }> = [];
  const mkInst = (who: string) => {
    const reader: ReaderPort = { name: who, read: async (): Promise<ReaderResult> => { reads.push({ who, at: clock.t }); return { status: 200, body: 'Texto da matéria. '.repeat(40), format: 'text' }; } };
    return new Collector(new MockFetcher({}), { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, reader, readBudget: new StoreReadBudget(store) });
  };
  const A = mkInst('A'); const B = mkInst('B');
  for (const [c, n] of [[A, 1], [B, 2], [A, 3], [B, 4], [A, 5]] as const) assert.ok((await c.collectUrl(DP, `https://blog.mock.example/p${n}`)).evidence, `leitura ${n}`);
  const sixth = await B.collectUrl(DP, 'https://blog.mock.example/p6');
  assert.equal(sixth.skip?.code, 'rate_limited'); assert.match(sixth.skip!.detail, /5 páginas por dia/);
  assert.equal(reads.length, 5, 'a 6ª não foi lida');
  for (let i = 1; i < reads.length; i++) assert.ok(reads[i]!.at - reads[i - 1]!.at >= 10_000, `entre instâncias: ${reads[i]!.at - reads[i - 1]!.at} ms`);
  // um "restart": instância nova sobre o mesmo banco continua barrada
  assert.equal((await mkInst('C').collectUrl(DP, 'https://blog.mock.example/p7')).skip?.code, 'rate_limited');
  assert.equal((await store.listAudit()).filter((a) => a.action === 'collector.dp31_read').length, 5);
  clock.t += 25 * 3600_000;
  assert.ok((await mkInst('D').collectUrl(DP, 'https://blog.mock.example/p8')).evidence, 'a janela de 24 h libera');
});

test('(6) o corte do trecho nunca passa do máximo (1.500), inclusive exatamente no limite e com reticência', () => {
  const MAX = 1500;
  assert.equal(capText('a'.repeat(MAX), MAX).length, MAX, 'exatamente no máximo: intacto');
  for (const n of [MAX + 1, MAX + 2, MAX + 50, 5000]) assert.ok(capText('a'.repeat(n), MAX).length <= MAX, `${n} caracteres`);
  const noSpace = capText('a'.repeat(MAX + 1), MAX);
  assert.ok(noSpace.endsWith('…') && noSpace.length === MAX);
  const sentences = capText('Uma frase curta do comunicado. '.repeat(100), MAX);
  assert.ok(sentences.length <= MAX && sentences.endsWith('.'), 'corta no fim de frase');
  assert.equal(capText('', MAX), ''); assert.ok(capText('abcdef', 3).length <= 3);
});

test('Tavily com várias chaves em ordem: troca SÓ quando a cota do serviço acaba; 429 por ritmo não troca; valores nunca aparecem em erros', async () => {
  assert.deepEqual(parseTavilyKeys({ LN_TAVILY_API_KEYS: ' k1 , k2,,k1 ' }), ['k1', 'k2']);
  assert.deepEqual(parseTavilyKeys({ LN_TAVILY_API_KEY: 'solo' }), ['solo']);
  assert.deepEqual(parseTavilyKeys({}), []);
  const used: string[] = [];
  const respond = (status: number, json: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json', ...headers } });
  let plan: (key: string, n: number) => Response = () => respond(200, { results: [{ url: 'https://x.example/a', raw_content: 'texto' }] });
  let n = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => { const key = new Headers(init?.headers).get('authorization')!.replace('Bearer ', ''); used.push(key); return plan(key, ++n); }) as typeof fetch;

  // 1ª chave esgota por cota (432): refaz a MESMA chamada com a 2ª; as próximas já usam a 2ª
  plan = (key) => key === 'KEY-1' ? respond(432, { detail: { error: "This request exceeds your plan's set usage limit." } }) : respond(200, { results: [{ url: 'https://x.example/a', raw_content: 'ok' }] });
  const t = new TavilyReader({ apiKeys: ['KEY-1', 'KEY-2'], fetchImpl });
  assert.equal(t.keysLeft, 2);
  assert.equal((await t.read('https://x.example/a')).body, 'ok');
  assert.deepEqual(used, ['KEY-1', 'KEY-2']);
  await t.read('https://x.example/b');
  assert.deepEqual(used.slice(2), ['KEY-2'], 'a 1ª não é tentada de novo');
  assert.equal(t.keysLeft, 1);

  // 429 de CRÉDITO/cota também troca
  used.length = 0;
  const t2 = new TavilyReader({ apiKeys: ['KEY-1', 'KEY-2'], fetchImpl });
  plan = (key) => key === 'KEY-1' ? respond(429, { detail: { error: 'You have run out of credits for this month.' } }) : respond(200, { results: [{ url: 'https://x.example/a', raw_content: 'ok2' }] });
  assert.equal((await t2.read('https://x.example/a')).body, 'ok2');
  assert.deepEqual(used, ['KEY-1', 'KEY-2']);

  // 429 por RITMO do serviço: NÃO troca; devolve 429 com Retry-After (a coleta para)
  used.length = 0;
  const t3 = new TavilyReader({ apiKeys: ['KEY-1', 'KEY-2'], fetchImpl });
  plan = () => respond(429, { detail: { error: 'Your request has been blocked due to excessive requests. Please reduce the rate of requests.' } }, { 'retry-after': '60' });
  assert.deepEqual(await t3.read('https://x.example/a'), { status: 429, body: '', retryAfterSec: 60 });
  assert.deepEqual(used, ['KEY-1'], 'não gastou a 2ª chave por causa de ritmo');
  assert.equal(t3.keysLeft, 2);

  // todas as cotas esgotadas: sinaliza (sem expor chaves) e a coleta DP-31 fica indisponível, sem fallback
  used.length = 0;
  const t4 = new TavilyReader({ apiKeys: ['KEY-1', 'KEY-2'], fetchImpl });
  plan = () => respond(432, { detail: { error: 'plan limit' } });
  const dead = await t4.read('https://x.example/a');
  assert.deepEqual(dead, { status: 432, body: '', quotaExhausted: true });
  assert.deepEqual(used, ['KEY-1', 'KEY-2']);
  await assert.rejects(() => t4.discover({ ...MOCK_SOURCE, name: 'X' }, 3), (e: Error) => /cota do serviço esgotada/.test(e.message) && !/KEY-/.test(e.message));
  const DP: Source = { ...MOCK_SOURCE, id: 'dp', host: 'blog.mock.example', kind: 'blog', acesso: 'risco-aceito-dp31', feedUrl: null };
  const col = new Collector(new MockFetcher({}), { now: new Clock().now, sleep: async () => {}, resolver: resolver(), flags: COLLECT_ON, reader: t4 });
  const sk = await col.collectUrl(DP, 'https://blog.mock.example/p1');
  assert.equal(sk.skip?.code, 'reader_unavailable'); assert.match(sk.skip!.detail, /cota do serviço de leitura esgotada/);
  assert.ok(!JSON.stringify(sk).includes('KEY-'));
  assert.throws(() => new TavilyReader({ apiKeys: [] }), (e: Error) => /nenhuma chave/.test(e.message));

  // chave rejeitada (401, ex.: valor que não é do Tavily): pula para a próxima; se todas forem rejeitadas, devolve 401 e a coleta para
  used.length = 0;
  plan = (key) => key === 'BAD' ? respond(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } }) : respond(200, { results: [{ url: 'https://x.example/a', raw_content: 'ok3' }] });
  const t5 = new TavilyReader({ apiKeys: ['BAD', 'GOOD'], fetchImpl });
  assert.equal((await t5.read('https://x.example/a')).body, 'ok3');
  assert.deepEqual(used, ['BAD', 'GOOD']); assert.equal(t5.keysRejected, 1);
  used.length = 0;
  plan = () => respond(401, { detail: { error: 'Unauthorized' } });
  const t6 = new TavilyReader({ apiKeys: ['BAD1', 'BAD2'], fetchImpl });
  assert.deepEqual(await t6.read('https://x.example/a'), { status: 401, body: '' });
  assert.equal(t6.keysRejected, 2);
  const col6 = new Collector(new MockFetcher({}), { now: new Clock().now, sleep: async () => {}, resolver: resolver(), flags: COLLECT_ON, reader: t6 });
  const s6 = await col6.collectUrl(DP, 'https://blog.mock.example/p1');
  assert.equal(`${s6.skip?.code}:${s6.skip?.detail}`, 'http_error:401');
  assert.ok(new StopGuard().note(s6.skip), 'chave inválida para a coleta');
});
