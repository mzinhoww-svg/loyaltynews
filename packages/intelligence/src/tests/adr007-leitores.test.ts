// ADR-007 (v8; J-14 A) nos leitores do Intelligence: robots.txt do alvo antes de qualquer provedor, nenhum desbloqueio de CAPTCHA, e a leitura
// direta recusada nunca vira leitura por provedor. Sem rede: todo fetch e todo provedor são simulados.
import { describe, it, expect, vi } from 'vitest';
import {
  BrightDataUnlockerReader, ScrapflyReader, ZyteReader, createBrightDataStagingReader, createDirectPageReader, createReader,
  type KeyedReader, type ProviderResponse, type ReaderDeps,
} from '../index';
import { robotsAllows } from '../../scripts/verify-dataset.mjs';

const URL_ALVO = 'https://ri.exemplo.invalid/diretoria';
const TEXTO = 'Diretoria e administração da companhia, página pública. '.repeat(30);
const CAPTCHA = '<html><head><title>Just a moment...</title></head><body><div id="challenge-form">Verifying you are human.</div></body></html>';
const res = (status: number, body = '', headers: Record<string, string> = { 'content-type': 'text/plain' }) => new Response(status === 204 ? null : body, { status, headers });

function montar(resp: Partial<ProviderResponse> = {}, robots?: unknown, extra: Partial<KeyedReader> = {}) {
  const read = vi.fn(async (): Promise<ProviderResponse> => ({ status: 'ok', credits: 1, httpStatus: 200, text: TEXTO, ...resp }));
  const resolveSecret = vi.fn(() => 'chave-falsa');
  const deps = { keyed: { provider: 'fake', creditsPerRead: 1, read, ...extra }, keys: [{ label: 'c', secretRef: 'K', monthlyCreditCap: 10 }], resolveSecret, ...(robots ? { robots } : {}) } as unknown as ReaderDeps;
  return { read, resolveSecret, reader: createReader(deps, { enabled: true, pace: false }) };
}
const permite = async () => ({ allowed: true as const, note: 'robots.txt permite' });

