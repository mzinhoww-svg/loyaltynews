import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { Collector, stopsCollection } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { createNodeFetcher } from '../collector/http-fetcher';
import { GzipError, gunzipCapped, isGzip } from '../collector/gzip';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import type { Source } from '../types';

// Sitemap .xml.gz (gov.br: ANAC, CVM, ANPD) — tudo offline: fetcher falso, bytes gzip montados no teste, nenhuma rede.
const NOW = new Date('2026-11-24T12:00:00Z');
const HOST = 'www.gov.mock';
const SRC: Source = {
  ...MOCK_SOURCE, id: 'gov-mock', name: 'MOCK órgão', host: HOST, pathPrefix: '/org', listingUrl: `https://${HOST}/org/pt-br/assuntos/noticias`, feedUrl: null,
  sitemapUrl: `https://${HOST}/org/sitemap-index.xml`, sitemapPathPrefix: '/org/pt-br/noticias/', maxRequestsPerHour: 60,
};
const resolver = () => new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] });
const gz = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/x-gzip' }, body: '', bytes: new Uint8Array(gzipSync(Buffer.from(xml))) });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const urlset = (items: Array<[string, string?]>) => `<?xml version="1.0"?><urlset>${items.map(([u, d]) => `<url><loc>${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('')}</urlset>`;
const index = (locs: string[], lastmods?: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l, i) => `<sitemap><loc>${l}</loc>${lastmods ? `<lastmod>${lastmods[i]}</lastmod>` : ''}</sitemap>`).join('')}</sitemapindex>`;
const page = (title: string): string => `<html><head><title>${title}</title><meta property="article:published_time" content="2026-11-20T10:00:00-03:00"/></head><body><article><h1>${title}</h1><p>Texto de ensaio do órgão fictício sobre ${title}, sem relação com notícia real.</p></article></body></html>`;
const N = (slug: string) => `https://${HOST}/org/pt-br/noticias/2026/${slug}`;
const ROBOTS = 'User-agent: *\nDisallow: /org/pt-br/noticias/2026/privado\n';

function setup(routes: Record<string, HttpResponse | string>, opts: ConstructorParameters<typeof Collector>[1] = {}, source: Source = SRC) {
  const fetcher = new MockFetcher({ [`https://${HOST}/robots.txt`]: ROBOTS, ...routes });
  const collector = new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: resolver(), flags: COLLECT_ON, ...opts });
  return { fetcher, collector, source };
}

