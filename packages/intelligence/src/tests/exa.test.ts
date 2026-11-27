import { describe, it, expect, vi } from 'vitest';
import { ExaContentsReader, ExaDiscoverer, createReader, type KeyConfig } from '../index';

type H = (url: string, init: RequestInit) => Response;
const fakeFetch = (h: H) => vi.fn(async (u: string | URL | Request, init?: RequestInit) => h(String(u), init ?? {})) as unknown as typeof fetch;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const calls = (f: typeof fetch) => (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

const KEYS: KeyConfig[] = [
  { label: 'conta-1', secretRef: 'K1', monthlyCreditCap: 10_000 },
  { label: 'conta-2', secretRef: 'K2', monthlyCreditCap: 10_000 },
];
const SECRETS: Record<string, string> = { K1: 'exa-segredo-1-NAO-VAZAR', K2: 'exa-segredo-2-NAO-VAZAR' };
const deps = (f: typeof fetch, extra: Record<string, unknown> = {}) => ({ keys: KEYS, resolveSecret: (r: string) => SECRETS[r], fetchImpl: f, ...extra });

describe('Exa — descoberta restrita ao domínio da fonte', () => {
  it('requisição: POST /search com x-api-key, includeDomains, numResults, type lite e SEM conteúdo; devolve só link, título e data', async () => {
    const f = fakeFetch(() => json(200, {
      results: [
        { url: 'https://ri.exemplo.invalid/comunicado-1', title: 'Comunicado 1', publishedDate: '2026-11-20T00:00:00.000Z', text: 'NAO-DEVE-VIR' },
        { url: 'https://ri.exemplo.invalid/comunicado-1', title: 'duplicado' },
        { url: 'https://outro-site.invalid/x', title: 'fora do domínio' },
        { url: 'javascript:alert(1)', title: 'esquema inválido' },
        { url: 'https://sub.ri.exemplo.invalid/p2', title: 'Subdomínio' },
      ],
      costDollars: { total: 0.004 },
    }));
    const d = new ExaDiscoverer(deps(f));
    const out = await d.discover({ host: 'ri.exemplo.invalid', limit: 5, since: '2026-11-01T00:00:00Z' });
    const [url, init] = calls(f)[0]!;
    expect(url).toBe('https://api.exa.ai/search');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(SECRETS.K1);
    expect(url).not.toContain(SECRETS.K1!);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ numResults: 5, type: 'lite', includeDomains: ['ri.exemplo.invalid'], startPublishedDate: '2026-11-01T00:00:00Z' });
    expect(body.contents).toBeUndefined(); // descoberta não pede texto
    expect(out).toEqual([
      { url: 'https://ri.exemplo.invalid/comunicado-1', title: 'Comunicado 1', publishedAt: '2026-11-20T00:00:00.000Z' },
      { url: 'https://sub.ri.exemplo.invalid/p2', title: 'Subdomínio', publishedAt: null },
    ]);
    expect(JSON.stringify(out)).not.toContain('NAO-DEVE-VIR'); // nenhum texto sai da descoberta
  });

  it('limite é truncado entre 1 e 20; busca "auto" usa o tipo auto', async () => {
    const f = fakeFetch(() => json(200, { results: [] }));
    const d = new ExaDiscoverer(deps(f, { searchType: 'auto' }));
    await d.discover({ host: 'a.invalid', limit: 500 });
    await d.discover({ host: 'a.invalid', limit: 0 });
    expect(JSON.parse(String(calls(f)[0]![1].body))).toMatchObject({ numResults: 20, type: 'auto' });
    expect(JSON.parse(String(calls(f)[1]![1].body)).numResults).toBe(1);
  });

  it('402 (sem créditos) troca para a conta 2; 401 tira a chave de uso; as duas esgotadas: erro com a frase que o ChainedReader do Editorial reconhece', async () => {
    const byKey = (first: Response) => fakeFetch((_u, init) => ((init.headers as Record<string, string>)['x-api-key'] === SECRETS.K1 ? first.clone() : json(200, { results: [{ url: 'https://a.invalid/1', title: 't' }] })));
    expect((await new ExaDiscoverer(deps(byKey(json(402, { tag: 'NO_MORE_CREDITS' })))).discover({ host: 'a.invalid', limit: 3 }))).toHaveLength(1);
    const d401 = new ExaDiscoverer(deps(byKey(json(401, { tag: 'INVALID_API_KEY' }))));
    expect(await d401.discover({ host: 'a.invalid', limit: 3 })).toHaveLength(1);
    expect(d401.pool.report().find((k) => k.label === 'conta-1')?.invalid).toBe(true);

    const none = new ExaDiscoverer(deps(fakeFetch(() => json(402, { tag: 'NO_MORE_CREDITS' }))));
    await expect(none.discover({ host: 'a.invalid', limit: 3 })).rejects.toThrow(/cota do serviço esgotada/);
    const callsBefore = 2;
    await expect(none.discover({ host: 'a.invalid', limit: 3 })).rejects.toThrow(/cota do serviço esgotada/); // sem nova chamada com as contas esgotadas
    expect(callsBefore).toBe(2);
  });

  it('429/503 = espera com Retry-After (erro de taxa, não de cota); teto local de US$ 10 por conta nunca é ultrapassado', async () => {
    const rl = new ExaDiscoverer(deps(fakeFetch(() => json(429, { tag: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '9' }))));
    await expect(rl.discover({ host: 'a.invalid', limit: 3 })).rejects.toThrow(/limite de taxa.*9s/);

    const small: KeyConfig[] = [{ label: 'conta-1', secretRef: 'K1', monthlyCreditCap: 8 }]; // cabem 2 buscas lite (4 + 4)
    const f = fakeFetch(() => json(200, { results: [] }));
    const d = new ExaDiscoverer({ keys: small, resolveSecret: (r) => SECRETS[r], fetchImpl: f });
    await d.discover({ host: 'a.invalid', limit: 1 });
    await d.discover({ host: 'a.invalid', limit: 1 });
    await expect(d.discover({ host: 'a.invalid', limit: 1 })).rejects.toThrow(/cota do serviço esgotada/);
    expect(calls(f)).toHaveLength(2);
  });

  it('o segredo não aparece em erros nem no relatório do pool', async () => {
    const d = new ExaDiscoverer(deps(fakeFetch(() => json(500, { error: 'falha', echo: SECRETS.K1 }))));
    const err = await d.discover({ host: 'a.invalid', limit: 1 }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain('NAO-VAZAR');
    expect(JSON.stringify(d.pool.report())).not.toContain('NAO-VAZAR');
  });
});

