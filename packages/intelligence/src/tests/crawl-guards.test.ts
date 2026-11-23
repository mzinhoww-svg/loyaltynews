import { describe, it, expect, vi } from 'vitest';
import { classifyResponse, detectChallenge, matchesPattern, parseRobots, robotsDecision } from '../../scripts/crawl-guards.mjs';
import { fetchText, robotsAllows, UA } from '../../scripts/verify-dataset.mjs';
import { sonda } from '../../scripts/probe-sources.mjs';

const filler = (n: number) => 'Texto de uma página qualquer com conteúdo legítimo. '.repeat(Math.ceil(n / 50)).slice(0, n);
const page = (title: string, body: string, extraHead = '') => `<html><head><title>${title}</title>${extraHead}</head><body>${body}</body></html>`;
const resp = (status: number, body = '', headers: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

describe('robots.txt no padrão RFC 9309', () => {
  const dec = (robots: string, path: string, ua = UA) => robotsDecision(parseRobots(robots), ua, path);

  it('curinga interno e âncora final são reconhecidos', () => {
    expect(matchesPattern('/*/privado', '/a/b/privado/x')).toBe(true);
    expect(matchesPattern('/*/privado', '/privado')).toBe(false);
    expect(matchesPattern('/*.pdf$', '/docs/a.pdf')).toBe(true);
    expect(matchesPattern('/*.pdf$', '/docs/a.pdf?x=1')).toBe(false); // $ ancora no fim do caminho+query
    expect(matchesPattern('/*.pdf$', '/docs/a.pdfx')).toBe(false);
    expect(matchesPattern('/fish', '/fish.html')).toBe(true); // prefixo
    expect(matchesPattern('/fish*', '/fish')).toBe(true);
    expect(matchesPattern('/a.b', '/axb')).toBe(false); // '.' é literal
    expect(matchesPattern('/q?x=*', '/q?x=1&y=2')).toBe(true);
    const robots = 'User-agent: *\nDisallow: /*/privado\nDisallow: /*.pdf$\n';
    expect(dec(robots, '/a/privado/z').allowed).toBe(false);
    expect(dec(robots, '/docs/a.pdf').allowed).toBe(false);
    expect(dec(robots, '/docs/a.pdf?download=1').allowed).toBe(true);
    expect(dec(robots, '/noticias/').allowed).toBe(true);
  });

  it('vence a regra mais longa; empate favorece Allow; Disallow vazio permite tudo', () => {
    const r = 'User-agent: *\nDisallow: /p\nAllow: /p/ok\n';
    expect(dec(r, '/p/ok/x').allowed).toBe(true);
    expect(dec(r, '/p/no').allowed).toBe(false);
    expect(dec('User-agent: *\nDisallow: /x\nAllow: /x\n', '/x').allowed).toBe(true);
    expect(dec('User-agent: *\nDisallow:\n', '/qualquer').allowed).toBe(true);
    expect(dec('User-agent: *\nDisallow: /\n', '/qualquer').allowed).toBe(false);
  });

  it('grupos: agente específico vence o *; linhas de agente consecutivas dividem as regras; grupos do mesmo agente se somam', () => {
    const r = [
      'User-agent: *', 'Disallow: /', '',
      'User-agent: loyaltynewssourceverifier', 'User-agent: outrobot', 'Disallow: /privado', '',
      'User-agent: LoyaltyNewsSourceVerifier', 'Disallow: /interno',
    ].join('\n');
    expect(dec(r, '/noticias').allowed).toBe(true); // o grupo específico substitui o '*' (que bloquearia tudo)
    expect(dec(r, '/privado/a').allowed).toBe(false);
    expect(dec(r, '/interno').allowed).toBe(false); // segundo grupo do mesmo agente soma
    expect(dec(r, '/noticias', 'OutroRobo/1.0').allowed).toBe(false); // cai no '*'
    expect(dec(r, '/privado', 'outrobot/2').allowed).toBe(false);
  });

  it('comentários, caixa e regras antes do primeiro User-agent; sitemaps coletados', () => {
    const r = 'Disallow: /ignorada\n# comentário\nUSER-AGENT: *   # todos\nDISALLOW: /x # só x\nSitemap: https://e.invalid/s1.xml\nsitemap: https://e.invalid/s2.xml';
    const p = parseRobots(r);
    expect(p.sitemaps).toEqual(['https://e.invalid/s1.xml', 'https://e.invalid/s2.xml']);
    expect(robotsDecision(p, UA, '/ignorada').allowed).toBe(true);
    expect(robotsDecision(p, UA, '/x').allowed).toBe(false);
  });

  it('robotsAllows decide pelo caminho da URL e trata ausência e erro com precaução', async () => {
    const make = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;
    const rules = 'User-agent: *\nDisallow: /*/privado\nDisallow: /*.pdf$\nAllow: /publico/\n';
    expect(await robotsAllows('https://h.invalid/a/privado/x', make(200, rules))).toMatchObject({ allowed: false });
    expect((await robotsAllows('https://h.invalid/a/privado/x', make(200, rules))).note).toContain('Disallow: /*/privado');
    expect((await robotsAllows('https://h.invalid/doc.pdf', make(200, rules))).allowed).toBe(false);
    expect((await robotsAllows('https://h.invalid/noticias', make(200, rules))).allowed).toBe(true);
    expect((await robotsAllows('https://h.invalid/x', make(404))).allowed).toBe(true);
    expect((await robotsAllows('https://h.invalid/x', make(500))).allowed).toBe(false); // precaução
    expect((await robotsAllows('https://h.invalid/x', make(403))).allowed).toBe(false);
    const boom = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await robotsAllows('https://h.invalid/x', boom)).toMatchObject({ allowed: false });
  });
});

