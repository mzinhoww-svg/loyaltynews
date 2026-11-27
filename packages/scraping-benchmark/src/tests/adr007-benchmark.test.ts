// ADR-007 (v8; J-14 A) no pacote do benchmark: leitor direto, roteador, rodada do benchmark e sombra ao vivo. Sem rede (MOCK).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReaderPort, ReadResult } from '@ln/intelligence';
import { DirectReader, type Transport, type TransportResponse } from '../direct-reader';
import { AdaptiveRouter } from '../router';
import { LiveShadow } from '../live-shadow';
import { runBenchmark } from '../runner';
import { BudgetGuard } from '../budget';
import { politeGet } from '../polite-get';

const LONG = 'Lorem ipsum dolor sit amet. '.repeat(60);
const CAPTCHA = '<html><head><title>Just a moment...</title></head><body><div id="challenge-form">Verifying you are human.</div></body></html>';
const resp = (status: number, body = '', headers: Record<string, string> = {}): TransportResponse => ({ status, headers, body: Buffer.from(body) });
const dns = async () => ['8.8.8.8'];
const URL_ALVO = 'https://site.example/noticia';

function transporte(robots: TransportResponse | 'rede', page: TransportResponse = resp(200, `<p>${LONG}</p>`)) {
  const calls: string[] = [];
  const t: Transport = async (url) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) { if (robots === 'rede') throw new Error('timeout'); return robots; }
    return page;
  };
  return { t, calls };
}

describe('leitor direto', () => {
  it('controle: robots permite e a página é lida', async () => {
    const m = transporte(resp(200, 'User-agent: *\nDisallow:'));
    expect(await new DirectReader(m.t, dns).read({ url: URL_ALVO })).toMatchObject({ ok: true });
    expect(m.calls).toEqual(['https://site.example/robots.txt', URL_ALVO]);
  });

  it.each<[string, TransportResponse | 'rede', string]>([
    ['proíbe', resp(200, 'User-agent: *\nDisallow: /'), 'robots_disallow'], ['HTTP 403', resp(403), 'robots_unavailable'], ['HTTP 500', resp(500), 'robots_unavailable'],
    ['com página de desafio', resp(200, CAPTCHA, { 'content-type': 'text/html' }), 'robots_unavailable'], ['erro de rede', 'rede', 'robots_unavailable'],
  ])('robots %s: a página não é baixada', async (_n, robots, falha) => {
    const m = transporte(robots);
    expect(await new DirectReader(m.t, dns).read({ url: URL_ALVO })).toMatchObject({ ok: false, failure: falha });
    expect(m.calls).toEqual(['https://site.example/robots.txt']);
  });

  it('redirecionamento para caminho vedado: o destino não é baixado', async () => {
    const calls: string[] = [];
    const t: Transport = async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return resp(200, 'User-agent: *\nDisallow: /privado');
      return resp(302, '', { location: '/privado/x' });
    };
    expect(await new DirectReader(t, dns).read({ url: URL_ALVO })).toMatchObject({ ok: false, failure: 'robots_disallow' });
    expect(calls).not.toContain('https://site.example/privado/x');
  });

  it('CAPTCHA com HTTP 200: falha, sem texto', async () => {
    const m = transporte(resp(404), resp(200, CAPTCHA));
    const r = await new DirectReader(m.t, dns).read({ url: URL_ALVO });
    expect(r).toMatchObject({ ok: false, failure: 'captcha_unsolved' });
    expect([r.text, r.html]).toEqual([undefined, undefined]);
  });
});

const leitor = (provider: string, r: Partial<ReadResult>) => {
  const read = vi.fn(async (q: { url: string }): Promise<ReadResult> => ({ ok: false, url: q.url, provider, ...r }));
  return { reader: { provider, read } as ReaderPort, read };
};
const rota = (reader: ReaderPort, name: string) => ({ name, reader, worstCaseCredits: 0, usdPerCredit: 0 });

