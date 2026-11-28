// ADR-007 (v8; decisão do PM de 27/11, J-14 A): o coletor respeita robots.txt e nunca contorna CAPTCHA, em QUALQUER caminho de download.
// Não há lista nominal de exceções, então não há exceção. Sem rede: fetcher, resolvedor e serviços de leitura são simulados.
import { describe, it, expect } from 'vitest';
import { ChainedReader, Collector, stopsCollection, type ReaderPort, type ReaderResult } from '../collector/collector';
import type { Fetcher, HttpResponse } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import type { Source } from '../types';

const DIRETA = MOCK_SOURCE;
const HOST = 'blog.mock.example';
const PROVEDOR: Source = { ...MOCK_SOURCE, id: 'blog-prov', kind: 'blog', host: HOST, listingUrl: `https://${HOST}/`, feedUrl: `https://${HOST}/feed.xml`, acesso: 'via-provedor' };
const RI = (p: string) => `https://${DIRETA.host}${p}`;
const BL = (p: string) => `https://${HOST}${p}`;
const resolver = () => new FakeResolver({ [DIRETA.host]: [[MOCK_PUBLIC_IP]], [HOST]: [[MOCK_PUBLIC_IP]] });
const LIVRE = 'User-agent: *\nDisallow:';
const PROIBE = 'User-agent: *\nDisallow: /';
const PAGINA = `<html><head><title>Comunicado</title></head><body><article>${'<p>O programa fictício anunciou novas regras de acúmulo para os participantes, com vigência descrita no comunicado oficial.</p>'.repeat(8)}</article></body></html>`;
const CAPTCHAS: Record<string, string> = {
  'desafio Cloudflare': '<html><head><title>Just a moment...</title></head><body><div id="challenge-form">Verifying you are human.</div></body></html>',
  'widget reCAPTCHA em página curta': '<html><body><h1>Verificação</h1><div class="g-recaptcha" data-sitekey="mock"></div><p>Confirme que você é humano.</p></body></html>',
  'DataDome': '<html><body><script src="https://geo.captcha-delivery.com/c.js"></script><p>aguarde</p></body></html>',
};
const relogio = () => { let t = Date.parse('2026-11-27T12:00:00Z'); return { now: () => new Date(t), sleep: async (ms: number) => { t += ms; } }; };
const coletor = (fetcher: Fetcher, reader?: ReaderPort) => new Collector(fetcher, { ...relogio(), resolver: resolver(), flags: COLLECT_ON, minSpacingMs: 0, ...(reader ? { reader } : {}) });
function leitor(pages: Record<string, ReaderResult> = {}, extra: Partial<ReaderPort> = {}) {
  const calls: string[] = [];
  const r: ReaderPort = { name: 'fake', read: async (url) => { calls.push(url); return pages[url] ?? { status: 200, body: PAGINA, format: 'html' }; }, ...extra };
  return { r, calls };
}
const robotsResp = (over: Partial<HttpResponse>): HttpResponse => ({ status: 200, headers: {}, body: '', ...over });

/** Respostas de robots.txt que NÃO permitem baixar (erro ou ilegível). */
const INDISPONIVEL: Array<[string, HttpResponse | 'rede']> = [
  ['HTTP 401', robotsResp({ status: 401 })], ['HTTP 403', robotsResp({ status: 403 })], ['HTTP 410', robotsResp({ status: 410 })],
  ['HTTP 429', robotsResp({ status: 429 })], ['HTTP 500', robotsResp({ status: 500 })], ['HTTP 503', robotsResp({ status: 503 })],
  ['200 com HTML', robotsResp({ body: '<!doctype html><html><body>app</body></html>' })],
  ['200 com desafio', robotsResp({ body: CAPTCHAS['desafio Cloudflare']! })],
  ['erro de rede/timeout', 'rede'],
];
function webCom(robotsUrl: string, resp: HttpResponse | 'rede', pageUrl: string) {
  const calls: string[] = [];
  const f: Fetcher = { get: async (url) => {
    calls.push(url);
    if (url === robotsUrl) { if (resp === 'rede') throw new Error('timeout'); return resp; }
    return url === pageUrl ? { status: 200, headers: {}, body: PAGINA } : { status: 404, headers: {}, body: '' };
  } };
  return { f, calls };
}

describe('coleta direta', () => {
  it('robots que proíbe: a página não é baixada; controle: robots que permite baixa e ingere', async () => {
    const nao = new MockFetcher({ [RI('/robots.txt')]: PROIBE, [RI('/noticias/1')]: PAGINA });
    expect((await coletor(nao).collectUrl(DIRETA, RI('/noticias/1'))).skip?.code).toBe('robots_disallow');
    expect(nao.calls).toEqual([RI('/robots.txt')]);
    const sim = new MockFetcher({ [RI('/robots.txt')]: LIVRE, [RI('/noticias/1')]: PAGINA });
    expect((await coletor(sim).collectUrl(DIRETA, RI('/noticias/1'))).evidence).toBeDefined();
  });

  it.each(INDISPONIVEL)('robots indisponível (%s): não baixa', async (_nome, resp) => {
    const { f, calls } = webCom(RI('/robots.txt'), resp, RI('/noticias/1'));
    const r = await coletor(f).collectUrl(DIRETA, RI('/noticias/1'));
    expect(r.evidence).toBeUndefined();
    expect(r.skip?.code).toBe('robots_unavailable');
    expect(calls).toEqual([RI('/robots.txt')]);
  });

  it('robots ausente (404) = sem restrição (RFC 9309): baixa', async () => {
    const { f } = webCom(RI('/robots.txt'), robotsResp({ status: 404 }), RI('/noticias/1'));
    expect((await coletor(f).collectUrl(DIRETA, RI('/noticias/1'))).evidence).toBeDefined();
  });

  it.each(Object.entries(CAPTCHAS))('CAPTCHA (%s): não ingere e para a fonte', async (_n, html) => {
    const f = new MockFetcher({ [RI('/robots.txt')]: LIVRE, [RI('/noticias/1')]: html });
    const r = await coletor(f).collectUrl(DIRETA, RI('/noticias/1'));
    expect(r.evidence).toBeUndefined();
    expect(r.skip?.code).toBe('challenge');
    expect(stopsCollection(r.skip!)).toBe(true);
  });
});

