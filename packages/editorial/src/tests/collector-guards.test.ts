import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector, stopsCollection } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, MockFetcher, mockResolver } from '../../fixtures/mock-web.mock';
import type { FetchOptions, HttpResponse } from '../collector/collector';

// QA 2 (r0-preparacao/qa/ft-fabrica-editorial.md): intervalo mínimo por host, robots a cada redirecionamento,
// desafio/CAPTCHA com HTTP 200 e 429 nunca escondido por outro gate.

const HOST = 'ri.mock.example';
const PAGE = (n: number | string) => `<html><head><title>MOCK ${n}</title></head><body><article><h1>MOCK ${n}</h1><p>Texto da matéria ${n}: o programa fictício anunciou novas regras de acúmulo para os participantes, com vigência e condições descritas no comunicado oficial.</p><p>Segundo parágrafo da matéria ${n} com mais detalhes do comunicado, das condições e dos parceiros envolvidos, apenas para passar do tamanho mínimo.</p></article></body></html>`;
const OPEN = 'User-agent: *\nDisallow: /privado/';

class Clock {
  t = Date.parse('2026-11-25T12:00:00Z');
  now = () => new Date(this.t);
  sleep = async (ms: number) => { this.t += ms; };
}
/** Fetcher que registra o instante (relógio simulado) de cada requisição. */
class Timed extends MockFetcher {
  log: Array<{ url: string; at: number }> = [];
  constructor(private readonly clock: Clock, routes: Record<string, HttpResponse | string>) { super(routes); }
  override async get(url: string, opts: FetchOptions): Promise<HttpResponse> { this.log.push({ url, at: this.clock.t }); return super.get(url, opts); }
}
const mk = (routes: Record<string, HttpResponse | string>, over: ConstructorParameters<typeof Collector>[1] = {}) => {
  const clock = new Clock();
  const f = new Timed(clock, { [`https://${HOST}/robots.txt`]: OPEN, ...routes });
  return { clock, f, c: new Collector(f, { now: clock.now, sleep: clock.sleep, resolver: mockResolver(), flags: COLLECT_ON, ...over }) };
};
const u = (p: string) => `https://${HOST}${p}`;

test('(1) intervalo mínimo de 3 s por host mesmo SEM Crawl-delay no robots.txt (a 1ª requisição ao host não espera)', async () => {
  const { f, c } = mk({ [u('/noticias/1')]: PAGE(1), [u('/noticias/2')]: PAGE(2), [u('/noticias/3')]: PAGE(3) });
  for (const n of [1, 2, 3]) assert.ok((await c.collectUrl(MOCK_SOURCE, u(`/noticias/${n}`))).evidence);
  assert.equal(f.log[0]!.url, u('/robots.txt'));
  const pages = f.log.filter((l) => !l.url.endsWith('/robots.txt')).map((l) => l.at);
  assert.equal(pages.length, 3);
  for (let i = 1; i < pages.length; i++) assert.ok(pages[i]! - pages[i - 1]! >= 3000, `intervalo ${i}: ${pages[i]! - pages[i - 1]!} ms`);
  assert.ok(f.log[1]!.at - f.log[0]!.at >= 3000, 'também entre o robots.txt e a 1ª página');
});

test('(1b) Crawl-delay maior que 3 s continua valendo; minSpacingMs configurável', async () => {
  const a = mk({ [u('/noticias/1')]: PAGE(1), [u('/noticias/2')]: PAGE(2) }, {});
  a.f.routes.set(u('/robots.txt'), { status: 200, headers: {}, body: 'User-agent: *\nCrawl-delay: 10\nDisallow:' });
  await a.c.collectUrl(MOCK_SOURCE, u('/noticias/1')); await a.c.collectUrl(MOCK_SOURCE, u('/noticias/2'));
  const p = a.f.log.filter((l) => !l.url.endsWith('/robots.txt')).map((l) => l.at);
  assert.ok(p[1]! - p[0]! >= 10_000);
  const b = mk({ [u('/noticias/1')]: PAGE(1), [u('/noticias/2')]: PAGE(2) }, { minSpacingMs: 7000 });
  await b.c.collectUrl(MOCK_SOURCE, u('/noticias/1')); await b.c.collectUrl(MOCK_SOURCE, u('/noticias/2'));
  const q = b.f.log.filter((l) => !l.url.endsWith('/robots.txt')).map((l) => l.at);
  assert.ok(q[1]! - q[0]! >= 7000);
});

