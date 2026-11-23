import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ChainedReader, Collector, stopsCollection } from '../collector/collector';
import type { ReaderPort, ReaderResult } from '../collector/collector';
import { TavilyReader } from '../collector/tavily-reader';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import { SEED_SOURCES } from '../sources/seed';
import { SourceRegistry } from '../sources/registry';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { sourceFingerprint } from '../sources/state';
import type { Source } from '../types';

const HOST = 'blog.mock.example';
const DP31: Source = {
  ...MOCK_SOURCE, id: 'blog-dp31', name: 'MOCK Blog Bloqueado', kind: 'blog', host: HOST, listingUrl: `https://${HOST}/`, feedUrl: null,
  acesso: 'via-provedor', maxRequestsPerHour: 60,
};
const u = (n: number | string) => `https://${HOST}/post-${n}`;
const LONG = (n: number | string) => `Matéria ${n}. ` + 'O programa fictício anunciou novas regras de acúmulo para os participantes, com vigência e condições descritas no comunicado oficial publicado hoje. '.repeat(30);
const resolver = () => new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]], 'ri.mock.example': [[MOCK_PUBLIC_IP]] });

class Clock { t = Date.parse('2026-11-25T12:00:00Z'); now = () => new Date(this.t); sleep = async (ms: number) => { this.t += ms; }; }
class FakeReader implements ReaderPort {
  readonly name = 'fake';
  calls: Array<{ url: string; at: number }> = [];
  constructor(private readonly clock: Clock, private readonly pages: Record<string, ReaderResult> = {}, private readonly found: string[] = []) {}
  async read(url: string): Promise<ReaderResult> { this.calls.push({ url, at: this.clock.t }); return this.pages[url] ?? { status: 404, body: '' }; }
  async discover(): Promise<Array<{ url: string; title?: string; publishedAt?: string | null }>> { return this.found.map((url) => ({ url, publishedAt: '2026-11-24T10:00:00.000Z' })); }
}
function mk(pages: Record<string, ReaderResult>, found: string[] = [], over: ConstructorParameters<typeof Collector>[1] = {}, withReader = true) {
  const clock = new Clock();
  const direct = new MockFetcher({ [`https://${HOST}/robots.txt`]: 'User-agent: *\nDisallow: /' }); // robots proíbe tudo: a DP-31 ignora; o coletor direto NUNCA é usado
  const reader = new FakeReader(clock, pages, found);
  const c = new Collector(direct, { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, minSpacingMs: 0, ...(withReader ? { reader } : {}), ...over });
  return { clock, direct, reader, c };
}

test('DP-31: sem serviço de leitura configurado a fonte é pulada (reader_unavailable) e NADA é buscado diretamente', async () => {
  const { direct, c } = mk({}, [], {}, false);
  const r = await c.collectUrl(DP31, u(1));
  assert.equal(r.skip?.code, 'reader_unavailable');
  assert.equal(direct.calls.length, 0, 'nem robots.txt nem a página foram buscados pelo coletor direto');
  assert.deepEqual((await c.collectFeed(DP31)).skipped.map((s) => s.code), ['reader_unavailable']);
});

