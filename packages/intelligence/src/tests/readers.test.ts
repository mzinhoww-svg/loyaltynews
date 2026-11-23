import { describe, it, expect, vi } from 'vitest';
import {
  ApifyRagBrowserReader, BrightDataUnlockerReader, ScrapflyReader, ZyteReader, asEditorialReader, createReader, orderByCost, stripHtml,
  toEditorialResult, type KeyConfig, type KeyedReader, type ReadResult,
} from '../index';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const fakeFetch = (h: Handler) => vi.fn(async (u: string | URL | Request, init?: RequestInit) => h(String(u), init ?? {})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const text = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

const PAGE = `<html><head><title>Comunicados</title></head><body><p>${'Texto público de uma página de relações com investidores. '.repeat(40)}</p></body></html>`;
const KEYS: KeyConfig[] = [
  { label: 'conta-1', secretRef: 'K1', monthlyCreditCap: 1000 },
  { label: 'conta-2', secretRef: 'K2', monthlyCreditCap: 1000 },
];
const SECRETS: Record<string, string> = { K1: 'segredo-conta-1-NAO-VAZAR', K2: 'segredo-conta-2-NAO-VAZAR' };
const make = (keyed: KeyedReader) => createReader({ keyed, keys: KEYS, resolveSecret: (r) => SECRETS[r] }, { enabled: true, pace: false });
const ask = (keyed: KeyedReader, url = 'https://alvo.invalid/ri') => make(keyed).read({ url });

describe('Bright Data — Web Unlocker API', () => {
  it('requisição: POST /request com Bearer, zona, url e format raw; HTML e status da página vêm da resposta', async () => {
    const f = fakeFetch(() => text(200, PAGE, { 'x-brd-status-code': '200' }));
    const r = await ask(new BrightDataUnlockerReader('zona_ln', f));
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://api.brightdata.com/request');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRETS.K1}`);
    expect(JSON.parse(String(init.body))).toEqual({ zone: 'zona_ln', url: 'https://alvo.invalid/ri', format: 'raw' });
    expect(url).not.toContain(SECRETS.K1!); // a chave nunca vai na URL
    expect(r).toMatchObject({ ok: true, keyLabel: 'conta-1', creditsUsed: 1, httpStatus: 200 });
    expect(r.html).toBe(PAGE);
    expect(r.text).toContain('Texto público');
  });

  it('chave inválida (401) sai de uso e a conta 2 atende; cota esgotada (402 ou 403 com "funds") também troca de conta', async () => {
    const seen: string[] = [];
    const f = fakeFetch((_u, init) => {
      const k = (init.headers as Record<string, string>).authorization;
      seen.push(k!);
      return k!.includes('conta-1') ? text(401, 'Invalid token') : text(200, PAGE);
    });
    const r = await ask(new BrightDataUnlockerReader('z', f));
    expect(r).toMatchObject({ ok: true, keyLabel: 'conta-2' });
    expect(seen).toHaveLength(2);

    const quota = fakeFetch((_u, init) => ((init.headers as Record<string, string>).authorization!.includes('conta-1') ? text(403, 'Insufficient funds: add funds to continue') : text(200, PAGE)));
    expect((await ask(new BrightDataUnlockerReader('z', quota))).keyLabel).toBe('conta-2');
    const q402 = fakeFetch((_u, init) => ((init.headers as Record<string, string>).authorization!.includes('conta-1') ? text(402, 'x') : text(200, PAGE)));
    expect((await ask(new BrightDataUnlockerReader('z', q402))).keyLabel).toBe('conta-2');
  });

  it('erro do unlocker/alvo (x-brd-error) = falha da URL, 404 do alvo = not_found, 401 do alvo = login, zona inexistente = erro de configuração sem trocar chave', async () => {
    const e = fakeFetch(() => text(200, '', { 'x-brd-error': 'target_unreachable', 'x-brd-status-code': '502' }));
    expect(await ask(new BrightDataUnlockerReader('z', e))).toMatchObject({ ok: false, failure: 'provider_error' });
    const nf = fakeFetch(() => text(200, '', { 'x-brd-error': 'x', 'x-brd-status-code': '404' }));
    expect(await ask(new BrightDataUnlockerReader('z', nf))).toMatchObject({ ok: false, failure: 'not_found' });
    const login = fakeFetch(() => text(200, 'Acesso restrito', { 'x-brd-status-code': '401' }));
    const lr = await ask(new BrightDataUnlockerReader('z', login));
    expect(lr).toMatchObject({ ok: false, failure: 'login_required' });
    expect(lr.text).toBeUndefined();
    const zone = fakeFetch(() => text(400, 'zone "zona_ln" not found'));
    const zr = await ask(new BrightDataUnlockerReader('zona_ln', zone));
    expect(zr).toMatchObject({ ok: false, failure: 'provider_error' });
    expect((zone as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1); // erro de zona não consome nem troca a segunda chave
  });
});

describe('Apify — RAG Web Browser', () => {
  it('requisição: run-sync-get-dataset-items do actor oficial, Bearer e {query: url}; markdown vira o texto', async () => {
    const f = fakeFetch(() => json(201, [{ markdown: `# Título\n${'conteúdo '.repeat(100)}`, metadata: { url: 'https://alvo.invalid/ri' }, crawl: { httpStatusCode: 200 } }]));
    const r = await ask(new ApifyRagBrowserReader(f));
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toContain('https://api.apify.com/v2/actors/apify~rag-web-browser/run-sync-get-dataset-items');
    expect(url).not.toContain(SECRETS.K1!);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRETS.K1}`);
    expect(JSON.parse(String(init.body))).toEqual({ query: 'https://alvo.invalid/ri' });
    expect(r).toMatchObject({ ok: true, finalUrl: 'https://alvo.invalid/ri', httpStatus: 200 });
    expect(r.text).toContain('Título');
    expect(r.html).toBeUndefined();
  });

  it('401 troca de conta; 402 = cota; 429 = espera; 408 = tempo esgotado; lista vazia = erro do provedor', async () => {
    const byStatus = (st: number, body: unknown = {}) => fakeFetch((_u, init) => ((init.headers as Record<string, string>).authorization!.includes('conta-1') ? json(st, body) : json(201, [{ markdown: 'ok '.repeat(200) }])));
    expect((await ask(new ApifyRagBrowserReader(byStatus(401)))).keyLabel).toBe('conta-2');
    expect((await ask(new ApifyRagBrowserReader(byStatus(402)))).keyLabel).toBe('conta-2');
    const all429 = fakeFetch(() => json(429, { error: { type: 'rate-limit-exceeded' } }));
    expect(await ask(new ApifyRagBrowserReader(all429))).toMatchObject({ ok: false, failure: 'rate_limited' });
    expect(await ask(new ApifyRagBrowserReader(fakeFetch(() => json(408, {}))))).toMatchObject({ ok: false, failure: 'timeout' });
    expect(await ask(new ApifyRagBrowserReader(fakeFetch(() => json(201, []))))).toMatchObject({ ok: false, failure: 'provider_error' });
  });
});

describe('Scrapfly — Scrape API', () => {
  const okBody = { result: { content: PAGE, status_code: 200, success: true }, context: { cost: { total: 1 } } };

  it('parâmetros por modo: basic só key+url; asp acrescenta asp=true; asp_js acrescenta render_js; custo vem do cabeçalho', async () => {
    const calls: URL[] = [];
    const f = fakeFetch((u) => { calls.push(new URL(u)); return json(200, okBody, { 'x-scrapfly-api-cost': '6' }); });
    const basic = await ask(new ScrapflyReader('basic', f));
    const asp = await ask(new ScrapflyReader('asp', f));
    const aspJs = await ask(new ScrapflyReader('asp_js', f));
    expect(calls[0]!.searchParams.get('asp')).toBeNull();
    expect(calls[0]!.searchParams.get('render_js')).toBeNull();
    expect(calls[0]!.searchParams.get('url')).toBe('https://alvo.invalid/ri');
    expect(calls[1]!.searchParams.get('asp')).toBe('true');
    expect(calls[1]!.searchParams.get('render_js')).toBeNull();
    expect(calls[2]!.searchParams.get('render_js')).toBe('true');
    expect([basic.creditsUsed, asp.creditsUsed, aspJs.creditsUsed]).toEqual([6, 6, 6]); // cobrado pelo valor informado pelo provedor
    expect(basic.html).toBe(PAGE);
    expect(new ScrapflyReader('basic').unlocks).toBe(false);
    expect(new ScrapflyReader('asp').unlocks).toBe(true);
  });

  it('429 QUOTA_LIMIT_REACHED troca de conta; 429 de concorrência/taxa é espera; 401 troca; 422 do alvo e CAPTCHA tratados', async () => {
    const byCode = (status: number, code: string) => fakeFetch((u) => (new URL(u).searchParams.get('key') === SECRETS.K1 ? json(status, { result: { error: { code } } }) : json(200, okBody)));
    expect((await ask(new ScrapflyReader('basic', byCode(429, 'ERR::SCRAPE::QUOTA_LIMIT_REACHED')))).keyLabel).toBe('conta-2');
    expect((await ask(new ScrapflyReader('basic', byCode(429, 'ERR::SCRAPE::BALANCE_REQUIRED_FOR_EXTRA')))).keyLabel).toBe('conta-2');
    expect((await ask(new ScrapflyReader('basic', byCode(401, 'invalid')))).keyLabel).toBe('conta-2');
    const conc = fakeFetch(() => json(429, { result: { error: { code: 'ERR::SCRAPE::TOO_MANY_CONCURRENT_REQUEST' } } }, { 'retry-after': '7' }));
    expect(await ask(new ScrapflyReader('basic', conc))).toMatchObject({ ok: false, failure: 'rate_limited', retryAfterSeconds: 7 });
    expect(await ask(new ScrapflyReader('asp', fakeFetch(() => json(422, { result: { error: { code: 'ERR::SCRAPE::UPSTREAM_WEBSITE_ERROR' } } }))))).toMatchObject({ ok: false, failure: 'provider_error' });
    expect(await ask(new ScrapflyReader('asp', fakeFetch(() => json(422, { result: { error: { code: 'ERR::ASP::CAPTCHA_ERROR' } } }))))).toMatchObject({ ok: false, failure: 'captcha_unsolved' });
  });
});

describe('Zyte — Zyte API', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

  it('requisição: Basic com a chave como usuário e senha vazia; http usa httpResponseBody (base64), browser usa browserHtml', async () => {
    const f = fakeFetch(() => json(200, { url: 'https://alvo.invalid/ri', statusCode: 200, httpResponseBody: b64(PAGE) }));
    const r = await ask(new ZyteReader('http', f));
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://api.zyte.com/v1/extract');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`${SECRETS.K1}:`).toString('base64')}`);
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://alvo.invalid/ri', httpResponseBody: true });
    expect(r).toMatchObject({ ok: true, httpStatus: 200, creditsUsed: 2 });
    expect(r.html).toBe(PAGE);

    const fb = fakeFetch(() => json(200, { url: 'https://alvo.invalid/ri', statusCode: 200, browserHtml: PAGE }));
    const rb = await ask(new ZyteReader('browser', fb));
    expect(JSON.parse(String((fb as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body))).toEqual({ url: 'https://alvo.invalid/ri', browserHtml: true });
    expect(rb).toMatchObject({ ok: true, creditsUsed: 10 });
  });

  it('401 troca; 403 account-suspended = crédito acabou (troca); 429 e 503 = espera; 520/521 = o provedor não leu a URL; 404 do alvo = not_found', async () => {
    const first = (st: number, body: unknown) => fakeFetch((_u, init) => ((init.headers as Record<string, string>).authorization === `Basic ${Buffer.from(`${SECRETS.K1}:`).toString('base64')}` ? json(st, body) : json(200, { statusCode: 200, httpResponseBody: b64(PAGE) })));
    expect((await ask(new ZyteReader('http', first(401, { type: '/auth/key-not-found' })))).keyLabel).toBe('conta-2');
    expect((await ask(new ZyteReader('http', first(403, { type: '/auth/account-suspended' })))).keyLabel).toBe('conta-2');
    expect(await ask(new ZyteReader('http', fakeFetch(() => json(429, { type: '/limits/over-user-limit' }))))).toMatchObject({ ok: false, failure: 'rate_limited' });
    expect(await ask(new ZyteReader('http', fakeFetch(() => json(503, { type: '/limits/over-global-limit' }))))).toMatchObject({ ok: false, failure: 'rate_limited' });
    expect(await ask(new ZyteReader('http', fakeFetch(() => json(520, { type: '/download/temporary-error' }))))).toMatchObject({ ok: false, failure: 'provider_error' });
    expect(await ask(new ZyteReader('http', fakeFetch(() => json(200, { statusCode: 404, httpResponseBody: b64('nada') }))))).toMatchObject({ ok: false, failure: 'not_found' });
  });
});

describe('contas, cota e segredo', () => {
  it('as duas contas esgotadas viram quotaExhausted para o Editorial (status 432), sem corpo; o segredo não aparece em nenhum resultado', async () => {
    const f = fakeFetch(() => json(402, {}));
    const reader = make(new ApifyRagBrowserReader(f));
    const r = await reader.read({ url: 'https://alvo.invalid/ri' });
    expect(r).toMatchObject({ ok: false, failure: 'quota_exhausted' });
    expect(toEditorialResult(r)).toEqual({ status: 432, body: '', quotaExhausted: true });
    const pool = (reader as unknown as { pool: { report(): unknown } }).pool;
    expect(JSON.stringify([r, pool.report()])).not.toContain('NAO-VAZAR');
    const again = await reader.read({ url: 'https://alvo.invalid/outra' });
    expect(again.failure).toBe('quota_exhausted');
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2); // nenhuma chamada nova com as contas esgotadas
  });

  it('chaves inválidas nas duas contas: auth_failed vira quotaExhausted (não é culpa da fonte) e o relatório marca as chaves', async () => {
    const reader = make(new BrightDataUnlockerReader('z', fakeFetch(() => text(401, 'Invalid token'))));
    const r = await reader.read({ url: 'https://alvo.invalid/ri' });
    expect(r.failure).toBe('auth_failed');
    expect(toEditorialResult(r)).toMatchObject({ quotaExhausted: true });
    const rep = (reader as unknown as { pool: { report(): { invalid?: boolean }[] } }).pool.report();
    expect(rep.every((k) => k.invalid === true)).toBe(true);
  });
});

