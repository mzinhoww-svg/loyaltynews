import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SEED_SOURCES } from '../sources/seed';
import { SEED_BLOG_SOURCES } from '../sources/seed-blogs';
import { SourceRegistry, eligibility } from '../sources/registry';
import { sourceTier } from '../types';
import type { Source } from '../types';
import { Collector } from '../collector/collector';
import { linksIn, parseSitemap } from '../collector/parse';
import { COLLECT_ON, MOCK_SOURCE, MockFetcher, mockResolver } from '../../fixtures/mock-web.mock';

const NOW = new Date('2026-11-25T12:00:00Z');

test('DP-29: cadastro de blogs — 40+ fontes, todas desabilitadas e secundárias; inacessível não tem feed; ids não colidem', () => {
  assert.ok(SEED_BLOG_SOURCES.length >= 40, `só ${SEED_BLOG_SOURCES.length}`);
  assert.ok(SEED_SOURCES.length >= 40 + 40);
  const reg = new SourceRegistry(SEED_SOURCES); // lança se id duplicado, host inválido ou editoria desconhecida
  for (const s of SEED_BLOG_SOURCES) {
    // Sebrae é associação (emissor oficial de dados de pequenos negócios): fonte primária dentro do lote de pesquisa da DP-29
    if (s.id === 'sebrae-noticias') { assert.equal(sourceTier(s.kind), 'primary'); } else {
      assert.ok(['blog', 'trade_media', 'company_blog'].includes(s.kind), s.id);
      assert.equal(sourceTier(s.kind), 'secondary', s.id);
    }
    assert.equal(s.enabled, false, s.id); assert.equal(s.termsStatus, 'pending', s.id); assert.equal(s.urlVerified, false, s.id);
    assert.equal(eligibility(s).ok, false, s.id);
    assert.equal(s.imageRights, null, s.id);
    assert.ok(s.verification?.researchedBy, `${s.id}: pesquisador registrado (revisor precisa ser outra pessoa)`);
    if (s.verification?.level === 'inacessivel') { assert.equal(s.feedUrl, null, s.id); assert.ok(!s.sitemapUrl, s.id); }
    if (s.feedUrl) assert.equal(new URL(s.feedUrl).host, s.host, `${s.id}: feed no mesmo host (o coletor só aceita o host da fonte)`);
    if (s.sitemapUrl) assert.equal(new URL(s.sitemapUrl).host, s.host, s.id);
  }
  assert.ok(SEED_BLOG_SOURCES.filter((s) => s.feedUrl).length >= 30, 'pelo menos 30 com feed conferido');
  assert.equal(reg.collectable().length, 0);
  assert.equal(sourceTier('investor_relations'), 'primary');
});

test('parseSitemap: urlset, índice, lastmod, ignora entradas sem http(s)', () => {
  const u = parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://x.example/a?x=1&amp;y=2</loc><lastmod>2026-11-20T10:00:00Z</lastmod></url><url><loc>ftp://x.example/b</loc></url><url><loc>https://x.example/c</loc></url></urlset>`);
  assert.equal(u.kind, 'urlset');
  assert.deepEqual(u.entries.map((e) => e.loc), ['https://x.example/a?x=1&y=2', 'https://x.example/c']);
  assert.equal(u.entries[0]!.lastmod, '2026-11-20T10:00:00.000Z');
  assert.equal(u.entries[1]!.lastmod, null);
  const i = parseSitemap('<sitemapindex><sitemap><loc>https://x.example/s1.xml</loc><lastmod>2026-11-01</lastmod></sitemap></sitemapindex>');
  assert.equal(i.kind, 'index'); assert.equal(i.entries.length, 1);
});

test('linksIn: só <a href> http(s), resolvidos, sem repetição; <abbr> e âncoras internas não entram', () => {
  const l = linksIn('<abbr href="https://no.example">x</abbr><a class="c" href="/rel">r</a><a href="https://a.example/p?x=1&amp;y=2">a</a><a href="https://a.example/p?x=1&amp;y=2">a2</a><a href="#topo">t</a><a href="mailto:a@b.c">m</a>', 'https://base.example/post');
  assert.deepEqual(l, ['https://base.example/rel', 'https://a.example/p?x=1&y=2']);
});

