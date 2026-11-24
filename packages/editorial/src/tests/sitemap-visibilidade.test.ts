import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { Collector, stopsCollection } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { parseSitemap } from '../collector/parse';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import type { Source } from '../types';

// Visibilidade do sitemap: entradas descartadas e "0 páginas" viram aviso (skip), nunca "0 matérias" em silêncio. Tudo offline.
// O padrão malformado abaixo ("anachttps://…") é SINTÉTICO, copiado da descrição do QA 10: não foi possível reproduzi-lo nos 15 sitemaps reais de 24/11.
const NOW = new Date('2026-11-24T12:00:00Z');
const HOST = 'www.gov.mock';
const SRC: Source = {
  ...MOCK_SOURCE, id: 'gov-mock', name: 'MOCK órgão', host: HOST, pathPrefix: '/org', listingUrl: `https://${HOST}/org/pt-br/assuntos/noticias`, feedUrl: null,
  sitemapUrl: `https://${HOST}/org/sitemap-index.xml`, sitemapPathPrefix: '/org/pt-br/noticias/', maxRequestsPerHour: 60,
};
const gz = (xml: string): HttpResponse => ({ status: 200, headers: {}, body: '', bytes: new Uint8Array(gzipSync(Buffer.from(xml))) });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const block = (loc: string | null, d = '2026-11-19T00:00:00+00:00') => `<url>${loc === null ? '' : `<loc>${loc}</loc>`}<lastmod>${d}</lastmod></url>`;
const urlset = (blocks: string[]) => `<?xml version="1.0"?><urlset>${blocks.join('')}</urlset>`;
const index = (locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;
const page = (t: string) => `<html><head><title>${t}</title></head><body><article><h1>${t}</h1><p>Texto de ensaio do órgão fictício sobre ${t}, sem relação com notícia real.</p></article></body></html>`;
const N = (s: string) => `https://${HOST}/org/pt-br/noticias/2026/${s}`;
const CH = (n: number) => `https://${HOST}/org/sitemap${n}.xml.gz`;

function setup(routes: Record<string, HttpResponse | string>) {
  const fetcher = new MockFetcher({ [`https://${HOST}/robots.txt`]: 'User-agent: *\nDisallow:\n', ...routes });
  return { fetcher, collector: new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON }) };
}

describe('parseSitemap conta o que descarta', () => {
  it('separa "sem <loc>" de "<loc> que não é http(s)", limita a amostra a 3 e troca caracteres de controle', () => {
    const p = parseSitemap(urlset([
      block('https://a.example/ok'), block(null), block('anachttps://a.example/x'), block('ftp://a.example/y'), block('/relativo'), block('javascript:alert(1)'),
      block(`lixo${String.fromCharCode(0)}com-controle`),
    ]));
    expect(p.blocos).toBe(7);
    expect(p.entries.map((e) => e.loc)).toEqual(['https://a.example/ok']);
    expect(p.drops).toMatchObject({ total: 6, sem_loc: 1, loc_nao_http: 5 });
    expect(p.drops.amostra).toHaveLength(3);
    expect(p.drops.amostra.join('')).not.toContain(String.fromCharCode(0));
    expect(parseSitemap(urlset([block('https://a.example/1')])).drops).toEqual({ total: 0, sem_loc: 0, loc_nao_http: 0, amostra: [] });
    expect(parseSitemap('<html>não é sitemap</html>')).toMatchObject({ blocos: 0, entries: [], drops: { total: 0 } });
  });
});