describe('leitor por provedor', () => {
  it('controle: robots permite e leitor sem desbloqueio lê', async () => {
    const t = montar({}, permite);
    expect(await t.reader.read({ url: URL_ALVO })).toMatchObject({ ok: true });
    expect(t.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['proíbe', async () => ({ allowed: false, unavailable: false, note: 'robots.txt proibe' }), 'robots_disallow'],
    ['indisponível', async () => ({ allowed: false, unavailable: true, note: 'robots.txt indisponivel' }), 'robots_unavailable'],
    ['verificador que lança', async () => { throw new Error('rede'); }, 'robots_unavailable'],
    ['sem verificador de robots (falha fechada)', undefined, 'robots_unavailable'],
  ])('robots %s: o provedor não é chamado', async (_n, robots, falha) => {
    const t = montar({}, robots);
    const r = await t.reader.read({ url: URL_ALVO });
    expect(r).toMatchObject({ ok: false, failure: falha });
    expect(r.text).toBeUndefined();
    expect(t.read).not.toHaveBeenCalled();
    expect(t.resolveSecret).not.toHaveBeenCalled();
  });

  it('destino final diferente e vedado pelo robots: conteúdo descartado', async () => {
    const robots = vi.fn(async (u: string) => (u.endsWith('/privado') ? { allowed: false, unavailable: false, note: 'x' } : { allowed: true, note: 'ok' }));
    const t = montar({ finalUrl: 'https://ri.exemplo.invalid/privado' }, robots);
    const r = await t.reader.read({ url: URL_ALVO });
    expect(r).toMatchObject({ ok: false, failure: 'robots_disallow' });
    expect(r.text).toBeUndefined();
  });

  it.each([
    ['Bright Data Unlocker', () => new BrightDataUnlockerReader('z', vi.fn() as unknown as typeof fetch)],
    ['Zyte', () => new ZyteReader('http', vi.fn() as unknown as typeof fetch)],
    ['Scrapfly ASP', () => new ScrapflyReader('asp', vi.fn() as unknown as typeof fetch)],
  ])('%s (desbloqueio): nunca é chamado', async (_n, criar) => {
    const keyed = criar();
    const chamada = vi.spyOn(keyed, 'read');
    const reader = createReader({ keyed, keys: [{ label: 'c', secretRef: 'K', monthlyCreditCap: 1000 }], resolveSecret: () => 'x', robots: permite } as unknown as ReaderDeps, { enabled: true, pace: false });
    expect(await reader.read({ url: URL_ALVO })).toMatchObject({ ok: false, failure: 'unlock_forbidden' });
    expect(chamada).not.toHaveBeenCalled();
  });

  it('staging com a flag ligada: a Bright Data (desbloqueio) não recebe nenhuma chamada', async () => {
    const fetchImpl = vi.fn(async () => res(200, TEXTO));
    const r = createBrightDataStagingReader(() => 'x', () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    expect((await r.read({ url: URL_ALVO })).failure).toBe('unlock_forbidden');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['página de CAPTCHA', { html: CAPTCHA, text: 'Verifying you are human.' }, 'captcha_unsolved'],
    ['CAPTCHA resolvido pelo provedor', { providerSolvedCaptcha: true }, 'captcha_solved_by_provider'],
  ])('%s: não entrega conteúdo', async (_n, resp, falha) => {
    const r = await montar(resp, permite).reader.read({ url: URL_ALVO });
    expect(r).toMatchObject({ ok: false, failure: falha });
    expect([r.text, r.html]).toEqual([undefined, undefined]);
  });
});

describe('leitura direta da releitura: recusa não vira provedor', () => {
  const web = (robots: Response | 'rede', pagina: () => Response) => vi.fn(async (u: string | URL | Request) => {
    if (String(u).endsWith('/robots.txt')) { if (robots === 'rede') throw new Error('timeout'); return robots.clone(); }
    return pagina();
  });
  const rodar = async (fetchImpl: ReturnType<typeof web>) => {
    const fallback = vi.fn(async (url: string) => ({ ok: true, text: TEXTO, finalUrl: url }));
    const r = await createDirectPageReader({ fallback, pauseMs: 0, fetchImpl: fetchImpl as unknown as typeof fetch } as never)(URL_ALVO);
    return { r, fallback, urls: fetchImpl.mock.calls.map((c) => String(c[0])) };
  };
  const livre = () => res(200, 'User-agent: *\nDisallow:');
  const html = (body: string, status = 200) => () => res(status, body, { 'content-type': 'text/html' });

  it('controle: robots permite e a página direta serve; o provedor não é usado', async () => {
    const t = await rodar(web(livre(), html(`<p>${TEXTO}</p>`)));
    expect(t.r.ok).toBe(true);
    expect(t.fallback).not.toHaveBeenCalled();
  });

  it.each<[string, Response | 'rede']>([
    ['proíbe', res(200, 'User-agent: *\nDisallow: /')], ['HTTP 403', res(403)], ['HTTP 500', res(500)],
    ['com página de desafio', res(200, CAPTCHA, { 'content-type': 'text/html' })], ['erro de rede', 'rede'],
  ])('robots %s: nem a página nem o provedor', async (_n, robots) => {
    const t = await rodar(web(robots, html(`<p>${TEXTO}</p>`)));
    expect(t.r.ok).toBe(false);
    expect(t.urls).toEqual(['https://ri.exemplo.invalid/robots.txt']);
    expect(t.fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['CAPTCHA', html(CAPTCHA)], ['HTTP 403', html('negado', 403)], ['HTTP 429', html('devagar', 429)], ['HTTP 503', html('x', 503)],
    ['redirecionamento', () => res(302, '', { location: 'https://outro.exemplo.invalid/' })],
  ])('página com %s: não ingere e não chama o provedor', async (_n, pagina) => {
    const t = await rodar(web(livre(), pagina));
    expect(t.r.ok).toBe(false);
    expect(t.r.text).toBeUndefined();
    expect(t.fallback).not.toHaveBeenCalled();
  });

  it('página permitida mas curta (depende de JavaScript): a reserva ainda pode ser chamada', async () => {
    const t = await rodar(web(livre(), html('<p>curta</p>')));
    expect(t.fallback).toHaveBeenCalledTimes(1);
  });

  it('contrato do verificador: 404/410 = sem regras; erro = indisponível (não busca); agente próprio vale para o grupo específico', async () => {
    const com = (r: Response) => (async () => r.clone()) as typeof fetch;
    for (const status of [404, 410]) expect((await robotsAllows(URL_ALVO, com(res(status)))).allowed).toBe(true);
    expect(await robotsAllows(URL_ALVO, com(res(500)))).toMatchObject({ allowed: false, unavailable: true });
    const so = 'User-agent: *\nDisallow:\n\nUser-agent: OutroBot\nDisallow: /';
    expect((await robotsAllows(URL_ALVO, com(res(200, so)))).allowed).toBe(true);
    expect(await robotsAllows(URL_ALVO, com(res(200, so)), 'OutroBot/1.0')).toMatchObject({ allowed: false, unavailable: false });
  });
});