describe('roteador e rodada: recusa não vira tentativa por outro provedor', () => {
  const BLOQUEIOS: Array<[string, Partial<ReadResult>]> = [
    ['CAPTCHA', { failure: 'captcha_unsolved' }], ['robots proíbe', { failure: 'robots_disallow' as never }], ['robots indisponível', { failure: 'robots_unavailable' as never }],
    ['HTTP 403', { failure: 'provider_error', httpStatus: 403 }], ['HTTP 401', { failure: 'login_required', httpStatus: 401 }], ['bloqueio 520', { failure: 'provider_error', httpStatus: 520 }],
  ];

  it.each(BLOQUEIOS)('%s: o segundo provedor não é chamado', async (_n, bloqueio) => {
    const a = leitor('a', bloqueio);
    const b = leitor('b', { ok: true, text: LONG });
    const r = new AdaptiveRouter([rota(a.reader, 'a'), rota(b.reader, 'b')], { env: {}, sleep: async () => {}, maxRetriesPerProvider: 0 });
    r.seed('site.example', 'a', { attempts: 1, valid: 1, credits: 0 });
    expect((await r.route(URL_ALVO)).result?.ok).toBe(false);
    expect(a.read).toHaveBeenCalledTimes(1);
    expect(b.read).not.toHaveBeenCalled();
  });

  it('controle: falha técnica (sem recusa) ainda passa ao próximo', async () => {
    const a = leitor('a', { failure: 'timeout' });
    const b = leitor('b', { ok: true, text: LONG });
    const r = new AdaptiveRouter([rota(a.reader, 'a'), rota(b.reader, 'b')], { env: {}, sleep: async () => {}, maxRetriesPerProvider: 0 });
    r.seed('site.example', 'a', { attempts: 1, valid: 1, credits: 0 });
    expect((await r.route(URL_ALVO)).result?.ok).toBe(true);
  });

  it('rodada do benchmark: URL recusada por um provedor não é tentada pelos seguintes (nem na retomada)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr007-'));
    const a = leitor('a', { failure: 'captcha_unsolved' });
    const b = leitor('b', { ok: true, text: LONG });
    const ds = [{ id: 'u1', url: URL_ALVO, domain: 'site.example', referenceTitle: 't', publishedAt: null }] as never;
    const opts = { experimentId: 'e', runId: 'r', codeVersion: 't', outPath: join(dir, 'a.jsonl'), budget: new BudgetGuard({}, join(dir, 'l.json')), minSecondsPerHost: 0 };
    await runBenchmark(ds, [{ name: 'direct', reader: a.reader, worstCaseCredits: 0 }], opts);
    const recs = await runBenchmark(ds, [{ name: 'direct', reader: b.reader, worstCaseCredits: 0 }].map((p) => ({ ...p, name: 'outro' })), { ...opts, budget: new BudgetGuard({ outro: { provider: 'outro', billing: 'free-confirmed', creditCap: 10, usdPerCredit: 0 } as never }, join(dir, 'l2.json')) });
    expect(b.read).not.toHaveBeenCalled();
    expect(recs.map((x) => x.errorClass)).toEqual(['source_refused']);
  });
});

describe('sombra ao vivo', () => {
  const montar = () => {
    const l = leitor('z', { ok: true, text: LONG });
    const sh = new LiveShadow({ router: new AdaptiveRouter([rota(l.reader, 'z')], { env: {} }), env: { SCRAPING_SHADOW_MODE: 'true' } });
    return { l, sh };
  };
  it.each<[string, { status: number; body?: string }]>([
    ['401', { status: 401 }], ['403', { status: 403 }], ['429', { status: 429 }], ['503', { status: 503 }],
    ['sem leitura (status 0)', { status: 0 }], ['CAPTCHA 200', { status: 200, body: CAPTCHA }],
  ])('leitura atual recusada (%s): a sombra não relê por provedor', async (_n, p) => {
    const { l, sh } = montar();
    sh.observe(URL_ALVO, { name: 'direct', ms: 1, ...p });
    await sh.drain();
    expect(l.read).not.toHaveBeenCalled();
  });
  it('controle: leitura atual aceita é medida na sombra', async () => {
    const { l, sh } = montar();
    sh.observe(URL_ALVO, { name: 'direct', status: 200, body: `<p>${LONG}</p>`, ms: 1 });
    await sh.drain();
    expect(l.read).toHaveBeenCalledTimes(1);
  });
});

describe('GET dos scripts de medição', () => {
  const web = (robots: string, pages: Record<string, () => Response>) => vi.fn(async (u: string | URL | Request) =>
    String(u).endsWith('/robots.txt') ? new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } }) : pages[String(u)]!());
  const get = (f: ReturnType<typeof web>) => politeGet(URL_ALVO, { userAgent: 'LoyaltyNewsBenchmark/0.1', fetchImpl: f as unknown as typeof fetch });

  it('robots que proíbe: não baixa; controle: robots que permite baixa', async () => {
    const nao = web('User-agent: *\nDisallow: /', {});
    expect(await get(nao)).toMatchObject({ status: 0, err: 'robots_disallow' });
    expect(nao).toHaveBeenCalledTimes(1);
    const sim = web('User-agent: *\nDisallow:', { [URL_ALVO]: () => new Response('<rss></rss>') });
    expect((await get(sim)).body.toString()).toBe('<rss></rss>');
  });
  it('redirecionamento para caminho vedado não é seguido; CAPTCHA não devolve corpo', async () => {
    const redir = web('User-agent: *\nDisallow: /privado', { [URL_ALVO]: () => new Response(null, { status: 302, headers: { location: '/privado/x' } }) });
    expect(await get(redir)).toMatchObject({ err: 'robots_disallow' });
    const cap = web('User-agent: *\nDisallow:', { [URL_ALVO]: () => new Response(CAPTCHA, { headers: { 'content-type': 'text/html' } }) });
    const r = await get(cap);
    expect([r.err, r.body.length]).toEqual(['captcha', 0]);
  });
});
