import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collector, validateEvidence } from '../src/collector/collector.ts';
import { assertAllowedUrl, isPrivateHost, UrlRejected } from '../src/collector/ssrf.ts';
import { isAllowedByRobots, parseRobots } from '../src/collector/robots.ts';
import { SourceRegistry, eligibility } from '../src/sources/registry.ts';
import { SEED_SOURCES } from '../src/sources/seed.ts';
import { EDITORIAS } from '../src/types.ts';
import { MOCK_SOURCE, MockFetcher, mockWeb } from '../fixtures/mock-web.mock.ts';

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
  const r = await new Collector(f, { now: fixedNow }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/redir');
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
  const c = new Collector(mockWeb(), { now: fixedNow });
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
  const c = new Collector(mockWeb(), { now: fixedNow });
  assert.equal((await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/privado/relatorio')).skip?.code, 'robots_disallow');
  assert.equal((await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/assinantes')).skip?.code, 'gated');
  const off = { ...MOCK_SOURCE, termsStatus: 'pending' as const };
  assert.equal((await c.collectUrl(off, 'https://ri.mock.example/noticias/alfa-parceria')).skip?.code, 'source_not_eligible');
});

test('coleta: robots.txt indisponível (403) => fail closed', async () => {
  const f = new MockFetcher({ 'https://ri.mock.example/robots.txt': { status: 403, headers: {}, body: '' } });
  const r = await new Collector(f).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/x');
  assert.equal(r.skip?.code, 'robots_unavailable');
});

test('injeção: instrução embutida marca evidência como suspeita e nenhuma ferramenta é chamada', async () => {
  const c = new Collector(mockWeb(), { now: fixedNow });
  const r = await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/injecao');
  assert.equal(r.evidence?.suspicious, true);
  assert.ok(r.evidence!.suspiciousReasons.includes('ignore_instructions'));
});

test('feed: coleta itens, descarta restritos/paywall e mantém duplicatas para o dedupe', async () => {
  const res = await new Collector(mockWeb(), { now: fixedNow }).collectFeed(MOCK_SOURCE);
  assert.equal(res.evidences.length, 3); // alfa(utm), alfa, injecao
  const codes = res.skipped.map((s) => s.code).sort();
  assert.deepEqual(codes, ['gated', 'robots_disallow']);
});

test('evidência sem URL, data ou hash é rejeitada', () => {
  assert.deepEqual(validateEvidence({ sourceId: 's' }).sort(), ['missing_date', 'missing_hash', 'missing_url']);
});

test('registro: seed honesto — nenhuma fonte coletável, todas as editorias sem cobertura até revisão de termos', () => {
  const reg = new SourceRegistry(SEED_SOURCES);
  assert.equal(reg.collectable().length, 0);
  assert.deepEqual(reg.uncovered(), [...EDITORIAS]);
  for (const s of reg.all()) {
    const el = eligibility(s);
    assert.equal(el.ok, false);
    assert.equal(s.feedUrl, null, 'feed não pode ser inventado');
  }
  assert.ok(reg.byEditoria('regulacao-dados').length >= 1);
  assert.throws(() => reg.add(SEED_SOURCES[0]!), /duplicate/);
});