test('DP-31: lê pelo serviço IGNORANDO o robots.txt (Disallow: /), marca a evidência, guarda só um trecho curto e o hash do corpo inteiro', async () => {
  const body = LONG(1);
  const { direct, reader, c } = mk({ [u(1)]: { status: 200, body, format: 'text' } });
  const r = await c.collectUrl(DP31, u(1));
  assert.ok(r.evidence, JSON.stringify(r.skip));
  assert.equal(r.evidence.acesso, 'via-provedor');
  assert.ok(r.evidence.text.length <= 1500, `trecho de ${r.evidence.text.length} caracteres`);
  assert.ok(body.length > 3000 && r.evidence.text.length < body.length / 2, 'texto integral NÃO é guardado');
  assert.equal(r.evidence.url, u(1)); assert.match(r.evidence.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(direct.calls.length, 0, 'o coletor direto não foi usado (sem robots.txt, sem UA do coletor)');
  assert.equal(reader.calls.length, 1);
});

test('DP-31: ritmo — ≥ 10 s entre leituras do mesmo host e no máximo 5 páginas por dia (a 6ª é rate_limited, sem leitura)', async () => {
  const pages = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [u(n), { status: 200, body: LONG(n), format: 'text' as const }]));
  const { reader, c, clock } = mk(pages);
  for (const n of [1, 2, 3, 4, 5]) assert.ok((await c.collectUrl(DP31, u(n))).evidence, `página ${n}`);
  const at = reader.calls.map((x) => x.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i]! - at[i - 1]! >= 10_000, `intervalo ${i}: ${at[i]! - at[i - 1]!} ms`);
  const sixth = await c.collectUrl(DP31, u(6));
  assert.equal(sixth.skip?.code, 'rate_limited'); assert.match(sixth.skip!.detail, /5 páginas por dia/);
  assert.equal(reader.calls.length, 5);
  clock.t += 25 * 3600_000; // 24 h depois a janela libera
  assert.ok((await c.collectUrl(DP31, u(6))).evidence);
});

test('DP-31: 429 do serviço para a coleta (rate_limited); 403/falha do serviço também para e NÃO tenta outro caminho', async () => {
  const feed = [1, 2, 3];
  const a = mk({ [u(1)]: { status: 429, body: '', retryAfterSec: 60 }, [u(2)]: { status: 200, body: LONG(2), format: 'text' } }, feed.map(u));
  const ra = await a.c.collectFeed(DP31);
  assert.deepEqual(ra.skipped.map((s) => s.code), ['rate_limited']);
  assert.match(ra.skipped[0]!.detail, /Retry-After: 60/);
  assert.equal(a.reader.calls.length, 1, 'não insiste depois do 429');
  const b = mk({ [u(1)]: { status: 403, body: '' }, [u(2)]: { status: 200, body: LONG(2), format: 'text' } }, feed.map(u));
  const rb = await b.c.collectFeed(DP31);
  assert.deepEqual(rb.skipped.map((s) => `${s.code}:${s.detail}`), ['http_error:403']);
  assert.equal(b.reader.calls.length, 1);
  assert.equal(b.direct.calls.length, 0, 'sem fallback para o coletor direto');
});

const CAPTCHA = `<html><head><title>Just a moment...</title></head><body><div id="challenge-form"><p>Verifying you are human.</p></div>${'<p>x</p>'.repeat(60)}<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>`;
const LOGIN = `<html><body><article><h1>Conteúdo exclusivo</h1><p>Assine para ler o restante deste conteúdo. Faça login para continuar lendo a matéria completa.</p></article></body></html>`;

