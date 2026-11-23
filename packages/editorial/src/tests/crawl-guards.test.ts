// Cópia dos testes das guardas de crawl do Data (ft/intelligence 79e6c52, scripts/crawl-guards.mjs): os mesmos casos de robots.txt
// (RFC 9309, normalização, grupo por token de produto) e de desafio, rodando contra a cópia usada pelo coletor.
import { describe, it, expect } from 'vitest';
import { agentToken, classifyResponse, detectChallenge, matchesPattern, normalizePath, parseRobots, productToken, robotsDecision } from '../collector/crawl-guards.mjs';

const UA = 'LoyaltyNewsSourceVerifier/1.0 (verificacao pontual de fonte publica; sem coleta em massa)';
const filler = (n: number) => 'Texto de uma página qualquer com conteúdo legítimo. '.repeat(Math.ceil(n / 50)).slice(0, n);
const page = (title: string, body: string, extraHead = '') => `<html><head><title>${title}</title>${extraHead}</head><body>${body}</body></html>`;

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

describe('robots.txt — RFC 9309 §2.2.2: normalização de caminhos percent-encoded', () => {



  it('%XX de caractere NÃO reservado é decodificado (hex em qualquer caixa); regra e URL comparadas na mesma forma', () => {
    expect(matchesPattern('/%7Efoo', '/~foo')).toBe(true);
    expect(matchesPattern('/~foo', '/%7Efoo')).toBe(true);
    expect(matchesPattern('/%7efoo', '/~foo')).toBe(true); // hex minúsculo
    expect(matchesPattern('/%41bc', '/Abc')).toBe(true); // %41 = 'A' (não reservado)
    expect(matchesPattern('/%7Efoo', '/~bar')).toBe(false);
    expect(matchesPattern('/*%7Efoo$', '/x/y/~foo')).toBe(true); // curinga e âncora convivem com a normalização
  });
  it('caracteres fora do ASCII equivalem aos octetos UTF-8 percent-encoded, nos dois sentidos', () => {
    expect(matchesPattern('/ツ', '/%E3%83%84')).toBe(true);
    expect(matchesPattern('/%E3%83%84', '/ツ')).toBe(true);
    expect(matchesPattern('/%e3%83%84', '/ツ')).toBe(true);
    expect(matchesPattern('/ação', '/a%C3%A7%C3%A3o')).toBe(true);
    expect(matchesPattern('/a%C3%A7%C3%A3o/', '/ação/x')).toBe(true);
    expect(matchesPattern('/ação', '/acao')).toBe(false);
  });
  it('%XX de caractere RESERVADO permanece codificado: /foo%2Fbar NÃO é /foo/bar (mas %2f e %2F são o mesmo)', () => {
    expect(matchesPattern('/foo%2Fbar', '/foo/bar')).toBe(false);
    expect(matchesPattern('/foo/bar', '/foo%2Fbar')).toBe(false);
    expect(matchesPattern('/foo%2fbar', '/foo%2Fbar')).toBe(true);
    expect(matchesPattern('/a%3Fb', '/a?b')).toBe(false);
    expect(normalizePath('/a%2fb/%7e/ç/%41')).toBe('/a%2Fb/~/%C3%A7/A');
  });
});

describe('robots.txt — grupo do agente: token de produto, sem diferenciar maiúsculas, nunca a string inteira do UA', () => {
  const dec = (robots: string, path = '/noticias', ua = UA) => robotsDecision(parseRobots(robots), ua, path);




  it('o token de produto do nosso UA é só o nome do agente', () => {
    expect(productToken(UA)).toBe('loyaltynewssourceverifier');
    expect(agentToken('LoyaltyNewsSourceVerifier/1.0 (qualquer comentário)')).toBe('loyaltynewssourceverifier');
    expect(agentToken(' LOYALTYNEWSSOURCEVERIFIER ')).toBe('loyaltynewssourceverifier');
  });
  it('substring ou prefixo do token, e palavras do restante da string do UA, NÃO formam grupo específico', () => {
    for (const nome of ['verifier', 'loyaltynews', 'source', 'news', 'sem', 'coleta', 'massa', 'pontual', 'bot', 'loyaltynewssourceverifier2']) {
      const r = `User-agent: ${nome}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`;
      const d = dec(r);
      expect(d, nome).toMatchObject({ allowed: true, group: '*' }); // caiu no grupo '*', como manda o RFC
    }
  });
  it('o token exato do agente (qualquer caixa, com ou sem versão) forma o grupo específico e substitui o *', () => {
    for (const nome of ['LoyaltyNewsSourceVerifier', 'LOYALTYNEWSSOURCEVERIFIER', 'loyaltynewssourceverifier/1.0', 'LoyaltyNewsSourceVerifier/1.0 (verificacao pontual de fonte publica)']) {
      const r = `User-agent: *\nAllow: /\n\nUser-agent: ${nome}\nDisallow: /noticias\n`;
      expect(dec(r), nome).toMatchObject({ allowed: false, group: 'specific' });
    }
    // grupo específico sem regra que case: vale só ele (o '*' que bloquearia tudo é ignorado)
    expect(dec('User-agent: *\nDisallow: /\n\nUser-agent: LoyaltyNewsSourceVerifier\nDisallow: /privado\n')).toMatchObject({ allowed: true, group: 'specific' });
  });
  it('um grupo "*" continua valendo quando nenhum grupo traz o nosso token', () => {
    expect(dec('User-agent: *\nDisallow: /noticias\n')).toMatchObject({ allowed: false, group: '*' });
    expect(dec('User-agent: outrobot\nDisallow: /\n')).toMatchObject({ allowed: true, group: 'none' });
  });
});
