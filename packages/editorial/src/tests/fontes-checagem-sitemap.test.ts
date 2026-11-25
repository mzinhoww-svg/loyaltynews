import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { Collector, stopsCollection } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';
import { SEED_SOURCES } from '../sources/seed';
import type { Source } from '../types';

// Coleta OFFLINE (MockFetcher) das fontes que ganharam sitemap na checagem de 25/11/2026: o coletor aceita o sitemap, os filhos e as páginas
// (host e pathPrefix da fonte), pega só o que está sob o prefixo de notícias e não confunde nada com bloqueio. As páginas são de ensaio.
const NOW = new Date('2026-11-25T12:00:00Z');
const live = (id: string): Source => ({ ...SEED_SOURCES.find((s) => s.id === id)!, enabled: true, termsStatus: 'approved', urlVerified: true, robotsRespected: true, paywall: 'none' });
const gz = (xml: string): HttpResponse => ({ status: 200, headers: {}, body: '', bytes: new Uint8Array(gzipSync(Buffer.from(xml))) });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const index = (kids: Array<[string, string?]>) => `<?xml version="1.0"?><sitemapindex>${kids.map(([l, m]) => `<sitemap><loc>${l}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</sitemap>`).join('')}</sitemapindex>`;
const urlset = (es: Array<[string, string?]>) => `<?xml version="1.0"?><urlset>${es.map(([l, m]) => `<url><loc>${l}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`).join('')}</urlset>`;
const page = (u: string) => `<html><head><title>Texto ${u.split('/').pop()}</title></head><body><article><h1>Texto ${u.split('/').pop()}</h1><p>Texto de ensaio, usado só em teste offline e sem relação com notícia real.</p></article></body></html>`;