describe('Exa — leitura de conteúdo já indexado (/contents)', () => {
  const read = (f: typeof fetch) => createReader({ keyed: new ExaContentsReader(f), keys: KEYS, resolveSecret: (r) => SECRETS[r], robots: async () => ({ allowed: true, note: 'MOCK: robots permite' }) }, { enabled: true, pace: false }).read({ url: 'https://a.invalid/p' });

  it('requisição e sucesso: POST /contents com urls e text; custo vem de costDollars', async () => {
    const f = fakeFetch(() => json(200, { results: [{ url: 'https://a.invalid/p', text: 'Texto indexado '.repeat(80) }], statuses: [{ id: 'https://a.invalid/p', status: 'success', source: 'cached' }], costDollars: { total: 0.001 } }));
    const r = await read(f);
    expect(JSON.parse(String(calls(f)[0]![1].body))).toEqual({ urls: ['https://a.invalid/p'], text: true });
    expect(r).toMatchObject({ ok: true, creditsUsed: 1, keyLabel: 'conta-1' });
    expect(r.text).toContain('Texto indexado');
  });

  it('erro por URL em statuses: CRAWL_NOT_FOUND = not_found; outro erro = provider_error; 402 troca de conta', async () => {
    expect(await read(fakeFetch(() => json(200, { results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } }] })))).toMatchObject({ ok: false, failure: 'not_found' });
    expect(await read(fakeFetch(() => json(200, { results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_TIMEOUT' } }] })))).toMatchObject({ ok: false, failure: 'provider_error' });
    const f = fakeFetch((_u, init) => ((init.headers as Record<string, string>)['x-api-key'] === SECRETS.K1 ? json(402, {}) : json(200, { results: [{ text: 'ok '.repeat(100) }], statuses: [{ status: 'success' }] })));
    expect(await read(f)).toMatchObject({ ok: true, keyLabel: 'conta-2' });
  });
});