test('(2) redirecionamento: o destino passa pelo robots.txt ANTES de ser buscado; destino vedado = robots_disallow e nada é buscado', async () => {
  const { f, c } = mk({
    [u('/noticias/antiga')]: { status: 301, headers: { location: '/privado/relatorio' }, body: '' },
    [u('/privado/relatorio')]: PAGE('privado'),
    [u('/noticias/mudou')]: { status: 302, headers: { location: '/noticias/nova' }, body: '' },
    [u('/noticias/nova')]: PAGE('nova'),
  });
  const bad = await c.collectUrl(MOCK_SOURCE, u('/noticias/antiga'));
  assert.equal(bad.evidence, undefined);
  assert.equal(bad.skip?.code, 'robots_disallow');
  assert.match(bad.skip!.detail, /\/privado\/relatorio/);
  assert.ok(!f.log.some((l) => l.url === u('/privado/relatorio')), 'o destino vedado NÃO foi buscado');
  const ok = await c.collectUrl(MOCK_SOURCE, u('/noticias/mudou'));
  assert.ok(ok.evidence, 'redirecionamento para caminho permitido segue normalmente');
  assert.ok(f.log.some((l) => l.url === u('/noticias/nova')));
});

test('(2b) redirecionamento para OUTRO host segue recusado (url_rejected), sem requisição ao destino', async () => {
  const { f, c } = mk({ [u('/noticias/fora')]: { status: 301, headers: { location: 'https://outro.example/x' }, body: '' }, 'https://outro.example/x': PAGE('x') });
  const r = await c.collectUrl(MOCK_SOURCE, u('/noticias/fora'));
  assert.equal(r.skip?.code, 'url_rejected');
  assert.ok(!f.log.some((l) => l.url.startsWith('https://outro.example')));
});

const CHALLENGE = `<html><head><title>Just a moment...</title></head><body><div id="challenge-form"><p>Verifying you are human. This may take a few seconds.</p></div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>${'<p>x</p>'.repeat(80)}</body></html>`;

test('(3) desafio/CAPTCHA que responde HTTP 200 é pulado como "challenge" (nunca vira evidência) e PARA a coleta da fonte', async () => {
  const feed = `<rss><channel>${[1, 2, 3].map((n) => `<item><title>MOCK ${n}</title><link>${u(`/noticias/${n}`)}</link></item>`).join('')}</channel></rss>`;
  const { f, c } = mk({ [u('/feed.xml')]: feed, [u('/noticias/1')]: CHALLENGE, [u('/noticias/2')]: PAGE(2), [u('/noticias/3')]: PAGE(3) });
  const single = await c.collectUrl(MOCK_SOURCE, u('/noticias/1'));
  assert.equal(single.evidence, undefined); assert.equal(single.skip?.code, 'challenge');
  const r = await c.collectFeed(MOCK_SOURCE);
  assert.deepEqual(r.skipped.map((s) => s.code), ['challenge']);
  assert.equal(r.evidences.length, 0, 'a coleta parou no desafio');
  assert.ok(!f.log.some((l) => l.url === u('/noticias/2') || l.url === u('/noticias/3')), 'não insiste nos demais itens');
  assert.ok(stopsCollection({ code: 'challenge', detail: '' }));
});

test('(3b) feed e sitemap que respondem desafio com 200 também são pulados; robots.txt que vem como HTML/desafio = robots_unavailable (fail closed)', async () => {
  const a = mk({ [u('/feed.xml')]: CHALLENGE });
  const rf = await a.c.collectFeed(MOCK_SOURCE);
  assert.deepEqual(rf.skipped.map((s) => s.code), ['challenge']);
  const b = mk({ [u('/noticias/1')]: PAGE(1) });
  b.f.routes.set(u('/robots.txt'), { status: 200, headers: {}, body: CHALLENGE });
  const r = await b.c.collectUrl(MOCK_SOURCE, u('/noticias/1'));
  assert.equal(r.skip?.code, 'robots_unavailable');
  assert.ok(!b.f.log.some((l) => l.url === u('/noticias/1')), 'sem robots legível, nenhuma página é buscada');
  const d = mk({ [u('/noticias/1')]: PAGE(1) });
  d.f.routes.set(u('/robots.txt'), { status: 200, headers: {}, body: '<!DOCTYPE html><html><head><title>Home</title></head><body>página inicial no lugar do robots</body></html>' });
  assert.equal((await d.c.collectUrl(MOCK_SOURCE, u('/noticias/1'))).skip?.code, 'robots_unavailable');
});

