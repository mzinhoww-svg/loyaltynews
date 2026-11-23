import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector, validateEvidence } from '../collector/collector';
import { assertAllowedUrl, isPrivateHost, UrlRejected } from '../collector/ssrf';
import { isAllowedByRobots, parseRobots } from '../collector/robots';
import { SourceRegistry, eligibility } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { MOCK_SOURCE, MockFetcher, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';

const fixedNow = () => new Date('2026-11-23T12:00:00Z');

test('SSRF: IP privado, localhost, esquemas e credenciais são recusados', () => {
  for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', 'localhost', '::1', '[::ffff:127.0.0.1]', '2130706433', '0x7f.1', 'svc.internal']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  assert.equal(isPrivateHost('ri.mock.example'), false);
  for (const u of ['http://127.0.0.1/x', 'http://localhost/x', 'file:///etc/passwd', 'ftp://ri.mock.example/x', 'https://u:p@ri.mock.example/x', 'https://outro.example/x']) {
    assert.throws(() => assertAllowedUrl(u, ['ri.mock.example']), UrlRejected, u);
  }
  assert.doesNotThrow(() => assertAllowedUrl('https://ri.mock.example/a', ['ri.mock.example']));
});

test('SSRF: redirecionamento para host interno é recusado e a rede interna não é consultada', async () => {
  const f = new MockFetcher({
    'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
    'https://ri.mock.example/noticias/redir': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' }, body: '' },
  });
  const r = await new Collector(f, { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/redir');
  assert.equal(r.skip?.code, 'url_rejected');
  assert.ok(!f.calls.some((c) => c.includes('169.254')));
});

test('robots.txt: Disallow respeitado, Allow mais específico vence', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /privado/\nAllow: /privado/liberado\nCrawl-delay: 5', 'LoyaltyNewsBot/0.1');
  assert.equal(rules.crawlDelaySec, 5);
  assert.equal(isAllowedByRobots(rules, '/privado/x'), false);
  assert.equal(isAllowedByRobots(rules, '/privado/liberado'), true);
  assert.equal(isAllowedByRobots(rules, '/noticias/a'), true);
});

test('coleta: evidência com URL, data, hash; HTML ativo removido', async () => {
  const c = new Collector(mockWeb(), { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON });
  const r = await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria');
  assert.ok(r.evidence);
  const e = r.evidence;
  assert.deepEqual(validateEvidence(e), []);
  assert.equal(e.fetchedAt, '2026-11-23T12:00:00.000Z');
  assert.match(e.contentSha256, /^[0-9a-f]{64}$/);
  assert.ok(!e.text.includes('alert(1)') && !e.text.includes('<'));
  assert.equal(e.suspicious, false);
  assert.equal(e.publishedAt, '2026-11-23T13:00:00.000Z');
});

test('coleta: robots disallow, paywall e fonte inelegível não são ingeridos', async () => {
  const c = new Collector(mockWeb(), { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON });
  assert.equal((await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/privado/relatorio')).skip?.code, 'robots_disallow');
  assert.equal((await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/assinantes')).skip?.code, 'gated');
  const off = { ...MOCK_SOURCE, termsStatus: 'pending' as const };
  assert.equal((await c.collectUrl(off, 'https://ri.mock.example/noticias/alfa-parceria')).skip?.code, 'source_not_eligible');
});

test('coleta: robots.txt indisponível (403) => fail closed', async () => {
  const f = new MockFetcher({ 'https://ri.mock.example/robots.txt': { status: 403, headers: {}, body: '' } });
  const r = await new Collector(f, { resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/x');
  assert.equal(r.skip?.code, 'robots_unavailable');
});

test('injeção: instrução embutida marca evidência como suspeita e nenhuma ferramenta é chamada', async () => {
  const c = new Collector(mockWeb(), { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON });
  const r = await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/injecao');
  assert.equal(r.evidence?.suspicious, true);
  assert.ok(r.evidence!.suspiciousReasons.includes('ignore_instructions'));
});

test('feed: coleta itens, descarta restritos/paywall e mantém duplicatas para o dedupe', async () => {
  const res = await new Collector(mockWeb(), { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON }).collectFeed(MOCK_SOURCE);
  assert.equal(res.evidences.length, 3); // alfa(utm), alfa, injecao
  const codes = res.skipped.map((s) => s.code).sort();
  assert.deepEqual(codes, ['gated', 'robots_disallow']);
});

test('evidência sem URL, data ou hash é rejeitada', () => {
  assert.deepEqual(validateEvidence({ sourceId: 's' }).sort(), ['missing_date', 'missing_hash', 'missing_url']);
});

// ---------- prefixo de caminho (hosts compartilhados, ex.: www.gov.br/<órgão>) ----------
import { normalizePrefix, pathInPrefix } from '../collector/ssrf';

const GOV: typeof MOCK_SOURCE = { ...MOCK_SOURCE, id: 'mock-gov', host: 'www.gov.mock', pathPrefix: '/orgao', feedUrl: null };
const govWeb = () => new MockFetcher({
  'https://www.gov.mock/robots.txt': 'User-agent: *\nDisallow: /orgao/interno/',
  'https://www.gov.mock/orgao/noticias/a': '<html><body><article><h1>MOCK Nota</h1><p>Texto fictício do órgão de teste.</p></article></body></html>',
  'https://www.gov.mock/outro-orgao/noticias/b': '<html><body><article><h1>MOCK B</h1><p>Outro órgão.</p></article></body></html>',
  'https://www.gov.mock/orgao/redir': { status: 302, headers: { location: '/outro-orgao/noticias/b' }, body: '' },
});

test('prefixo: normalização e fronteira de segmento', () => {
  assert.equal(normalizePrefix('anpd/'), '/anpd');
  assert.equal(normalizePrefix('/'), null);
  assert.equal(normalizePrefix(null), null);
  assert.equal(pathInPrefix('/anpd', '/anpd'), true);
  assert.equal(pathInPrefix('/anpd/x', '/anpd'), true);
  assert.equal(pathInPrefix('/anpdx/x', '/anpd'), false);
  assert.equal(pathInPrefix('/outro', '/anpd'), false);
});

test('prefixo: URL fora do prefixo, com .. ou %2e%2e é recusada; dentro é aceita', () => {
  const ok = (u: string) => assertAllowedUrl(u, ['www.gov.mock'], '/orgao');
  assert.doesNotThrow(() => ok('https://www.gov.mock/orgao/noticias/a'));
  for (const u of ['https://www.gov.mock/outro-orgao/x', 'https://www.gov.mock/orgaox/x', 'https://www.gov.mock/orgao/../outro-orgao/x', 'https://www.gov.mock/orgao/%2e%2e/outro-orgao/x', 'https://www.gov.mock/']) {
    assert.throws(() => ok(u), (e: unknown) => e instanceof UrlRejected && e.code === 'path_outside_prefix', u);
  }
});

test('prefixo: coletor coleta dentro, recusa fora, aplica robots e não segue redirect para outro órgão', async () => {
  const f = govWeb();
  const c = new Collector(f, { now: fixedNow, resolver: mockResolver(), flags: COLLECT_ON });
  const inside = await c.collectUrl(GOV, 'https://www.gov.mock/orgao/noticias/a');
  assert.ok(inside.evidence);
  assert.equal((await c.collectUrl(GOV, 'https://www.gov.mock/outro-orgao/noticias/b')).skip?.code, 'url_rejected');
  assert.equal((await c.collectUrl(GOV, 'https://www.gov.mock/orgao/interno/x')).skip?.code, 'robots_disallow');
  const redir = await c.collectUrl(GOV, 'https://www.gov.mock/orgao/redir');
  assert.equal(redir.skip?.code, 'url_rejected');
  assert.ok(!f.calls.includes('https://www.gov.mock/outro-orgao/noticias/b'), 'rede nunca consultou o outro órgão');
  // robots.txt (na raiz do host) é consultado apesar do prefixo
  assert.ok(f.calls.includes('https://www.gov.mock/robots.txt'));
});

test('registro: host compartilhado sem pathPrefix é inelegível; com prefixo válido passa a depender só dos demais critérios', () => {
  const shared = { ...MOCK_SOURCE, id: 'sh', host: 'www.gov.br', pathPrefix: null };
  assert.deepEqual((eligibility(shared) as { reasons: string[] }).reasons, ['shared_host_needs_path_prefix']);
  assert.equal(eligibility({ ...shared, pathPrefix: '/anpd' }).ok, true);
  assert.throws(() => new SourceRegistry([{ ...shared, pathPrefix: 'anpd com espaço' }]), /invalid pathPrefix/);
  const seed = new SourceRegistry(SEED_SOURCES);
  assert.equal(seed.get('anpd')?.pathPrefix, '/anpd');
  assert.equal(seed.get('cvm')?.pathPrefix, '/cvm');
});

test('flag editorialCollector desligada (padrão do contrato): coletor recusa executar e não toca a rede', async () => {
  const f = mockWeb();
  const c = new Collector(f, { resolver: mockResolver() });
  await assert.rejects(c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria'), /flag desligada: editorialCollector/);
  await assert.rejects(c.collectFeed(MOCK_SOURCE), /flag desligada/);
  assert.equal(f.calls.length, 0);
});

test('feed RSS sem <link>: o permalink vem no <guid> (formato real da Agência Senado); guid não-URL ou isPermaLink=false é descartado', async () => {
  const { parseFeed } = await import('../collector/parse');
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>MOCK</title>
<item><title>MOCK A</title><description></description><pubDate>Thu, 19 Nov 2026 20:34:19 -0300</pubDate><guid>https://www12.senado.leg.br/noticias/materias/2026/11/19/mock-a</guid></item>
<item><title>MOCK B</title><guid isPermaLink="false">id-interno-123</guid></item>
<item><title>MOCK C</title><guid isPermaLink="false">https://exemplo.invalid/c</guid></item>
<item><title>MOCK D</title><link>https://exemplo.invalid/d</link><guid>https://exemplo.invalid/outro</guid></item>
<item><title>MOCK E</title><guid><![CDATA[https://exemplo.invalid/e]]></guid></item></channel></rss>`;
  const items = parseFeed(xml);
  assert.deepEqual(items.map((i) => [i.title, i.link]), [
    ['MOCK A', 'https://www12.senado.leg.br/noticias/materias/2026/11/19/mock-a'], ['MOCK D', 'https://exemplo.invalid/d'], ['MOCK E', 'https://exemplo.invalid/e'],
  ]);
  assert.equal(items[0]!.publishedAt, '2026-11-19T23:34:19.000Z');
});
