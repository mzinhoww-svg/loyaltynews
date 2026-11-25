import { describe, expect, it } from 'vitest';
import { auditarIndexacao, locsDoSitemap, robotsBloqueiaTudo, sitemapsDoRobots, type RespostaIndexacao } from './preflight-indexacao';

const BASE = 'https://www.loyaltynews.com.br';
const robotsAberto = `User-agent: *\nAllow: /\nDisallow: /busca\n\nSitemap: ${BASE}/sitemap.xml\n`;
const sitemapOk = `<?xml version="1.0"?><urlset><url><loc>${BASE}/</loc></url><url><loc>${BASE}/intelligence/empresas</loc></url></urlset>`;

const htmlOk = (url: string) =>
  `<html><head><link rel="canonical" href="${url}"/><meta name="robots" content="index, follow"/></head><body></body></html>`;

const foto = (over: Partial<RespostaIndexacao> = {}): RespostaIndexacao => ({
  robots: robotsAberto,
  sitemap: sitemapOk,
  paginas: [{ url: `${BASE}/`, html: htmlOk(`${BASE}/`) }],
  ...over,
});

describe('pré-voo de indexação', () => {
  it('site coerente: sitemap com URLs no domínio, canonical auto-referente, robots aberto e sem noindex', () => {
    expect(auditarIndexacao(BASE, foto())).toEqual([]);
  });

  it('etapa A: aceita noindex e robots fechados com sitemap e canonical já corretos; a mesma foto reprova na etapa B', () => {
    const a = foto({ robots: 'User-agent: *\nDisallow: /\n', paginas: [{ url: `${BASE}/`, html: `<link rel="canonical" href="${BASE}/"/><meta name="robots" content="noindex, nofollow">` }] });
    expect(auditarIndexacao(BASE, a, { etapaA: true })).toEqual([]);
    const b = auditarIndexacao(BASE, a);
    expect(b.map((p) => p.regra)).toEqual(expect.arrayContaining(['robots', 'noindex']));
    // Sitemap vazio continua reprovando até na etapa A: é o que a etapa A existe para provar.
    expect(auditarIndexacao(BASE, { ...a, sitemap: '<urlset></urlset>' }, { etapaA: true }).some((p) => p.regra === 'sitemap')).toBe(true);
  });

  it('reprova o estado do release 1 (robots fechado, sitemap vazio, canonical no staging)', () => {
    const problemas = auditarIndexacao(
      BASE,
      foto({
        robots: 'User-agent: *\nDisallow: /\n',
        sitemap: '<?xml version="1.0"?><urlset></urlset>',
        paginas: [{ url: `${BASE}/`, html: `<link rel="canonical" href="https://loyaltynews.vertraweb.app/"/><meta name="robots" content="noindex, nofollow">` }],
      }),
    );
    expect(problemas.map((p) => p.regra)).toEqual(expect.arrayContaining(['robots', 'sitemap', 'canonical', 'noindex']));
    expect(problemas.some((p) => p.mensagem.includes('sitemap.xml está vazio'))).toBe(true);
  });

  it('reprova sitemap apontando para o staging mesmo com o resto certo', () => {
    const problemas = auditarIndexacao(BASE, foto({ sitemap: `<urlset><url><loc>https://loyaltynews.vertraweb.app/</loc></url></urlset>` }));
    expect(problemas.some((p) => p.regra === 'sitemap' && p.mensagem.includes('fora do domínio'))).toBe(true);
  });

  it('reprova canonical ausente e canonical para a home', () => {
    const semCanonical = auditarIndexacao(BASE, foto({ paginas: [{ url: `${BASE}/sobre`, html: '<html><head></head></html>' }] }));
    expect(semCanonical.some((p) => p.mensagem.includes('esperado 1 canonical, encontrado 0'))).toBe(true);

    const paraHome = auditarIndexacao(BASE, foto({ paginas: [{ url: `${BASE}/sobre`, html: htmlOk(`${BASE}/`) }] }));
    expect(paraHome.some((p) => p.regra === 'canonical' && p.mensagem.includes('em vez de si mesma'))).toBe(true);
  });

  it('exige Sitemap: no robots', () => {
    const problemas = auditarIndexacao(BASE, foto({ robots: 'User-agent: *\nAllow: /\n' }));
    expect(problemas.some((p) => p.regra === 'robots' && p.mensagem.includes('Sitemap'))).toBe(true);
  });

  it('lê <loc>, Sitemap: e Disallow: / nas formas usuais', () => {
    expect(locsDoSitemap(sitemapOk)).toHaveLength(2);
    expect(sitemapsDoRobots(robotsAberto)).toEqual([`${BASE}/sitemap.xml`]);
    expect(robotsBloqueiaTudo('User-agent: *\nDISALLOW:/')).toBe(true);
    expect(robotsBloqueiaTudo(robotsAberto)).toBe(false);
  });
});
