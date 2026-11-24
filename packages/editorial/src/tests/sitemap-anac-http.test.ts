import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Collector, stopsCollection } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { parseSitemap } from '../collector/parse';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';
import { SEED_SOURCES } from '../sources/seed';
import type { Source } from '../types';

// Caso real do QA 10 (24/11/2026): o índice do gov.br lista os filhos como http:// e o espelho http devolve <loc> corrompido
// ("http://www.gov.br/anachttps://www.gov.br/anac/…", 5.000 de 5.000 no sitemap1 da ANAC), enquanto o mesmo arquivo por https está correto.
// As amostras abaixo são recortes REAIS desses bytes (3 entradas fora do prefixo + 4 notícias de cada variante). Tudo offline.
const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/anac-sitemap1/${n}`, import.meta.url)), 'utf8');
const HTTP = fx('sitemap1-http.sample.xml');
const HTTPS = fx('sitemap1-https.sample.xml');
const NOW = new Date('2026-11-24T12:00:00Z');
const ANAC: Source = { ...SEED_SOURCES.find((s) => s.id === 'anac')!, enabled: true, termsStatus: 'approved', urlVerified: true, robotsRespected: true, paywall: 'none' };
const gz = (xml: string): HttpResponse => ({ status: 200, headers: {}, body: '', bytes: new Uint8Array(gzipSync(Buffer.from(xml))) });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const index = (locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;
const newsUrls = [...HTTPS.matchAll(/<loc>([^<]*\/anac\/pt-br\/noticias\/[^<]*)<\/loc>/g)].map((m) => m[1]!);
const page = (u: string) => `<html><head><title>Notícia ${u.split('/').pop()}</title></head><body><article><h1>Notícia ${u.split('/').pop()}</h1><p>Texto de ensaio da agência, usado só em teste offline, sem relação com notícia real.</p></article></body></html>`;
const ROUTES_PAGES = Object.fromEntries(newsUrls.map((u) => [u, page(u)]));

function setup(routes: Record<string, HttpResponse | string>, source: Source = ANAC) {
  const fetcher = new MockFetcher({ 'https://www.gov.br/robots.txt': 'User-agent: *\nDisallow: /economia/pt-br/internet/*\n', ...ROUTES_PAGES, ...routes });
  const collector = new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ 'www.gov.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
  return { fetcher, collector, source };
}

describe('amostras reais do sitemap1 da ANAC (QA 10)', () => {
  it('a variante http corrompida tem 7 de 7 <loc> com URL embutida (descartados e contados); a https tem 7 de 7 válidos', () => {
    expect(newsUrls).toHaveLength(4);
    const bad = parseSitemap(HTTP);
    expect(bad.blocos).toBe(7); expect(bad.entries).toEqual([]);
    expect(bad.drops).toMatchObject({ total: 7, loc_url_embutida: 7, loc_nao_http: 0, sem_loc: 0 });
    expect(bad.drops.amostra[0]).toMatch(/^http:\/\/www\.gov\.br\/anachttps:\/\/www\.gov\.br\/anac\//);
    const good = parseSitemap(HTTPS);
    expect(good.entries).toHaveLength(7); expect(good.drops.total).toBe(0);
  });

  it('seed: nenhuma fonte do cadastro usa http:// em sitemap, feed ou listagem (gov.br incluído)', () => {
    // loyalty-magazine (sitemap) e travel-codex (feed) estavam em http:// pela pesquisa de 22/11; o QA 10 conferiu ao vivo em 24/11:
    // https responde 200 nos dois (e o http do loyalty-magazine redireciona 301). Fonte nova em http:// quebra este teste de propósito.
    const http = SEED_SOURCES.flatMap((s) => [s.sitemapUrl, s.feedUrl, s.listingUrl].filter((u): u is string => !!u && u.startsWith('http://')).map((u) => `${s.id}: ${u}`));
    expect(http).toEqual([]);
    for (const s of SEED_SOURCES.filter((x) => x.host === 'www.gov.br')) for (const u of [s.sitemapUrl, s.feedUrl, s.listingUrl]) if (u) expect(u.startsWith('https://'), `${s.id}: ${u}`).toBe(true);
  });
});

describe('collectSitemap com o índice listando filhos http:// (caso real)', () => {
  it('sobe os filhos para https (só o próprio host), lê a variante correta, coleta as 4 notícias e avisa: sitemap_http_upgraded e sitemap_child_no_items do filho sem notícia', async () => {
    const { fetcher, collector, source } = setup({
      'https://www.gov.br/anac/sitemap-index.xml': xmlOk(index(['http://www.gov.br/anac/sitemap1.xml.gz', 'http://www.gov.br/anac/sitemap2.xml.gz'])),
      'http://www.gov.br/anac/sitemap1.xml.gz': gz(HTTP), // o espelho corrompido NÃO deve ser lido
      'https://www.gov.br/anac/sitemap1.xml.gz': gz(HTTPS),
      'https://www.gov.br/anac/sitemap2.xml.gz': gz(`<?xml version="1.0"?><urlset><url><loc>https://www.gov.br/anac/pt-br/assuntos/concessoes/x</loc></url><url><loc>https://www.gov.br/anac/pt-br/noticias/2026/foto.png</loc></url></urlset>`),
    });
    const r = await collector.collectSitemap(source, 20);
    expect(fetcher.calls.some((u) => u.startsWith('http://'))).toBe(false);
    expect(r.evidences.map((e) => e.url).sort()).toEqual([...newsUrls].sort());
    expect(r.skipped.map((k) => k.code).sort()).toEqual(['sitemap_child_no_items', 'sitemap_http_upgraded']);
    expect(r.skipped.find((k) => k.code === 'sitemap_http_upgraded')!.detail).toMatch(/^2 endereço\(s\) http:\/\//);
    expect(r.skipped.find((k) => k.code === 'sitemap_child_no_items')).toMatchObject({ url: 'https://www.gov.br/anac/sitemap2.xml.gz', detail: '0 páginas sob /anac/pt-br/noticias/: 2 entradas, 0 descartadas, 1 fora do prefixo, 1 anexos, 0 duplicadas' });
    expect(r.skipped.some((k) => stopsCollection(k))).toBe(false);
  });

  it('o mesmo defeito servido por https (ou qualquer filho corrompido): nada é "consertado" nem requisitado, e há aviso por filho, descarte por motivo e "0 páginas"', async () => {
    const { fetcher, collector, source } = setup({
      'https://www.gov.br/anac/sitemap-index.xml': xmlOk(index(['https://www.gov.br/anac/sitemap1.xml.gz'])),
      'https://www.gov.br/anac/sitemap1.xml.gz': gz(HTTP),
    });
    const r = await collector.collectSitemap(source, 20);
    expect(r.evidences).toEqual([]);
    expect(r.skipped.map((k) => k.code)).toEqual(['sitemap_entries_dropped', 'sitemap_child_no_items', 'sitemap_no_items']);
    expect(r.skipped[0]!.detail).toMatch(/^7 de 7 entradas descartadas \(loc_url_embutida 7\); amostra: "http:\/\/www\.gov\.br\/anachttps:\/\/www\.gov\.br\/anac\//);
    expect(r.skipped[2]!.detail).toBe('0 páginas sob /anac/pt-br/noticias/: 2 sitemap(s), 8 entradas, 7 descartadas, 0 fora do prefixo, 0 anexos, 0 duplicadas');
    expect(fetcher.calls.some((u) => u.includes('anachttps'))).toBe(false);
  });

  it('sitemapUrl cadastrado em http:// (erro de configuração) também é lido por https, com aviso', async () => {
    const { fetcher, collector } = setup({
      'https://www.gov.br/anac/sitemap-index.xml': xmlOk(index(['https://www.gov.br/anac/sitemap1.xml.gz'])),
      'https://www.gov.br/anac/sitemap1.xml.gz': gz(HTTPS),
    });
    const r = await collector.collectSitemap({ ...ANAC, sitemapUrl: 'http://www.gov.br/anac/sitemap-index.xml' }, 20);
    expect(fetcher.calls.some((u) => u.startsWith('http://'))).toBe(false);
    expect(r.evidences).toHaveLength(4);
    expect(r.skipped.map((k) => k.code)).toEqual(['sitemap_http_upgraded']);
  });

  it('http:// de OUTRO host nunca é promovido: continua recusado pelo SSRF (url_rejected), sem requisição', async () => {
    const { fetcher, collector, source } = setup({ 'https://www.gov.br/anac/sitemap-index.xml': xmlOk(index(['http://outro-host.example/anac/sitemap1.xml.gz'])) });
    const r = await collector.collectSitemap(source, 20);
    expect(r.skipped.map((k) => k.code)).toContain('url_rejected');
    expect(fetcher.calls.some((u) => u.includes('outro-host'))).toBe(false);
    // o aviso de upgrade conta só o que de fato subiu (próprio host): endereço de outro host recusado não pode inflar a contagem
    expect(r.skipped.some((k) => k.code === 'sitemap_http_upgraded')).toBe(false);
  });
});