describe('página de desafio / CAPTCHA / bloqueio, inclusive com HTTP 200', () => {
  it('título de desafio com página LONGA (≥ 1.500 caracteres) continua sendo bloqueio', () => {
    const html = page('Just a moment...', `<p>${filler(4000)}</p>`);
    const text = filler(4000);
    expect(detectChallenge({ status: 200, html, text })).toMatch(/título/);
    expect(classifyResponse({ status: 200, html, text }).estado).toBe('bloqueada_desafio');
  });

  it('cabeçalho cf-mitigated, marcadores fortes e frase de verificação humana, em página longa', () => {
    expect(detectChallenge({ status: 200, headers: { 'CF-Mitigated': 'challenge' }, html: page('x', filler(3000)), text: filler(3000) })).toMatch(/cf-mitigated/);
    expect(detectChallenge({ status: 200, html: page('Loja', `<script src="https://geo.captcha-delivery.com/captcha/?x=1"></script>${filler(3000)}`), text: filler(3000) })).toMatch(/marcador/);
    expect(detectChallenge({ status: 200, html: page('Portal', `<form id="challenge-form" action="/cdn-cgi/l/chk_jschl">${filler(3000)}</form>`), text: filler(3000) })).toMatch(/marcador/);
    expect(detectChallenge({ status: 200, html: page('Portal', `<script src="/_Incapsula_Resource?SWJIYLWA=1"></script>`), text: filler(3000) })).toMatch(/marcador/);
    expect(detectChallenge({ status: 200, html: page('Portal', filler(3000)), text: `${filler(3000)} Please verify you are human to continue.` })).toMatch(/frase/);
    expect(detectChallenge({ status: 200, html: page('Portal', filler(3000)), text: `${filler(3000)} Confirme que você é humano para continuar.` })).toMatch(/frase/);
  });

  it('widget de captcha: bloqueia em página curta, mas NÃO em página longa legítima (formulário de contato com reCAPTCHA)', () => {
    const widget = '<div class="g-recaptcha" data-sitekey="k"></div>';
    expect(detectChallenge({ status: 200, html: page('Verificação', widget), text: 'Verificação' })).toMatch(/captcha/); // vazia: desafio
    const curtaComVerificacao = 'Verificação de segurança: confirme que não é um robô para acessar o site. '.repeat(8);
    expect(detectChallenge({ status: 200, html: page('Acesso', widget), text: curtaComVerificacao })).toMatch(/captcha/); // curta e fala em verificação
    // página CURTA com conteúdo real (menu e texto de RI/site de programa) e captcha de formulário: NÃO é desafio
    const conteudoReal = 'Relações com Investidores Governança Corporativa Divulgação de Resultados Informações Financeiras Serviços aos Investidores Comunicados e Fatos Relevantes Calendário de Eventos Contato '.repeat(5);
    expect(conteudoReal.length).toBeGreaterThan(400);
    expect(conteudoReal.length).toBeLessThan(1500);
    expect(detectChallenge({ status: 200, html: page('RI', widget + conteudoReal), text: conteudoReal })).toBeNull();
    expect(detectChallenge({ status: 200, html: page('Contato', `<form>${widget}</form>${filler(4000)}`), text: filler(4000) })).toBeNull();
  });

  it('página normal e script padrão de gestão de bots da Cloudflare (jsd) não são desafio', () => {
    const html = page('Relações com Investidores', `<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><p>${filler(3000)}</p>`);
    expect(detectChallenge({ status: 200, html, text: filler(3000) })).toBeNull();
    expect(classifyResponse({ status: 200, html, text: filler(3000) }).estado).toBe('ok');
  });

  it('classifyResponse: 3xx, 403, 429 e demais status', () => {
    expect(classifyResponse({ status: 301 }).estado).toBe('redirecionada');
    expect(classifyResponse({ status: 302 }).estado).toBe('redirecionada');
    expect(classifyResponse({ status: 403 }).estado).toBe('bloqueada_http');
    expect(classifyResponse({ status: 429 }).estado).toBe('bloqueada_http');
    expect(classifyResponse({ status: 404 }).estado).toBe('indisponivel');
    expect(classifyResponse({ status: 503 }).estado).toBe('indisponivel');
  });
});