describe('Collector.collectSitemap: avisos de visibilidade', () => {
  it('filho com entradas malformadas: aviso por filho com contagem por motivo e amostra; as boas são coletadas e a malformada NUNCA é requisitada nem "consertada"', async () => {
    const { fetcher, collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), CH(2)])),
      [CH(1)]: gz(urlset([block(N('boa')), block(`anac${N('ruim')}`), block(null), block(`anac${N('ruim2')}`)])),
      [CH(2)]: gz(urlset([block(N('outra'))])),
      [N('boa')]: page('Boa'), [N('outra')]: page('Outra'), [N('ruim')]: page('Ruim'),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences.map((e) => e.title).sort()).toEqual(['Boa', 'Outra']);
    const warn = r.skipped.filter((k) => k.code === 'sitemap_entries_dropped');
    expect(warn).toHaveLength(1); // só o CH(1): o CH(2) está limpo
    expect(warn[0]!.url).toBe(CH(1));
    expect(warn[0]!.detail).toMatch(/^3 de 4 entradas descartadas \(sem_loc 1, loc_nao_http 2\); amostra: "anachttps:\/\/www\.gov\.mock\//);
    expect(r.skipped.some((k) => k.code === 'sitemap_no_items')).toBe(false);
    expect(r.skipped.some((k) => stopsCollection(k))).toBe(false); // aviso não para a coleta da fonte
    expect(fetcher.calls.some((u) => u.includes('anac') || u.endsWith('/ruim'))).toBe(false); // sem normalização: nada de URL reescrita
  });

  it('todas as entradas de um filho malformadas (o cenário que o QA 10 descreveu): dois avisos, o do filho e o de "0 páginas" com os números; nenhuma matéria', async () => {
    const bad = Array.from({ length: 5 }, (_, i) => block(`anac${N(`p${i}`)}`));
    const { collector } = setup({ [SRC.sitemapUrl!]: xmlOk(index([CH(1)])), [CH(1)]: gz(urlset(bad)) });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences).toEqual([]);
    expect(r.skipped.map((k) => k.code)).toEqual(['sitemap_entries_dropped', 'sitemap_no_items']);
    expect(r.skipped[1]!.detail).toBe('0 páginas sob /org/pt-br/noticias/: 2 sitemap(s), 6 entradas, 5 descartadas, 0 fora do prefixo, 0 anexos, 0 duplicadas');
  });

  it('entrada malformada no próprio índice (ou sitemap simples) também gera aviso', async () => {
    const { collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1), `anac${CH(2)}`])),
      [CH(1)]: gz(urlset([block(N('a'))])), [N('a')]: page('A'),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences.map((e) => e.title)).toEqual(['A']);
    expect(r.skipped).toMatchObject([{ code: 'sitemap_entries_dropped', url: SRC.sitemapUrl, detail: expect.stringMatching(/^1 de 2 entradas descartadas \(loc_nao_http 1\)/) }]);
    const flat = setup({ [SRC.sitemapUrl!]: xmlOk(urlset([block(`anac${N('x')}`)])) });
    expect((await flat.collector.collectSitemap(SRC, 20)).skipped.map((k) => k.code)).toEqual(['sitemap_entries_dropped', 'sitemap_no_items']);
  });

  it('"0 páginas" sem nenhum descarte (tudo fora do prefixo, anexos ou duplicado) também avisa, com a causa em números', async () => {
    const { collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1)])),
      [CH(1)]: gz(urlset([block(`https://${HOST}/org/pt-br/outra-secao/p`), block(`${N('a')}/foto.png`), block(`${N('b')}/anexo.pdf`)])),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences).toEqual([]);
    expect(r.skipped.map((k) => k.code)).toEqual(['sitemap_no_items']);
    expect(r.skipped[0]!.detail).toBe('0 páginas sob /org/pt-br/noticias/: 2 sitemap(s), 4 entradas, 0 descartadas, 1 fora do prefixo, 2 anexos, 0 duplicadas');
  });

  it('sitemap limpo não gera aviso nenhum (e duplicata não vira alerta enquanto houver página)', async () => {
    const { collector } = setup({
      [SRC.sitemapUrl!]: xmlOk(index([CH(1)])), [CH(1)]: gz(urlset([block(N('a')), block(N('a'))])), [N('a')]: page('A'),
    });
    const r = await collector.collectSitemap(SRC, 20);
    expect(r.evidences.map((e) => e.title)).toEqual(['A']);
    expect(r.skipped).toEqual([]);
  });
});