test('DP-32: via provedor, o desafio/CAPTCHA NÃO para a coleta (é falha do provedor naquela URL) mas NUNCA vira evidência; login/paywall continuam parando', async () => {
  const a = mk({ [u(1)]: { status: 200, body: CAPTCHA, format: 'html' }, [u(2)]: { status: 200, body: LOGIN, format: 'html' }, [u(3)]: { status: 200, body: LONG(3), format: 'text' } }, [1, 2, 3].map(u));
  const r1 = await a.c.collectUrl(DP31, u(1));
  assert.equal(r1.evidence, undefined); assert.equal(r1.skip?.code, 'challenge'); assert.equal(r1.skip?.viaProvider, true);
  const r2 = await a.c.collectUrl(DP31, u(2));
  assert.equal(r2.evidence, undefined); assert.equal(r2.skip?.code, 'gated');
  // laço: o desafio da 1ª página NÃO interrompe; a 2ª é lida e vira evidência
  const b = mk({ [u(1)]: { status: 200, body: CAPTCHA, format: 'html' }, [u(2)]: { status: 200, body: LONG(2), format: 'text' } }, [1, 2].map(u));
  const rb = await b.c.collectFeed(DP31);
  assert.deepEqual(rb.skipped.map((x) => x.code), ['challenge']);
  assert.equal(rb.evidences.length, 1); assert.equal(b.reader.calls.length, 2);
  // mas 3 desafios seguidos (provedor sem conseguir nada nesta fonte) param a coleta
  const c3 = mk({ [u(1)]: { status: 200, body: CAPTCHA, format: 'html' }, [u(2)]: { status: 200, body: CAPTCHA, format: 'html' }, [u(3)]: { status: 200, body: CAPTCHA, format: 'html' }, [u(4)]: { status: 200, body: LONG(4), format: 'text' } }, [1, 2, 3, 4].map(u));
  const r3 = await c3.c.collectFeed(DP31);
  assert.deepEqual(r3.skipped.map((x) => x.code), ['challenge', 'challenge', 'challenge']); assert.equal(r3.evidences.length, 0); assert.equal(c3.reader.calls.length, 3);
  // login/paywall: 2 seguidos param (o provedor não entra em área com login nem fura paywall)
  const d = mk({ [u(1)]: { status: 200, body: LOGIN, format: 'html' }, [u(2)]: { status: 200, body: LOGIN, format: 'html' }, [u(3)]: { status: 200, body: LONG(3), format: 'text' } }, [1, 2, 3].map(u));
  const rd = await d.c.collectFeed(DP31);
  assert.deepEqual(rd.skipped.map((x) => x.code), ['gated', 'gated']); assert.equal(d.reader.calls.length, 2);
});

test('DP-32: o coletor DIRETO (nosso UA) continua parando no desafio com HTTP 200; só o caminho via provedor muda', async () => {
  const clock = new Clock();
  const direct = new MockFetcher({ 'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:', 'https://ri.mock.example/noticias/1': CAPTCHA, 'https://ri.mock.example/noticias/2': '<html><body>x</body></html>' });
  const c = new Collector(direct, { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, minSpacingMs: 0 });
  const r = await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/1');
  assert.equal(r.skip?.code, 'challenge'); assert.equal(r.skip?.viaProvider, undefined);
  assert.ok(stopsCollection(r.skip!), 'no coletor direto o desafio PARA a coleta da fonte');
  assert.equal(stopsCollection({ ...r.skip!, viaProvider: true }), false, 'via provedor não para sozinho');
});

test('DP-32: ChainedReader — troca de provedor por cota esgotada ou falha por URL; 429 de ritmo NÃO troca; sem provedor sobrando devolve o último resultado', async () => {
  const mkR = (name: string, fn: (url: string) => ReaderResult): ReaderPort & { n: number } => { const r = { name, n: 0, read: async (url: string) => { r.n++; return fn(url); } }; return r; };
  const quota = mkR('p1', () => ({ status: 432, body: '', quotaExhausted: true }));
  const p2 = mkR('p2', (url) => (url.endsWith('/dura') ? { status: 502, body: '', failedUrl: true } : { status: 200, body: 'ok-p2', format: 'text' }));
  const p3 = mkR('p3', () => ({ status: 200, body: 'ok-p3', format: 'text' }));
  const chain = new ChainedReader([quota, p2, p3]);
  assert.equal(chain.name, 'p1>p2>p3');
  assert.equal((await chain.read('https://x.example/a')).body, 'ok-p2');
  assert.equal((await chain.read('https://x.example/b')).body, 'ok-p2');
  assert.equal(quota.n, 1, 'provedor sem cota não é tentado de novo');
  assert.equal((await chain.read('https://x.example/dura')).body, 'ok-p3', 'falha por URL no p2 passa para o p3');
  const rate = mkR('r1', () => ({ status: 429, body: '', retryAfterSec: 30 }));
  const other = mkR('r2', () => ({ status: 200, body: 'nao', format: 'text' }));
  assert.deepEqual(await new ChainedReader([rate, other]).read('https://x.example/a'), { status: 429, body: '', retryAfterSec: 30 });
  assert.equal(other.n, 0, '429 por ritmo não troca de provedor');
  const dead = new ChainedReader([mkR('a', () => ({ status: 432, body: '', quotaExhausted: true })), mkR('b', () => ({ status: 502, body: '', failedUrl: true }))]);
  assert.equal((await dead.read('https://x.example/a')).failedUrl, true);
  assert.throws(() => new ChainedReader([]), /nenhum provedor/);
  assert.equal(new ChainedReader([{ name: 'u', unlocks: true, read: async () => ({ status: 200, body: '' }) }]).unlocks, true);
});