describe('fetchText: uma requisição, sem seguir redirecionamento', () => {
  it('redirecionamento (inclusive para OUTRO host) é registrado e NÃO seguido', async () => {
    const calls: { url: string; redirect?: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, redirect: init?.redirect as string });
      return resp(301, '', { location: 'https://outro-host.invalid/ri/' });
    }) as unknown as typeof fetch;
    const f = await fetchText('https://origem.invalid/ri', fake);
    expect(calls).toEqual([{ url: 'https://origem.invalid/ri', redirect: 'manual' }]); // 1 chamada, modo manual
    expect(f).toMatchObject({ status: 301, estado: 'redirecionada', location: 'https://outro-host.invalid/ri/', finalUrl: 'https://origem.invalid/ri', text: '' });
  });

  it('Location relativa é resolvida; 200 normal, 403 e desafio com 200 são classificados sem repetir a requisição', async () => {
    const one = (r: Response) => ({ f: vi.fn(async () => r) as unknown as typeof fetch });
    expect((await fetchText('https://a.invalid/x/y', one(resp(302, '', { location: '/novo' })).f)).location).toBe('https://a.invalid/novo');

    const ok = one(resp(200, page('Página', `<p>${filler(2000)}</p>`)));
    expect((await fetchText('https://a.invalid/', ok.f)).estado).toBe('ok');

    const forbidden = one(resp(403, 'Forbidden'));
    expect((await fetchText('https://a.invalid/', forbidden.f)).estado).toBe('bloqueada_http');
    expect(forbidden.f).toHaveBeenCalledTimes(1);

    const challenge = one(resp(200, page('Just a moment...', `<p>${filler(5000)}</p>`)));
    const c = await fetchText('https://a.invalid/', challenge.f);
    expect(c.status).toBe(200);
    expect(c.estado).toBe('bloqueada_desafio');
    expect(challenge.f).toHaveBeenCalledTimes(1);
  });
});

describe('sonda de fonte (respostas simuladas)', () => {
  const src = { id: 'x', nome: 'Fonte X', url: 'https://origem.invalid/ri', tipo: 'ri' };
  const mk = (over: { robots?: { allowed: boolean; note: string }; response?: Response } = {}) => {
    const robots = vi.fn(async () => ({ ...(over.robots ?? { allowed: true, note: 'robots.txt permite' }), sitemaps: [] as string[] }));
    const fetchFn = vi.fn(async (u: string) => {
      const real = await fetchText(u, (async () => over.response ?? resp(200, page('Fonte X', `<p>${filler(2500)}</p>`))) as unknown as typeof fetch);
      return real;
    });
    return { robots, fetchFn, deps: { robotsAllows: robots, fetchText: fetchFn, sleep: async () => undefined } };
  };

  it('redirecionamento para outro host: estado "redirecionada", destino anotado, UMA busca e robots só da candidata', async () => {
    const t = mk({ response: resp(301, '', { location: 'https://outro-host.invalid/ri/' }) });
    const r = await sonda(src, t.deps);
    expect(r).toMatchObject({ estado: 'redirecionada', http_status: 301, redireciona_para: 'https://outro-host.invalid/ri/', texto_caracteres: 0 });
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
    expect(t.robots).toHaveBeenCalledTimes(1);
    expect(t.robots).toHaveBeenCalledWith('https://origem.invalid/ri');
  });

  it('desafio com HTTP 200 NÃO sai como acessível', async () => {
    const t = mk({ response: resp(200, page('Just a moment...', `<p>${filler(4000)}</p>`)) });
    const r = await sonda(src, t.deps);
    expect(r.estado).toBe('bloqueada_desafio');
    expect(r.estado).not.toMatch(/^acessivel/);
  });

  it('403 = bloqueada_http (sem nova tentativa); 200 normal = acessível estática; texto curto = requer navegador', async () => {
    const forbidden = mk({ response: resp(403, 'x') });
    expect((await sonda(src, forbidden.deps)).estado).toBe('bloqueada_http');
    expect(forbidden.fetchFn).toHaveBeenCalledTimes(1);
    expect((await sonda(src, mk().deps)).estado).toBe('acessivel');
    expect((await sonda(src, mk({ response: resp(200, page('Casca', '<div id="app"></div>')) }).deps)).estado).toBe('acessivel_requer_navegador');
  });

  it('robots proíbe (com curinga) ou ilegível: a página NÃO é buscada', async () => {
    const proibe = mk({ robots: { allowed: false, note: 'robots.txt proibe (Disallow: /*/ri)' } });
    expect((await sonda(src, proibe.deps)).estado).toBe('bloqueada_por_robots');
    expect(proibe.fetchFn).not.toHaveBeenCalled();
    const ilegivel = mk({ robots: { allowed: false, note: 'robots.txt inacessivel (TypeError); por precaucao nao busca' } });
    expect((await sonda(src, ilegivel.deps)).estado).toBe('robots_inacessivel_nao_buscada');
    expect(ilegivel.fetchFn).not.toHaveBeenCalled();
  });

  it('fonte de classe C não é sondada (nem robots, nem página)', async () => {
    const t = mk();
    const r = await sonda({ ...src, url: 'https://www.voeazul.com.br/' }, t.deps);
    expect(r.estado).toBe('nao_sondada_classe_c');
    expect(t.robots).not.toHaveBeenCalled();
    expect(t.fetchFn).not.toHaveBeenCalled();
  });
});