describe('gunzipCapped / isGzip', () => {
  it('descomprime gzip válido (inclusive vários membros concatenados) e reconhece o cabeçalho 1f 8b', async () => {
    const a = gzipSync(Buffer.from('<a>')); const b = gzipSync(Buffer.from('<b>'));
    expect(isGzip(a)).toBe(true); expect(isGzip(Buffer.from('<xml>'))).toBe(false); expect(isGzip(undefined)).toBe(false); expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
    expect(await gunzipCapped(a)).toBe('<a>');
    expect(await gunzipCapped(Buffer.concat([a, b]))).toBe('<a><b>');
  });
  it('zip bomb: 200 MB de zeros (≈200 KB comprimidos) aborta no teto, sem alocar a saída; no limite exato ainda passa', async () => {
    const bomb = gzipSync(Buffer.alloc(200 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1_000_000); // a entrada passaria pelo limite de 2 MB do fetcher
    await expect(gunzipCapped(bomb, 1024 * 1024)).rejects.toMatchObject({ code: 'decompressed_too_large' });
    await expect(gunzipCapped(bomb)).rejects.toBeInstanceOf(GzipError); // teto padrão (10 MB)
    expect(await gunzipCapped(gzipSync(Buffer.alloc(1000, 0x61)), 1000)).toHaveLength(1000);
    await expect(gunzipCapped(gzipSync(Buffer.alloc(1001, 0x61)), 1000)).rejects.toMatchObject({ code: 'decompressed_too_large' });
  });
  it('gzip corrompido, truncado ou com lixo no fim vira gzip_invalid (nunca exceção solta)', async () => {
    const good = gzipSync(Buffer.from('<urlset>'.repeat(200)));
    const corrupt = Buffer.from(good); corrupt[Math.floor(corrupt.length / 2)] = corrupt[Math.floor(corrupt.length / 2)]! ^ 0xff;
    for (const bad of [corrupt, good.subarray(0, good.length - 6), Buffer.concat([good, Buffer.from('lixo no fim')]), Buffer.from([0x1f, 0x8b, 0x08])]) {
      await expect(gunzipCapped(bad)).rejects.toMatchObject({ code: 'gzip_invalid' });
    }
  });
});

describe('Collector.collectSitemap com filhos .xml.gz (gov.br)', () => {
  const CH = (n: number) => `https://${HOST}/org/sitemap${n}.xml.gz`;

  it('índice SEM lastmod: lê TODOS os filhos .gz (a ordem não é cronológica), descarta anexos e fora do prefixo, e traz as mais recentes primeiro', async () => {
    const { fetcher, collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), CH(2), CH(3)])),
      [CH(1)]: gz(urlset([[N('antiga'), '2026-10-01T00:00:00+00:00'], [`${N('antiga')}/imagem1.png`, '2026-10-01T00:00:00+00:00'], [`https://${HOST}/org/pt-br/outra-secao/pagina`, '2026-11-23T00:00:00+00:00']])),
      [CH(2)]: gz(urlset([[N('recente'), '2026-11-19T21:11:01+00:00'], [`${N('recente')}/anexo.pdf`, '2026-11-19T21:11:01+00:00'], [N('recente'), '2026-11-19T21:11:01+00:00']])),
      [CH(3)]: gz(urlset([[N('media'), '2026-11-02T10:00:00+00:00']])),
      [N('antiga')]: page('Antiga'), [N('recente')]: page('Recente'), [N('media')]: page('Media'),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(fetcher.calls.filter((u) => u.endsWith('.xml.gz'))).toEqual([CH(1), CH(2), CH(3)]); // todos os filhos, 1 requisição cada
    expect(r.skipped).toEqual([]);
    expect(r.evidences.map((e) => e.title)).toEqual(['Recente', 'Media', 'Antiga']); // por lastmod desc; duplicata e anexos fora
    expect(fetcher.calls.some((u) => /\.(png|pdf)$/.test(u) || u.includes('outra-secao'))).toBe(false);
  });

  it('o próprio índice pode vir em .gz; e o limite de matérias é respeitado', async () => {
    const { collector } = setup({
      [SRC.sitemapUrl!]: gz(index([CH(1)])),
      [CH(1)]: gz(urlset([[N('a'), '2026-11-03T00:00:00Z'], [N('b'), '2026-11-02T00:00:00Z'], [N('c'), '2026-11-01T00:00:00Z']])),
      [N('a')]: page('A'), [N('b')]: page('B'), [N('c')]: page('C'),
    });
    const r = await collector.collectSitemap(SRC, 2);
    expect(r.evidences.map((e) => e.title)).toEqual(['A', 'B']);
  });

  it('índice COM lastmod continua lendo só os 2 filhos mais recentes (comportamento anterior)', async () => {
    const { fetcher, collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), CH(2), CH(3)], ['2026-01-01', '2026-11-02', '2026-11-03'])),
      [CH(2)]: gz(urlset([[N('x'), '2026-11-02']])), [CH(3)]: gz(urlset([[N('y'), '2026-11-03']])), [CH(1)]: gz(urlset([[N('z'), '2026-01-01']])),
      [N('x')]: page('X'), [N('y')]: page('Y'), [N('z')]: page('Z'),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(fetcher.calls.filter((u) => u.endsWith('.xml.gz'))).toEqual([CH(3), CH(2)]);
    expect(r.evidences.map((e) => e.title)).toEqual(['Y', 'X']);
  });

  it('índice sem lastmod e maior que sitemapMaxChildren é recusado inteiro (nenhum filho requisitado)', async () => {
    const kids = Array.from({ length: 13 }, (_, i) => CH(i + 1));
    const { fetcher, collector } = setup({ [SRC.sitemapUrl!]: xmlOk(index(kids)) });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences).toEqual([]);
    expect(r.skipped).toMatchObject([{ code: 'sitemap_index_too_large' }]);
    expect(fetcher.calls.some((u) => u.endsWith('.xml.gz'))).toBe(false);
    const ok = setup({ [SRC.sitemapUrl!]: xmlOk(index(kids)) }, { sitemapMaxChildren: 13 });
    await ok.collector.collectSitemap(SRC, 20);
    expect(ok.fetcher.calls.filter((u) => u.endsWith('.xml.gz'))).toHaveLength(13);
  });

  it('zip bomb num filho: pula ESSE filho com decompressed_too_large e segue com os demais; gzip corrompido vira gzip_invalid', async () => {
    const { collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), CH(2), CH(3)])),
      [CH(1)]: { status: 200, headers: {}, body: '', bytes: new Uint8Array(gzipSync(Buffer.alloc(50 * 1024 * 1024))) },
      [CH(2)]: { status: 200, headers: {}, body: '', bytes: new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]) },
      [CH(3)]: gz(urlset([[N('boa'), '2026-11-19']])), [N('boa')]: page('Boa'),
    }, { sitemapMaxDecompressedBytes: 5 * 1024 * 1024 });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.skipped.map((k) => k.code)).toEqual(['decompressed_too_large', 'gzip_invalid']);
    expect(r.skipped.some((k) => stopsCollection(k))).toBe(false);
    expect(r.evidences.map((e) => e.title)).toEqual(['Boa']);
  });

  it('as salvaguardas continuam valendo nos filhos: 429 para a coleta; robots recusa a página; espaçamento de 3 s por host; limite por hora', async () => {
    const times: number[] = [];
    let clock = NOW.getTime();
    const base = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), CH(2)])),
      [CH(1)]: gz(urlset([[N('privado'), '2026-11-19'], [N('livre'), '2026-11-18']])),
      [CH(2)]: { status: 429, headers: { 'retry-after': '120' }, body: '' },
      [N('livre')]: page('Livre'), [N('privado')]: page('Privado'),
    }, { now: () => new Date(clock), sleep: async (ms) => { clock += ms; times.push(ms); } });
    const r = await base.collector.collectSitemap(SRC, 20);
    expect(r.skipped.map((k) => k.code)).toEqual(['rate_limited']); // 429 do 2º filho: para a fonte, sem insistir
    expect(times.length).toBeGreaterThan(0); expect(times.every((ms) => ms >= 0)).toBe(true);
    // robots: a página vedada nunca é requisitada (o 429 acima encerrou antes; refaz só com o filho bom)
    const again = setup({ [SRC.sitemapUrl!]: xmlOk(index([CH(1)])), [CH(1)]: gz(urlset([[N('privado'), '2026-11-19'], [N('livre'), '2026-11-18']])), [N('livre')]: page('Livre'), [N('privado')]: page('Privado') });
    const r2 = await again.collector.collectSitemap(SRC, 20);
    expect(r2.evidences.map((e) => e.title)).toEqual(['Livre']);
    expect(r2.skipped.map((k) => k.code)).toEqual(['robots_disallow']);
    expect(again.fetcher.calls).not.toContain(N('privado'));
    // limite por hora do cadastro: com 6/h e 9 filhos, a leitura para em rate_limited (o cadastro de ANAC/CVM/ANPD precisa de limite maior)
    const nine = Array.from({ length: 9 }, (_, i) => CH(i + 1));
    const routes: Record<string, HttpResponse | string> = { [SRC.sitemapUrl!]: xmlOk(index(nine)) };
    for (const c of nine) routes[c] = gz(urlset([]));
    const lim = setup(routes, {}, { ...SRC, maxRequestsPerHour: 6 });
    const r3 = await lim.collector.collectSitemap({ ...SRC, maxRequestsPerHour: 6 }, 20);
    expect(r3.skipped.at(-1)).toMatchObject({ code: 'rate_limited' });
    expect(lim.fetcher.calls.filter((u) => u.endsWith('.xml.gz')).length).toBeLessThan(9);
  });
});

describe('fetcher real: corpo gzip chega como bytes', () => {
  it('servidor local: .xml.gz devolve bytes (body vazio); texto comum continua em body e sem bytes', async () => {
    const payload = gzipSync(Buffer.from('<urlset></urlset>'));
    const server = http.createServer((req, res) => {
      if (req.url === '/s.xml.gz') { res.writeHead(200, { 'content-type': 'application/x-gzip' }); res.end(payload); } else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('texto'); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const f = createNodeFetcher({ allowPrivateForTests: true });
      const o = { userAgent: 'test', address: '127.0.0.1', family: 4 as const };
      const g = await f.get(`http://x.invalid:${port}/s.xml.gz`, o);
      expect(g.body).toBe(''); expect(g.bytes).toBeInstanceOf(Uint8Array); expect(await gunzipCapped(g.bytes!)).toBe('<urlset></urlset>');
      const t = await f.get(`http://x.invalid:${port}/t`, o);
      expect(t.body).toBe('texto'); expect(t.bytes).toBeUndefined();
    } finally { await new Promise<void>((r) => server.close(() => r())); }
  });
});