const SITEMAP_SRC: Source = { ...MOCK_SOURCE, id: 'mock-sitemap', feedUrl: null, sitemapUrl: 'https://ri.mock.example/sitemap.xml', sitemapPathPrefix: '/noticias/' };
const PAGE = (t: string) => `<html><head><title>${t}</title></head><body><article><p>${t}: o programa anunciou uma parceria nova com varejistas, com regras de acúmulo e validade descritas no comunicado oficial publicado hoje, e detalhes adicionais sobre a vigência.</p><p>Mais um parágrafo com detalhes do comunicado oficial e das condições de participação no programa de fidelidade, para ultrapassar o mínimo.</p><a href="https://gov.example/orgao/comunicado">fonte</a></article></body></html>`;

test('collectSitemap: usa só o prefixo, as mais recentes primeiro, respeita o limite; evidência traz nível e links', async () => {
  const f = new MockFetcher({
    'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
    'https://ri.mock.example/sitemap.xml': `<urlset><url><loc>https://ri.mock.example/noticias/velha</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://ri.mock.example/outros/x</loc><lastmod>2026-11-24</lastmod></url><url><loc>https://ri.mock.example/noticias/nova</loc><lastmod>2026-11-24</lastmod></url><url><loc>https://ri.mock.example/noticias/media</loc><lastmod>2026-06-01</lastmod></url></urlset>`,
    'https://ri.mock.example/noticias/nova': PAGE('Nova'), 'https://ri.mock.example/noticias/media': PAGE('Media'), 'https://ri.mock.example/noticias/velha': PAGE('Velha'),
  });
  const c = new Collector(f, { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON });
  const r = await c.collectSitemap(SITEMAP_SRC, 2);
  assert.deepEqual(r.evidences.map((e) => e.title), ['Nova', 'Media']);
  assert.ok(!f.calls.includes('https://ri.mock.example/outros/x'), 'fora do prefixo não é lido');
  assert.ok(!f.calls.includes('https://ri.mock.example/noticias/velha'), 'acima do limite não é lido');
  assert.equal(r.evidences[0]!.sourceTier, 'primary');
  assert.deepEqual(r.evidences[0]!.outboundLinks, ['https://gov.example/orgao/comunicado']);
  assert.equal(r.evidences[0]!.publishedAt, '2026-11-24T00:00:00.000Z');
});

test('collectSitemap: índice abre só os 2 filhos mais recentes; 429 no sitemap pula sem insistir; sem sitemapUrl é pulado', async () => {
  const f = new MockFetcher({
    'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
    'https://ri.mock.example/sitemap.xml': `<sitemapindex><sitemap><loc>https://ri.mock.example/s-2020.xml</loc><lastmod>2020-01-01</lastmod></sitemap><sitemap><loc>https://ri.mock.example/s-2026a.xml</loc><lastmod>2026-11-01</lastmod></sitemap><sitemap><loc>https://ri.mock.example/s-2026b.xml</loc><lastmod>2026-11-20</lastmod></sitemap></sitemapindex>`,
    'https://ri.mock.example/s-2026b.xml': `<urlset><url><loc>https://ri.mock.example/noticias/b1</loc><lastmod>2026-11-20</lastmod></url></urlset>`,
    'https://ri.mock.example/s-2026a.xml': { status: 429, headers: { 'retry-after': '60' }, body: '' },
    'https://ri.mock.example/noticias/b1': PAGE('B1'),
  });
  const c = new Collector(f, { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON });
  const r = await c.collectSitemap(SITEMAP_SRC);
  assert.ok(!f.calls.includes('https://ri.mock.example/s-2020.xml'));
  assert.deepEqual(r.skipped.map((s) => s.code), ['rate_limited']);
  assert.equal(r.evidences.length, 0, 'parou no 429: não insiste');
  const r2 = await c.collectSitemap({ ...SITEMAP_SRC, sitemapUrl: null });
  assert.deepEqual(r2.skipped.map((s) => s.code), ['empty_content']);
});

