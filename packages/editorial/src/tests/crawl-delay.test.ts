import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import type { Fetcher, HttpResponse, FetchOptions } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver } from '../../fixtures/mock-web.mock';

const HOST = 'ri.mock.example';
const PAGE = (n: number) => `<html><body><article><h1>MOCK ${n}</h1><p>Texto fictício número ${n} para teste do ritmo de coleta.</p></article></body></html>`;

/** Relógio falso: sleep avança o tempo sem esperar de verdade. */
class Clock {
  t = Date.parse('2026-11-23T12:00:00Z');
  sleeps: number[] = [];
  now = () => new Date(this.t);
  sleep = async (ms: number) => { this.sleeps.push(ms); this.t += ms; };
}

/** Fetcher MOCK que registra o instante (do relógio falso) de cada requisição. */
class TimedFetcher implements Fetcher {
  log: Array<{ url: string; at: number }> = [];
  private readonly clock: Clock; private readonly robots: string;
  constructor(clock: Clock, robots: string) { this.clock = clock; this.robots = robots; }
  async get(url: string, _o: FetchOptions): Promise<HttpResponse> {
    this.log.push({ url, at: this.clock.t });
    if (url.endsWith('/robots.txt')) return { status: 200, headers: {}, body: this.robots };
    const n = Number(/\/noticias\/(\d+)/.exec(url)?.[1] ?? 0);
    if (url.endsWith('/feed.xml')) {
      const items = [1, 2, 3, 4, 5].map((i) => `<item><title>MOCK ${i}</title><link>https://${HOST}/noticias/${i}</link></item>`).join('');
      return { status: 200, headers: {}, body: `<rss><channel>${items}</channel></rss>` };
    }
    return { status: 200, headers: {}, body: PAGE(n) };
  }
}

const mk = (robots: string, over: Partial<ConstructorParameters<typeof Collector>[1]> = {}) => {
  const clock = new Clock();
  const f = new TimedFetcher(clock, robots);
  const c = new Collector(f, { minSpacingMs: 0, now: clock.now, sleep: clock.sleep, resolver: mockResolver(), flags: COLLECT_ON, ...over });
  return { clock, f, c };
};
const pages = (f: TimedFetcher) => f.log.filter((l) => !l.url.endsWith('/robots.txt'));

test('Crawl-delay do robots.txt (ex.: 10 s) é aplicado entre requisições ao mesmo host; o robots.txt em si não espera', async () => {
  const { clock, f, c } = mk('User-agent: *\nCrawl-delay: 10\nDisallow:');
  for (const n of [1, 2, 3]) assert.ok((await c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/${n}`)).evidence);
  const robots = f.log.find((l) => l.url.endsWith('/robots.txt'))!;
  assert.equal(robots.at, Date.parse('2026-11-23T12:00:00Z'), 'robots.txt buscado sem espera');
  const times = pages(f).map((l) => l.at);
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= 10_000, `intervalo ${i}: ${times[i]! - times[i - 1]!} ms`);
  assert.ok(times[0]! - robots.at >= 10_000, 'a 1ª página também respeita o delay desde o robots.txt');
  assert.deepEqual(clock.sleeps, [10_000, 10_000, 10_000]);
});

test('delay já cumprido pelo tempo real decorrido: não dorme à toa', async () => {
  const { clock, c } = mk('User-agent: *\nCrawl-delay: 10');
  await c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/1`);
  const before = clock.sleeps.length;
  clock.t += 60_000; // passou 1 minuto
  await c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/2`);
  assert.equal(clock.sleeps.length, before, 'sem espera adicional');
});

test('sem Crawl-delay no robots.txt: nenhuma espera', async () => {
  const { clock, c } = mk('User-agent: *\nDisallow: /privado/');
  for (const n of [1, 2, 3]) await c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/${n}`);
  assert.deepEqual(clock.sleeps, []);
});

test('Crawl-delay excessivo (acima do máximo): a fonte é pulada, nenhuma página é requisitada e o feed não insiste', async () => {
  const { f, c } = mk('User-agent: *\nCrawl-delay: 600');
  const r = await c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/1`);
  assert.equal(r.skip?.code, 'crawl_delay_excessive');
  assert.equal(pages(f).length, 0);
  const feed = await c.collectFeed(MOCK_SOURCE);
  assert.equal(feed.evidences.length, 0);
  assert.ok(feed.skipped.length >= 1 && feed.skipped.length <= 2);
  assert.ok(feed.skipped.every((s) => s.code === 'crawl_delay_excessive'));
  // com limite maior configurado, a espera acontece
  const big = mk('User-agent: *\nCrawl-delay: 600', { maxCrawlDelaySec: 900 });
  assert.ok((await big.c.collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/1`)).evidence);
  assert.deepEqual(big.clock.sleeps, [600_000]);
});

test('limite por hora da fonte (maxRequestsPerHour): excedido => rate_limited sem requisição; libera após 1 h', async () => {
  const src = { ...MOCK_SOURCE, maxRequestsPerHour: 4 };
  const { clock, f, c } = mk('User-agent: *\nDisallow:');
  // robots.txt (1) + 3 páginas (2,3,4) = 4 requisições
  for (const n of [1, 2, 3]) assert.ok((await c.collectUrl(src, `https://${HOST}/noticias/${n}`)).evidence, `página ${n}`);
  const before = f.log.length;
  const blocked = await c.collectUrl(src, `https://${HOST}/noticias/4`);
  assert.equal(blocked.skip?.code, 'rate_limited');
  assert.equal(f.log.length, before, 'nenhuma requisição foi enviada');
  clock.t += 3_600_001;
  assert.ok((await c.collectUrl(src, `https://${HOST}/noticias/4`)).evidence);
});

test('feed com limite por hora: para no primeiro rate_limited em vez de repetir', async () => {
  const src = { ...MOCK_SOURCE, maxRequestsPerHour: 4, feedUrl: `https://${HOST}/feed.xml` };
  const { c } = mk('User-agent: *\nDisallow:');
  const r = await c.collectFeed(src);
  // robots(1) + feed(2) + 2 itens (3,4); o 3º item bate no limite
  assert.equal(r.evidences.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.code), ['rate_limited']);
});