test('DP-31/32 só vale para a fonte marcada: fonte comum com o MESMO serviço configurado continua com robots, UA e guardas (o serviço não é chamado)', async () => {
  const clock = new Clock();
  const direct = new MockFetcher({ 'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow: /noticias/', 'https://ri.mock.example/noticias/a': '<html><body>x</body></html>' });
  const reader = new FakeReader(clock, { 'https://ri.mock.example/noticias/a': { status: 200, body: LONG('a'), format: 'text' } });
  const c = new Collector(direct, { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, minSpacingMs: 0, reader });
  const r = await c.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/a');
  assert.equal(r.skip?.code, 'robots_disallow');
  assert.equal(reader.calls.length, 0, 'o serviço de leitura não é usado para fonte comum');
});

test('DP-31 no cadastro: só as 11 fontes bloqueadas e o Santander RI têm o acesso; todas desabilitadas; o resto segue padrão', () => {
  const marked = SEED_SOURCES.filter((s) => s.acesso === 'via-provedor');
  assert.equal(marked.length, 12, marked.map((s) => s.id).join(','));
  assert.ok(marked.some((s) => s.id === 'santander-ri'));
  for (const s of marked) { assert.equal(s.enabled, false, s.id); assert.equal(s.verification?.level, 'inacessivel', s.id); assert.match(s.notes ?? s.verification?.notes ?? '', /DP-31/, s.id); }
  assert.ok(SEED_SOURCES.filter((s) => s.verification?.level === 'inacessivel' && s.acesso !== 'via-provedor').every((s) => ['itau-ri', 'star-alliance', 'ico-uk'].includes(s.id)), 'outras inacessíveis seguem sem DP-31');
  new SourceRegistry(SEED_SOURCES);
});

const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
const admin: Actor = { userId: 'joao-admin', roles: ['admin'], mfa: true };
const NOW = new Date('2026-11-25T12:00:00Z');
const BLOCKED: Source = { ...DP31, enabled: false, termsStatus: 'pending', urlVerified: false, verification: { level: 'inacessivel', researchedBy: 'ln-editorial-engineer', robots: 'indisponivel', robotsNote: 'x', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'x', notes: 'x' } };
const REV = { sourceId: 'blog-dp31', termsStatus: 'approved', urlVerified: true, robotsChecked: true, paywall: 'none' } as const;

test('revisão: fonte inacessível só é aprovável com acesso DP-31 E nota que cite a DP-31; sem o campo continua 409; habilitar exige a revisão atual (acesso entra na impressão digital)', async () => {
  const store = new InMemoryEditorialStore();
  const reg = new SourceRegistry([BLOCKED, { ...BLOCKED, id: 'blog-comum', acesso: 'padrao' }]);
  const ctx = (a: Actor): HandlerCtx => ({ actor: a, store, sources: reg, now: () => NOW, newId: () => 'id' });
  assert.equal((await reviewSource(ctx(chefe), { ...REV, sourceId: 'blog-comum', termsNote: 'Leitura manual dos termos e do robots.txt feita pelo revisor.' })).status, 409, 'inacessível sem DP-31 segue não aprovável');
  assert.equal((await reviewSource(ctx(chefe), { ...REV, termsNote: 'Leitura manual dos termos e do robots.txt feita pelo revisor.' })).status, 409, 'nota sem DP-31');
  const ok = await reviewSource(ctx(chefe), { ...REV, termsNote: 'DP-31: risco aceito pelo proprietário; página pública, sem login; robots proíbe e o proprietário aceitou.' });
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { acesso: string }).acesso, 'via-provedor');
  assert.equal((await setSourceEnabled(ctx(admin), { sourceId: 'blog-dp31', enabled: true })).status, 200);
  assert.notEqual(sourceFingerprint(BLOCKED), sourceFingerprint({ ...BLOCKED, acesso: 'padrao' }), 'mudar o acesso invalida a revisão');
});