describe('coleta via provedor', () => {
  it('robots que proíbe: o provedor NÃO é chamado (página e feed); controle: robots que permite usa o provedor', async () => {
    const nao = leitor();
    const c = coletor(new MockFetcher({ [BL('/robots.txt')]: PROIBE }), nao.r);
    expect((await c.collectUrl(PROVEDOR, BL('/post-1'))).skip?.code).toBe('robots_disallow');
    expect((await c.collectFeed(PROVEDOR)).skipped.map((s) => s.code)).toEqual(['robots_disallow']);
    expect(nao.calls).toEqual([]);
    const sim = leitor();
    const ok = await coletor(new MockFetcher({ [BL('/robots.txt')]: LIVRE }), sim.r).collectUrl(PROVEDOR, BL('/post-1'));
    expect(ok.evidence?.acesso).toBe('via-provedor');
    expect(sim.calls).toEqual([BL('/post-1')]);
  });

  it('descoberta por busca: cada matéria encontrada passa pelo robots antes da leitura', async () => {
    const l = leitor({}, { discover: async () => [{ url: BL('/privado/a') }, { url: BL('/post-2') }] });
    const r = await coletor(new MockFetcher({ [BL('/robots.txt')]: 'User-agent: *\nDisallow: /privado/' }), l.r).collectFeed(PROVEDOR);
    expect(r.skipped.map((s) => s.code)).toEqual(['robots_disallow']);
    expect(l.calls).toEqual([BL('/post-2')]);
    expect(r.evidences).toHaveLength(1);
  });

  it.each(INDISPONIVEL)('robots indisponível (%s): o provedor não é chamado', async (_nome, resp) => {
    const { f } = webCom(BL('/robots.txt'), resp, BL('/nada'));
    const l = leitor();
    expect((await coletor(f, l.r).collectUrl(PROVEDOR, BL('/post-1'))).skip?.code).toBe('robots_unavailable');
    expect(l.calls).toEqual([]);
  });

  it('Crawl-delay acima do máximo também vale pelo provedor', async () => {
    const l = leitor();
    const f = new MockFetcher({ [BL('/robots.txt')]: 'User-agent: *\nCrawl-delay: 600' });
    expect((await coletor(f, l.r).collectUrl(PROVEDOR, BL('/post-1'))).skip?.code).toBe('crawl_delay_excessive');
    expect(l.calls).toEqual([]);
  });

  it('serviço com desbloqueio (resolve CAPTCHA/proxy) não é usado', async () => {
    const l = leitor({}, { unlocks: true });
    const r = await coletor(new MockFetcher({ [BL('/robots.txt')]: LIVRE }), l.r).collectUrl(PROVEDOR, BL('/post-1'));
    expect(r.evidence).toBeUndefined();
    expect(r.skip?.code).toBe('reader_unavailable');
    expect(r.skip?.detail).toMatch(/ADR-007/);
    expect(l.calls).toEqual([]);
  });

  it.each(Object.entries(CAPTCHAS))('CAPTCHA devolvido pelo provedor (%s): não ingere e para a fonte', async (_n, html) => {
    const l = leitor({ [BL('/post-1')]: { status: 200, body: html, format: 'html' } }, { discover: async () => [{ url: BL('/post-1') }, { url: BL('/post-2') }] });
    const r = await coletor(new MockFetcher({ [BL('/robots.txt')]: LIVRE }), l.r).collectFeed(PROVEDOR);
    expect(r.evidences).toEqual([]);
    expect(r.skipped.map((s) => s.code)).toEqual(['challenge']);
    expect(l.calls).toEqual([BL('/post-1')]);
  });

  it('cadeia: falha por URL (recusa) não passa a outro provedor; provedor com desbloqueio é ignorado; cota esgotada ainda troca', async () => {
    const a = leitor({ [BL('/x')]: { status: 502, body: '', failedUrl: true } });
    const b = leitor();
    expect((await new ChainedReader([a.r, b.r]).read(BL('/x'))).failedUrl).toBe(true);
    expect(b.calls).toEqual([]);
    const u = leitor({}, { unlocks: true });
    const limpo = leitor();
    const chain = new ChainedReader([u.r, limpo.r]);
    expect(chain.unlocks).toBe(false);
    expect((await chain.read(BL('/y'))).status).toBe(200);
    expect(u.calls).toEqual([]);
    const semCota = leitor({ [BL('/z')]: { status: 432, body: '', quotaExhausted: true } });
    const outro = leitor();
    await new ChainedReader([semCota.r, outro.r]).read(BL('/z'));
    expect(outro.calls).toEqual([BL('/z')]);
    expect(new ChainedReader([leitor({}, { unlocks: true }).r]).unlocks).toBe(true);
  });
});