function run(source: Source, routes: Record<string, HttpResponse | string>, pages: string[]) {
  const host = source.host;
  const fetcher = new MockFetcher({ [`https://${host}/robots.txt`]: 'User-agent: *\nDisallow:\n', ...Object.fromEntries(pages.map((u) => [u, page(u)])), ...routes });
  const collector = new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ [host]: [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
  return { fetcher, collector };
}

describe('coleta por sitemap das fontes cadastradas na checagem de 25/11/2026 (offline)', () => {
  it('ANATEL e Ministério do Turismo: índice .xml.gz sem lastmod, lê todos os filhos, coleta só /assuntos/noticias/ e ignora anexo e seção alheia', async () => {
    for (const [id, base] of [['anatel', 'anatel'], ['mtur', 'turismo']] as const) {
      const s = live(id);
      const n1 = `https://www.gov.br/${base}/pt-br/assuntos/noticias/a-primeira`; const n2 = `https://www.gov.br/${base}/pt-br/assuntos/noticias/a-segunda`;
      const { fetcher, collector } = run(s, {
        [s.sitemapUrl!]: xmlOk(index([[`https://www.gov.br/${base}/sitemap1.xml.gz`], [`https://www.gov.br/${base}/sitemap2.xml.gz`]])),
        [`https://www.gov.br/${base}/sitemap1.xml.gz`]: gz(urlset([[n1, '2026-11-24T10:00:00+00:00'], [`https://www.gov.br/${base}/pt-br/composicao/x`, '2026-11-24T11:00:00+00:00'], [`${n1}/foto.png`, '2026-11-24T12:00:00+00:00']])),
        [`https://www.gov.br/${base}/sitemap2.xml.gz`]: gz(urlset([[n2, '2026-11-23T10:00:00+00:00']])),
      }, [n1, n2]);
      const r = await collector.collectSitemap(s, 20);
      expect(r.evidences.map((e) => e.url).sort(), id).toEqual([n1, n2].sort());
      expect(r.skipped.some((k) => stopsCollection(k)), id).toBe(false);
      expect(fetcher.calls.some((u) => new URL(u).host !== 'www.gov.br'), id).toBe(false);
    }
  });

  it('Dinheirama: sitemap de artigos direto, só /artigos/', async () => {
    const s = live('dinheirama');
    const a = 'https://investimentos.com.br/artigos/curva-de-juros/'; const b = 'https://investimentos.com.br/artigos/halving-do-bitcoin/';
    const { collector } = run(s, { [s.sitemapUrl!]: xmlOk(urlset([[a, '2026-10-21T18:37:48.810Z'], [b, '2026-10-15T17:50:42.189Z'], ['https://investimentos.com.br/simuladores/x/', '2026-11-25T12:43:22.358Z']])) }, [a, b]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url)).toEqual([a, b]); expect(r.skipped).toEqual([]);
  });

  it('IDV: índice com lastmod lê os 2 filhos mais recentes; o de sala de imprensa não rende nada sob /noticia/ e vira aviso, não bloqueio', async () => {
    const s = live('idv');
    const n = 'https://www.idv.org.br/noticia/reforma-tributaria-deve-manter-preco-cheio-nas-gondolas/';
    const { collector } = run(s, {
      [s.sitemapUrl!]: xmlOk(index([['https://www.idv.org.br/sala_de_imprensa-sitemap1.xml', '2026-10-28T15:10:00+00:00'], ['https://www.idv.org.br/noticia-sitemap1.xml', '2026-10-28T15:45:41+00:00'], ['https://www.idv.org.br/noticia-sitemap3.xml', '2026-10-07T23:48:20+00:00']])),
      'https://www.idv.org.br/noticia-sitemap1.xml': xmlOk(urlset([[n, '2026-10-07T23:56:37+00:00']])),
      'https://www.idv.org.br/sala_de_imprensa-sitemap1.xml': xmlOk(urlset([['https://www.idv.org.br/sala_de_imprensa/x/', '2026-10-28T15:10:00+00:00']])),
    }, [n]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url)).toEqual([n]);
    expect(r.skipped.map((k) => k.code)).toEqual(['sitemap_child_no_items']); expect(r.skipped.some((k) => stopsCollection(k))).toBe(false);
  });

  it('Nubank: filho institutional.xml com pathPrefix da fonte nulo; só /pt/sala-de-imprensa/ entra (a versão em inglês e as páginas institucionais ficam de fora)', async () => {
    const s = live('nubank-newsroom');
    const n = 'https://nu.com/pt/sala-de-imprensa/companhia/nubank-recebe-aprovacao';
    const { collector } = run(s, { [s.sitemapUrl!]: xmlOk(urlset([[n, '2026-11-19T11:55:02.000Z'], ['https://nu.com/en/newsroom/company/nu-mexico', '2026-11-19T10:05:15.000Z'], ['https://nu.com/pt/cartao-de-credito', '2026-11-20T10:00:00.000Z']])) }, [n]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url)).toEqual([n]); expect(r.skipped.some((k) => stopsCollection(k))).toBe(false);
  });

  it('Meu Bolso em Dia: com o host sem www, as URLs do sitemap (todas sem www) passam; só /Materias/ entra', async () => {
    const s = live('guia-bolso-blog');
    const n = 'https://meubolsoemdia.com.br/Materias/pretende-fazer-compras-na-black-friday';
    const { collector } = run(s, { [s.sitemapUrl!]: xmlOk(urlset([[n, '2026-11-05'], ['https://meubolsoemdia.com.br/planilhas', '2026-11-25']])) }, [n]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url)).toEqual([n]); expect(r.skipped).toEqual([]);
  });

  it('com o host antigo (www), o mesmo sitemap seria recusado: é por isso que o host mudou', async () => {
    const s = { ...live('guia-bolso-blog'), host: 'www.meubolsoemdia.com.br' };
    const n = 'https://meubolsoemdia.com.br/Materias/pretende-fazer-compras-na-black-friday';
    const { collector } = run(s, { [s.sitemapUrl!]: xmlOk(urlset([[n, '2026-11-05']])) }, [n]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences).toEqual([]);
  });

  // robots.txt REAL do onemileatatime.com (25/11/2026, trechos): o feed é proibido, o news-sitemap e /news/ não (QA 10 reprovou o cadastro do feed)
  const ROBOTS_OMAAT = 'User-agent: *\nDisallow: /cdn-cgi/\nDisallow: */feed/\nDisallow: *?s=\nDisallow: *?fromIata\nDisallow: *?cards\nDisallow: /participants/paged/\nSitemap: https://onemileatatime.com/sitemap_index.xml\n';

  it('One Mile at a Time: sem feedUrl (o robots proíbe */feed/); coleta o news-sitemap.xml, só /news/, com o robots real', async () => {
    const s = live('one-mile-at-a-time');
    expect(s.feedUrl).toBeNull(); expect(s.sitemapUrl).toBe('https://onemileatatime.com/news-sitemap.xml'); expect(s.sitemapPathPrefix).toBe('/news/');
    const a = 'https://onemileatatime.com/news/orient-express-sailing-yachts/'; const b = 'https://onemileatatime.com/news/delta-singapore-flights/';
    const { fetcher, collector } = run(s, { 'https://onemileatatime.com/robots.txt': ROBOTS_OMAAT, [s.sitemapUrl!]: xmlOk(urlset([[a, '2026-11-25T06:27:28+00:00'], [b, '2026-11-24T02:02:22+00:00'], ['https://onemileatatime.com/ryanair-crew-sleep-on-airport-floor/', '2026-10-26T15:12:02+00:00']])) }, [a, b]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url).sort()).toEqual([a, b].sort());
    expect(r.skipped.some((k) => k.code === 'robots_disallow' || stopsCollection(k))).toBe(false);
    expect(fetcher.calls.some((u) => /\/feed/.test(u))).toBe(false);
  });

  it('o feed que tinha sido cadastrado (/feed/) é barrado pelo robots real: robots_disallow, e nenhuma requisição ao feed', async () => {
    const s = { ...live('one-mile-at-a-time'), feedUrl: 'https://onemileatatime.com/feed/' };
    const { fetcher, collector } = run(s, { 'https://onemileatatime.com/robots.txt': ROBOTS_OMAAT, 'https://onemileatatime.com/feed/': '<rss><channel><item><title>x</title><link>https://onemileatatime.com/x/</link></item></channel></rss>' }, []);
    const r = await collector.collectFeed(s, 20);
    expect(r.evidences).toEqual([]);
    expect(r.skipped.map((k) => k.code)).toEqual(['robots_disallow']);
    expect(fetcher.calls.includes('https://onemileatatime.com/feed/')).toBe(false);
  });

  it('nenhum feedUrl do cadastro cai em um padrão proibido conhecido: o seed não repete o erro do */feed/ (conferido ao vivo em 25/11 com o parser real)', () => {
    for (const id of ['abav', 'edpb']) expect(live(id).feedUrl, id).toMatch(/^https:\/\//);
    expect(SEED_SOURCES.filter((x) => x.host === 'onemileatatime.com' && x.feedUrl).map((x) => x.id)).toEqual([]);
  });
});
