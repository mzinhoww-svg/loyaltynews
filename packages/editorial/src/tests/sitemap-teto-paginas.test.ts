import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { Collector, SITEMAP_MAX_PAGES_PER_RUN } from '../collector/collector';
import type { HttpResponse } from '../collector/collector';
import { collectFromSources } from '../factory/collect';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';

// Teto de 5 páginas por fonte de sitemap em cada rodada (decisão do PM), mesmo com o limite padrão do worker (20): é o que faz o limite por hora do
// HOST (40 em www.gov.br) valer em toda rodada. Tudo offline, com a config REAL de ANAC, CVM e ANPD do seed.
const NOW = new Date('2026-11-24T12:00:00Z');
const chefe: Actor = { userId: 'ensaio-chefe', roles: ['editor_chefe'], mfa: true };
const admin: Actor = { userId: 'ensaio-admin', roles: ['admin'], mfa: true };
const GOV = ['anac', 'cvm', 'anpd'] as const;
const FILHOS: Record<(typeof GOV)[number], number> = { anac: 9, cvm: 4, anpd: 2 }; // filhos .xml.gz lidos em 24/11
const NOTICIAS_POR_FILHO = 30; // bem acima do teto de 5: o teto é que segura, não a falta de matéria
const gz = (xml: string): HttpResponse => ({ status: 200, headers: {}, body: '', bytes: new Uint8Array(gzipSync(Buffer.from(xml))) });
const xmlOk = (xml: string): HttpResponse => ({ status: 200, headers: { 'content-type': 'application/xml' }, body: xml });
const page = (t: string) => `<html><head><title>${t}</title></head><body><article><h1>${t}</h1><p>Texto de ensaio do órgão, só em teste offline, sem relação com notícia real: ${t}.</p></article></body></html>`;

function web() {
  const routes: Record<string, HttpResponse | string> = { 'https://www.gov.br/robots.txt': 'User-agent: *\nDisallow: /economia/pt-br/internet/*\n' };
  const prefixOf = (id: string) => SEED_SOURCES.find((s) => s.id === id)!.sitemapPathPrefix!;
  for (const id of GOV) {
    const n = FILHOS[id];
    routes[`https://www.gov.br/${id}/sitemap-index.xml`] = xmlOk(`<?xml version="1.0"?><sitemapindex>${Array.from({ length: n }, (_, k) => `<sitemap><loc>https://www.gov.br/${id}/sitemap${k + 1}.xml.gz</loc></sitemap>`).join('')}</sitemapindex>`);
    for (let k = 1; k <= n; k++) {
      const urls = Array.from({ length: NOTICIAS_POR_FILHO }, (_, j) => `https://www.gov.br${prefixOf(id)}2026/${id}-c${k}-n${j}`);
      routes[`https://www.gov.br/${id}/sitemap${k}.xml.gz`] = gz(`<?xml version="1.0"?><urlset>${urls.map((u, j) => `<url><loc>${u}</loc><lastmod>2026-11-${String(1 + ((k * 7 + j) % 23)).padStart(2, '0')}T00:00:00+00:00</lastmod></url>`).join('')}</urlset>`);
      for (const u of urls) routes[u] = page(u.split('/').pop()!);
    }
  }
  return new MockFetcher(routes);
}

async function habilitadas(ids: readonly string[]) {
  const store = new InMemoryEditorialStore();
  const registry = new SourceRegistry(SEED_SOURCES.filter((s) => ids.includes(s.id)));
  const ctx = (a: Actor): HandlerCtx => ({ actor: a, store, sources: registry, now: () => NOW, newId: () => 'i' });
  for (const id of ids) {
    expect((await reviewSource(ctx(chefe), { sourceId: id, termsStatus: 'approved', termsNote: 'ENSAIO: revisão simulada em memória; nenhum ato humano real.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status).toBe(200);
    expect((await setSourceEnabled(ctx(admin), { sourceId: id, enabled: true })).status).toBe(200);
  }
  return { store, registry };
}

describe('teto de páginas por fonte de sitemap', () => {
  it('o padrão é 5 (decisão do PM)', () => { expect(SITEMAP_MAX_PAGES_PER_RUN).toBe(5); });

  it('com o limite padrão do worker (20), cada fonte de sitemap pede no máximo 5 páginas e as 3 fontes do gov.br cabem no limite de 40 por hora do host', async () => {
    const fetcher = web();
    const { store, registry } = await habilitadas(GOV);
    const collector = new Collector(fetcher, { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ 'www.gov.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
    const out = await collectFromSources({ store, registry, collector }, {}); // sem limitPerSource: usa o padrão 20 do worker
    expect(out.sources.map((s) => [s.sourceId, s.status, s.evidences]).sort()).toEqual([['anac', 'collected', 5], ['anpd', 'collected', 5], ['cvm', 'collected', 5]]);
    for (const id of GOV) {
      const paginas = fetcher.calls.filter((u) => u.includes(`/${id}-c`));
      expect(paginas, id).toHaveLength(5);
    }
    // 1 robots + ANAC (1 + 9 + 5) + CVM (1 + 4 + 5) + ANPD (1 + 2 + 5) = 34, folga sob o limite de 40
    expect(fetcher.calls).toHaveLength(34);
    expect(fetcher.calls.length).toBeLessThanOrEqual(Math.min(...GOV.map((id) => SEED_SOURCES.find((s) => s.id === id)!.maxRequestsPerHour)));
    expect(out.sources.flatMap((s) => s.skipped).some((k) => k.code === 'rate_limited')).toBe(false);
    // sem o teto (15 páginas por fonte) a mesma rodada estouraria: prova de que o teto é o que segura
    const sem = new Collector(web(), { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ 'www.gov.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON, sitemapMaxPagesPerRun: 1000 });
    const s2 = await habilitadas(GOV);
    const out2 = await collectFromSources({ store: s2.store, registry: s2.registry, collector: sem }, { limitPerSource: 20 });
    expect(out2.sources.flatMap((s) => s.skipped).some((k) => k.code === 'rate_limited')).toBe(true);
  });

  it('o teto só limita: um limit menor continua valendo e a opção do coletor pode baixar ou subir o teto', async () => {
    const mk = (opts: ConstructorParameters<typeof Collector>[1] = {}) => new Collector(web(), { now: () => NOW, sleep: async () => undefined, resolver: new FakeResolver({ 'www.gov.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON, ...opts });
    for (const [limit, teto, esperado] of [[2, undefined, 2], [20, undefined, 5], [20, 3, 3], [20, 8, 8], [4, 8, 4]] as const) {
      const { store, registry } = await habilitadas(['cvm']); // estado novo por caso (o orçamento por hora é do coletor)
      const out = await collectFromSources({ store, registry, collector: mk(teto ? { sitemapMaxPagesPerRun: teto } : {}) }, { limitPerSource: limit, onlySourceIds: ['cvm'] });
      expect(out.sources[0]?.evidences, `limit ${limit}, teto ${teto ?? 'padrão'}`).toBe(esperado);
    }
  });
});
