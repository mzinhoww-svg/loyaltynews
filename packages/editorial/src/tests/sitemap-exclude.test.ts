import { describe, expect, it } from 'vitest';
import { Collector, stopsCollection } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';
import { SEED_SOURCES } from '../sources/seed';
import { SourceRegistry } from '../sources/registry';
import type { Source } from '../types';

// sitemapPathExclude: caminhos que o prefixo não consegue tirar (listagens com lastmod renovado, a própria seção). Caso real: o sitemap do Accor tem 35
// páginas /en/news-stories/page/N com o lastmod da última geração, que passariam à frente das matérias no corte de 5 por rodada.
const NOW = new Date('2026-11-25T12:00:00Z');
const live = (id: string): Source => ({ ...SEED_SOURCES.find((s) => s.id === id)!, enabled: true, termsStatus: 'approved', urlVerified: true, robotsRespected: true, paywall: 'none' });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const urlset = (es: Array<[string, string?]>) => `<?xml version="1.0"?><urlset>${es.map(([l, m]) => `<url><loc>${l}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`).join('')}</urlset>`;
const page = (u: string) => `<html><head><title>Texto ${u.split('/').pop()}</title></head><body><article><h1>Texto ${u.split('/').pop()}</h1><p>Texto de ensaio, usado só em teste offline e sem relação com notícia real.</p></article></body></html>`;
function run(source: Source, sitemapXml: string, pages: string[]) {
  const host = source.host;
  const fetcher = new MockFetcher({ [`https://${host}/robots.txt`]: 'User-agent: *\nDisallow:\n', [source.sitemapUrl!]: xmlOk(sitemapXml), ...Object.fromEntries(pages.map((u) => [u, page(u)])) });
  const collector = new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ [host]: [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
  return { fetcher, collector };
}

describe('sitemapPathExclude no cadastro', () => {
  const base = SEED_SOURCES.find((s) => s.id === 'idv')!;
  it('o registro recusa padrão que não compila, vazio, longo demais ou mais de 10', () => {
    expect(() => new SourceRegistry([{ ...base, sitemapPathExclude: ['('] }])).toThrow(/não compila/);
    expect(() => new SourceRegistry([{ ...base, sitemapPathExclude: [''] }])).toThrow(/vazio ou com mais de 120/);
    expect(() => new SourceRegistry([{ ...base, sitemapPathExclude: ['x'.repeat(121)] }])).toThrow(/vazio ou com mais de 120/);
    expect(() => new SourceRegistry([{ ...base, sitemapPathExclude: Array.from({ length: 11 }, (_, i) => `^/a${i}$`) }])).toThrow(/mais de 10/);
    expect(() => new SourceRegistry([{ ...base, sitemapPathExclude: ['^/noticia/?$'] }])).not.toThrow();
  });
  it('as fontes que usam a regra: Accor (listagens page/N) e IDV (a própria /noticia/), ambas ancoradas e dentro do prefixo do sitemap', () => {
    const com = SEED_SOURCES.filter((s) => s.sitemapPathExclude?.length).map((s) => s.id).sort();
    expect(com).toEqual(['accor-newsroom', 'idv']);
    for (const s of SEED_SOURCES.filter((x) => x.sitemapPathExclude?.length)) for (const p of s.sitemapPathExclude!) { expect(p.startsWith('^') && p.endsWith('$'), `${s.id}: ${p} ancorado`).toBe(true); expect(() => new RegExp(p)).not.toThrow(); }
  });
});

describe('collectSitemap com sitemapPathExclude (offline)', () => {
  it('Accor: as listagens page/N têm lastmod mais novo e NÃO ocupam o corte; as 5 matérias mais recentes são coletadas', async () => {
    const s = live('accor-newsroom');
    const listas = Array.from({ length: 8 }, (_, i): [string, string] => [`https://group.accor.com/en/news-stories/page/${i + 1}`, '2026-11-24T16:20:32.282Z']);
    const materias = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i): [string, string] => [`https://group.accor.com/en/news-stories/materia-${x}`, `2026-11-${20 - i}T10:00:00.000Z`]);
    const { collector } = run(s, urlset([...listas, ...materias, ['https://group.accor.com/en/finance/x', '2026-11-25T00:00:00Z']]), materias.map(([u]) => u));
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url).sort()).toEqual(materias.slice(0, 5).map(([u]) => u).sort());
    expect(r.skipped.some((k) => stopsCollection(k))).toBe(false);
  });

  it('sem a regra, as listagens passariam à frente (o motivo da regra): o mesmo sitemap sem sitemapPathExclude coleta só listagens', async () => {
    const s = { ...live('accor-newsroom'), sitemapPathExclude: null };
    const listas = Array.from({ length: 8 }, (_, i): [string, string] => [`https://group.accor.com/en/news-stories/page/${i + 1}`, '2026-11-24T16:20:32.282Z']);
    const materia: [string, string] = ['https://group.accor.com/en/news-stories/materia-a', '2026-11-20T10:00:00.000Z'];
    const { collector } = run(s, urlset([...listas, materia]), [...listas.map(([u]) => u), materia[0]]);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences.map((e) => e.url)).not.toContain(materia[0]);
    expect(r.evidences).toHaveLength(5);
  });

  it('IDV: a própria /noticia/ (listagem) fica de fora; a matéria entra', async () => {
    const s = live('idv');
    const n = 'https://www.idv.org.br/noticia/reforma-tributaria-deve-manter-preco-cheio-nas-gondolas/';
    // o sitemap do cadastro é o índice; aqui o teste usa o sitemap simples para isolar a regra
    const simples = { ...s, sitemapUrl: 'https://www.idv.org.br/noticia-sitemap1.xml' };
    const { collector } = run(simples, urlset([['https://www.idv.org.br/noticia/', '2026-10-28T16:07:31+00:00'], [n, '2026-10-07T23:56:37+00:00']]), [n, 'https://www.idv.org.br/noticia/']);
    const r = await collector.collectSitemap(simples, 20);
    expect(r.evidences.map((e) => e.url)).toEqual([n]);
  });

  it('só excluídas: o aviso sitemap_no_items conta as excluídas (e o texto antigo não muda quando não há exclusão)', async () => {
    const s = live('accor-newsroom');
    const { collector } = run(s, urlset([['https://group.accor.com/en/news-stories/page/2', '2026-11-24T16:20:32Z'], ['https://group.accor.com/en/news-stories/page/3', '2026-11-24T16:20:32Z']]), []);
    const r = await collector.collectSitemap(s, 20);
    expect(r.evidences).toEqual([]);
    const k = r.skipped.find((x) => x.code === 'sitemap_no_items')!;
    expect(k.detail).toMatch(/0 páginas sob \/en\/news-stories\/: 1 sitemap\(s\), 2 entradas, 0 descartadas, 0 fora do prefixo, 0 anexos, 0 duplicadas, 2 excluídas$/);
    const sem = { ...live('idv'), sitemapUrl: 'https://www.idv.org.br/noticia-sitemap1.xml' };
    const r2 = await run(sem, urlset([['https://www.idv.org.br/outra/x', '2026-10-01']]), []).collector.collectSitemap(sem, 20);
    expect(r2.skipped.find((x) => x.code === 'sitemap_no_items')!.detail).not.toMatch(/excluídas/);
  });
});