describe('ponte para o ReaderPort do Editorial e cascata por custo', () => {
  const base: ReadResult = { ok: false, url: 'https://x.invalid', provider: 'p' };

  it('cada falha vira o campo certo do contrato: cota, ritmo (429, sem trocar), URL falhou, 404 normal', () => {
    expect(toEditorialResult({ ...base, failure: 'quota_exhausted' })).toEqual({ status: 432, body: '', quotaExhausted: true });
    expect(toEditorialResult({ ...base, failure: 'rate_limited', retryAfterSeconds: 12 })).toEqual({ status: 429, body: '', retryAfterSec: 12 });
    expect(toEditorialResult({ ...base, failure: 'host_paced', retryAfterSeconds: 4 })).toMatchObject({ status: 429, retryAfterSec: 4 });
    expect(toEditorialResult({ ...base, failure: 'login_required' })).toEqual({ status: 401, body: '', failedUrl: true });
    expect(toEditorialResult({ ...base, failure: 'paywall' })).toEqual({ status: 402, body: '', failedUrl: true });
    expect(toEditorialResult({ ...base, failure: 'captcha_unsolved' })).toMatchObject({ status: 403, failedUrl: true });
    expect(toEditorialResult({ ...base, failure: 'not_found' })).toEqual({ status: 404, body: '' });
    expect(toEditorialResult({ ...base, failure: 'timeout' })).toMatchObject({ status: 504, failedUrl: true });
    expect(toEditorialResult({ ...base, failure: 'disabled' })).toMatchObject({ failedUrl: true });
    expect(toEditorialResult({ ...base, ok: true, httpStatus: 200, html: '<p>x</p>', text: 'x' })).toEqual({ status: 200, body: '<p>x</p>', format: 'html' });
    expect(toEditorialResult({ ...base, ok: true, text: 'só texto' })).toEqual({ status: 200, body: 'só texto', format: 'text' });
  });

  it('asEditorialReader entrega o contrato (name, unlocks, read) e o leitor desligado nunca chama o provedor', async () => {
    const f = fakeFetch(() => text(200, PAGE));
    const on = asEditorialReader(make(new BrightDataUnlockerReader('z', f)), 'brightdata');
    expect(on).toMatchObject({ name: 'brightdata', unlocks: true });
    expect(await on.read('https://alvo.invalid/ri')).toMatchObject({ status: 200, format: 'html' });
    const off = asEditorialReader(createReader({ keyed: new BrightDataUnlockerReader('z', f), keys: KEYS, resolveSecret: (r) => SECRETS[r] }), 'brightdata-off');
    expect(await off.read('https://alvo.invalid/ri')).toMatchObject({ failedUrl: true });
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1); // só a chamada do leitor ligado
  });

  it('cascata por custo: do mais barato ao mais caro em fração da cota gratuita; sem custo declarado vai para o fim', () => {
    const mk = (k: KeyedReader) => make(k);
    const f = fakeFetch(() => text(200, ''));
    const readers = [
      mk(new ScrapflyReader('asp_js', f)), mk(new ScrapflyReader('basic', f)), mk(new ApifyRagBrowserReader(f)),
      mk(new BrightDataUnlockerReader('z', f)), mk(new ZyteReader('http', f)),
    ];
    const names = orderByCost(readers).map((r) => r.provider);
    expect(names).toEqual(['zyte-http', 'brightdata-unlocker', 'apify-rag-web-browser', 'scrapfly-basic', 'scrapfly-asp_js']);
    expect(orderByCost([{ provider: 'sem-custo' }, ...readers].map((r) => ({ ...r, freeQuotaFractionPerRead: (r as { freeQuotaFractionPerRead?: number }).freeQuotaFractionPerRead }))).at(-1)?.provider).toBe('sem-custo');
  });
});

describe('stripHtml', () => {
  it('remove script, estilo, comentário e tags; decodifica entidades básicas', () => {
    expect(stripHtml('<style>x{}</style><script>alert(1)</script><!-- c --><p>A&amp;B &lt;ok&gt;&nbsp;fim</p>')).toBe('A&B <ok> fim');
  });
});