test('(4) 429 com corpo que parece login/paywall continua sendo rate_limited (não "gated") e PARA a coleta; 403 também para', async () => {
  const feed = `<rss><channel>${[1, 2, 3].map((n) => `<item><title>MOCK ${n}</title><link>${u(`/noticias/${n}`)}</link></item>`).join('')}</channel></rss>`;
  const body429 = '<html><body><h1>Muitas requisições</h1><p>Faça login para continuar. Assine para ler o restante. Conteúdo exclusivo para assinantes.</p></body></html>';
  const a = mk({ [u('/feed.xml')]: feed, [u('/noticias/1')]: { status: 429, headers: { 'retry-after': '90' }, body: body429 }, [u('/noticias/2')]: PAGE(2), [u('/noticias/3')]: PAGE(3) });
  const r = await a.c.collectFeed(MOCK_SOURCE);
  assert.deepEqual(r.skipped.map((s) => s.code), ['rate_limited']);
  assert.match(r.skipped[0]!.detail, /Retry-After: 90/);
  assert.ok(!a.f.log.some((l) => l.url === u('/noticias/2')), 'não insiste depois do 429');
  const b = mk({ [u('/feed.xml')]: feed, [u('/noticias/1')]: { status: 403, headers: {}, body: body429 }, [u('/noticias/2')]: PAGE(2), [u('/noticias/3')]: PAGE(3) });
  const rb = await b.c.collectFeed(MOCK_SOURCE);
  assert.deepEqual(rb.skipped.map((s) => `${s.code}:${s.detail}`), ['http_error:403']);
  assert.ok(!b.f.log.some((l) => l.url === u('/noticias/2')), '403 também interrompe a coleta da fonte');
  // 429 também na leitura do feed
  const c2 = mk({ [u('/feed.xml')]: { status: 429, headers: {}, body: body429 } });
  assert.deepEqual((await c2.c.collectFeed(MOCK_SOURCE)).skipped.map((s) => s.code), ['rate_limited']);
});

test('(5) robots.txt pelo módulo comum (RFC 9309): caminho percent-encoded equivale ao decodificado; UA só casa grupo pelo token exato', async () => {
  const a = mk({ [u('/%70rivado/x')]: PAGE('x'), [u('/noticias/ok')]: PAGE('ok') });
  const r = await a.c.collectUrl(MOCK_SOURCE, u('/%70rivado/x'));
  assert.equal(r.skip?.code, 'robots_disallow', 'Disallow: /privado/ também barra /%70rivado/ (RFC 9309 §2.2.2)');
  assert.ok(!a.f.log.some((l) => l.url === u('/%70rivado/x')));
  assert.ok((await a.c.collectUrl(MOCK_SOURCE, u('/noticias/ok'))).evidence);
  // "loyaltynews" (substring do nosso token) não forma grupo específico: vale o '*'
  const b = mk({ [u('/noticias/ok')]: PAGE('ok') });
  b.f.routes.set(u('/robots.txt'), { status: 200, headers: {}, body: 'User-agent: loyaltynews\nDisallow: /\n\nUser-agent: *\nDisallow: /privado/' });
  assert.ok((await b.c.collectUrl(MOCK_SOURCE, u('/noticias/ok'))).evidence);
});

test('(6) onDirectRead (shadow ao vivo): só leituras DIRETAS de página, com status, corpo e latência; erro do observador não afeta o coletor', async () => {
  const seen: Array<{ url: string; sourceId: string; status: number; len: number; ms: number }> = [];
  const mkC = (onDirectRead: (e: { url: string; sourceId: string; status: number; body?: string; ms: number }) => void) => mk({
    [u('/noticias/1')]: PAGE(1), [u('/noticias/403')]: { status: 403, headers: {}, body: 'negado' }, [u('/feed.xml')]: `<rss><channel><item><title>MOCK 1</title><link>${u('/noticias/1')}</link></item></channel></rss>`,
  }, { onDirectRead });
  const a = mkC((e) => { seen.push({ url: e.url, sourceId: e.sourceId, status: e.status, len: e.body?.length ?? -1, ms: e.ms }); });
  assert.ok((await a.c.collectUrl(MOCK_SOURCE, u('/noticias/1'))).evidence);
  await a.c.collectUrl(MOCK_SOURCE, u('/noticias/403'));
  await a.c.collectFeed(MOCK_SOURCE); // feed e robots NÃO são observados; a página do item sim
  assert.deepEqual(seen.map((s) => [s.url, s.status]), [[u('/noticias/1'), 200], [u('/noticias/403'), 403], [u('/noticias/1'), 200]]);
  assert.ok(seen[0]!.len > 100 && seen[0]!.sourceId === 'mock-ri' && seen[0]!.ms >= 0);
  assert.ok(!seen.some((s) => s.url.endsWith('/robots.txt') || s.url.endsWith('/feed.xml')));
  const b = mkC(() => { throw new Error('sombra quebrada'); });
  const r = await b.c.collectUrl(MOCK_SOURCE, u('/noticias/1'));
  assert.ok(r.evidence, 'o resultado do coletor é o mesmo mesmo com o observador quebrado');
  const off = mk({ [u('/noticias/1')]: PAGE(1) });
  assert.equal((await off.c.collectUrl(MOCK_SOURCE, u('/noticias/1'))).evidence?.contentSha256, r.evidence?.contentSha256, 'sem observador: mesma evidência');
});