test('por sitemap: as 3 empresas conferidas + ANAC, CVM e ANPD (gov.br, .xml.gz) têm sitemap e prefixo; mesmo host da fonte; todas nascem desabilitadas', async () => {
  const { SEED_SOURCES: ALL } = await import('../sources/seed');
  const wired = ALL.filter((s) => s.sitemapUrl && s.sitemapPathPrefix); // coletáveis por sitemap: só com prefixo verificado
  assert.deepEqual(wired.map((s) => s.id).sort(), ['accor-newsroom', 'anac', 'anatel', 'anpd', 'bradesco-ri', 'cvm', 'dinheirama', 'esfera-campanhas', 'guia-bolso-blog', 'idv', 'latampass-novidades', 'latampass-regulamentos', 'livelo-imprensa', 'livelo-programa', 'mtur', 'natura-ri', 'nubank-newsroom', 'one-mile-at-a-time', 'smiles-conteudo']);
  for (const s of wired) {
    assert.equal(new URL(s.sitemapUrl!).host, s.host, s.id);
    assert.match(s.sitemapPathPrefix ?? '', /^(\/[A-Za-z0-9-]+)+(\/|-)?$/, `${s.id}: prefixo da seção de notícias`);
    assert.equal(s.enabled, false, s.id); assert.equal(s.termsStatus, 'pending', s.id);
  }
  // gov.br: índice sem lastmod com filhos .xml.gz (lidos todos, 1 requisição cada): o limite por hora do cadastro precisa comportar índice + filhos + robots + páginas
  const GOV: Record<string, string> = { anac: 'anac', cvm: 'cvm', anpd: 'anpd', anatel: 'anatel', mtur: 'turismo' }; // id da fonte -> pasta do órgão no gov.br
  for (const id of Object.keys(GOV)) {
    const g = ALL.find((s) => s.id === id)!;
    assert.equal(g.host, 'www.gov.br'); assert.equal(g.sitemapUrl, `https://www.gov.br/${GOV[id]}/sitemap-index.xml`);
    assert.ok(g.sitemapPathPrefix!.startsWith(g.pathPrefix + '/'), `${id}: prefixo do sitemap dentro do pathPrefix da fonte`);
    assert.equal(g.feedUrl, null, `${id}: sem feed (o RSS do Plone responde 404)`);
    assert.ok(g.maxRequestsPerHour >= 40, `${id}: limite por hora (janela do HOST www.gov.br) comporta uma rodada conjunta das três`);
  }
  // Orçamento do HOST: a janela de 1 h é por host e as 3 fontes dividem www.gov.br. Pior caso por rodada com 5 páginas por fonte (materiasPorRodada do piloto)
  // e os filhos lidos em 24/11: 1 robots (uma vez por host) + por fonte (1 índice + filhos .gz + 5 páginas). O limite de cada fonte precisa cobrir o total,
  // porque a checagem do último a rodar já vê as requisições dos anteriores.
  // 25/11: ANATEL (4 filhos) e Ministério do Turismo (11 filhos) entraram no host; a rodada conjunta passou de 34 para 61 requisições.
  const filhos: Record<string, number> = { anac: 9, cvm: 4, anpd: 2, anatel: 4, mtur: 11 };
  const PAGINAS = 5;
  const rodada = 1 + Object.values(filhos).reduce((n, k) => n + 1 + k + PAGINAS, 0);
  assert.equal(rodada, 61);
  for (const id of Object.keys(filhos)) assert.ok(ALL.find((s) => s.id === id)!.maxRequestsPerHour >= rodada, `${id}: cobre a rodada conjunta de ${rodada} requisições`);
  const nat = ALL.find((s) => s.id === 'natura-ri')!;
  assert.equal(nat.kind, 'investor_relations'); assert.equal(nat.verification?.researchedBy, 'ln-editorial-engineer');
});

test('sitemap sem prefixo verificado NÃO é coletado (a fábrica não lê página qualquer do sitemap)', async () => {
  const f = new MockFetcher({ 'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:', 'https://ri.mock.example/sitemap.xml': SM_ANY });
  const c = new Collector(f, { now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON, minSpacingMs: 0 });
  const r = await c.collectSitemap({ ...SITEMAP_SRC, sitemapPathPrefix: null });
  assert.deepEqual(r.skipped.map((x) => x.code), ['empty_content']); assert.match(r.skipped[0]!.detail, /sem sitemapPathPrefix/);
  assert.ok(!f.calls.some((u) => u.endsWith('/sitemap.xml')), 'nem o sitemap é lido');
});
const SM_ANY = '<urlset><url><loc>https://ri.mock.example/produto/1</loc></url></urlset>';