test('TavilyReader: extract/search no formato da documentação, chave só no cabeçalho, 429 com Retry-After, falha por URL, descoberta limitada ao domínio', async () => {
  const seen: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  const mkFetch = (handler: (url: string, body: Record<string, unknown>) => { status: number; json: unknown; headers?: Record<string, string> }): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const h = new Headers(init?.headers);
      seen.push({ url: String(url), auth: h.get('authorization'), body });
      const r = handler(String(url), body);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
    }) as typeof fetch;
  assert.throws(() => new TavilyReader({ apiKey: '' }), /nenhuma chave/);

  const ok = new TavilyReader({ apiKey: 'tvly-TESTE', fetchImpl: mkFetch(() => ({ status: 200, json: { results: [{ url: u(1), raw_content: 'Texto da matéria.' }], failed_results: [] } })) });
  assert.deepEqual(await ok.read(u(1)), { status: 200, body: 'Texto da matéria.', format: 'text' });
  assert.equal(seen[0]!.url, 'https://api.tavily.com/extract');
  assert.equal(seen[0]!.auth, 'Bearer tvly-TESTE');
  assert.deepEqual(seen[0]!.body, { urls: [u(1)], extract_depth: 'basic', format: 'text', include_images: false });
  assert.ok(!JSON.stringify(seen[0]!.body).includes('tvly-'), 'a chave não vai no corpo');

  const rl = new TavilyReader({ apiKey: 'k', fetchImpl: mkFetch(() => ({ status: 429, json: { detail: { error: 'x' } }, headers: { 'retry-after': '60' } })) });
  assert.deepEqual(await rl.read(u(1)), { status: 429, body: '', retryAfterSec: 60 });
  const failed = new TavilyReader({ apiKey: 'k', fetchImpl: mkFetch(() => ({ status: 200, json: { results: [], failed_results: [{ url: u(1), error: 'blocked' }] } })) });
  assert.equal((await failed.read(u(1))).status, 502, 'falha por URL: não insiste');

  const disc = new TavilyReader({ apiKey: 'k', fetchImpl: mkFetch(() => ({ status: 200, json: { results: [
    { url: u(1), title: 'A', published_date: '2026-11-24' }, { url: 'https://outro.example/x', title: 'fora do domínio' }, { url: u(2), title: 'B' },
  ] } })) });
  const found = await disc.discover(DP31, 5);
  assert.deepEqual(found.map((f) => f.url), [u(1), u(2)]);
  assert.equal(found[0]!.publishedAt, '2026-11-24T00:00:00.000Z');
  const last = seen.at(-1)!;
  assert.equal(last.url, 'https://api.tavily.com/search');
  assert.deepEqual(last.body['include_domains'], [HOST]);
  await assert.rejects(() => new TavilyReader({ apiKey: 'k', fetchImpl: mkFetch(() => ({ status: 429, json: {} })) }).discover(DP31, 3), /429/);

  // ponta a ponta: Tavily simulado + coletor → evidência marcada, trecho curto, ritmo de 10 s
  const clock = new Clock();
  const reader = new TavilyReader({ apiKey: 'k', fetchImpl: mkFetch((url, body) => url.endsWith('/search')
    ? { status: 200, json: { results: [{ url: u(1), title: 'A' }, { url: u(2), title: 'B' }] } }
    : { status: 200, json: { results: [{ url: (body['urls'] as string[])[0], raw_content: LONG('x') }] } }) });
  const c = new Collector(new MockFetcher({}), { now: clock.now, sleep: clock.sleep, resolver: resolver(), flags: COLLECT_ON, reader });
  const res = await c.collectFeed(DP31);
  assert.equal(res.evidences.length, 2);
  assert.ok(res.evidences.every((e) => e.acesso === 'via-provedor' && e.text.length <= 1500));
});
