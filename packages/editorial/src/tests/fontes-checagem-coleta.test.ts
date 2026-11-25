import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '../sources/seed';
import { eligibility } from '../sources/registry';
import { SITEMAP_MAX_PAGES_PER_RUN } from '../collector/collector';
import type { Source } from '../types';

// Checagem de coleta das 93 habilitadas (25/11/2026): feed/sitemap cadastrados onde existem, motivo registrado onde não existem,
// feeds parados e URLs de Itaú RI e ICO corrigidas. O coletor só aceita URLs do host da fonte (e do prefixo dela, quando há).
const by = new Map(SEED_SOURCES.map((s) => [s.id, s]));
const get = (id: string): Source => { const s = by.get(id); if (!s) throw new Error(`fonte ${id} não está no seed`); return s; };
const notes = (id: string) => get(id).verification?.notes ?? '';
const MARCA = 'Checagem de coleta 25/11/2026 (Editorial)';

describe('feeds e sitemaps cadastrados na checagem de 25/11/2026', () => {
  const feeds: Array<[string, string]> = [
    ['abav', 'https://abav.com.br/blog/feed/'],
    ['edpb', 'https://www.edpb.europa.eu/rss.xml_en'],
  ];
  const sitemaps: Array<[string, string, string]> = [
    ['anatel', 'https://www.gov.br/anatel/sitemap-index.xml', '/anatel/pt-br/assuntos/noticias/'],
    ['mtur', 'https://www.gov.br/turismo/sitemap-index.xml', '/turismo/pt-br/assuntos/noticias/'],
    ['dinheirama', 'https://investimentos.com.br/sitemap-artigos.xml', '/artigos/'],
    ['idv', 'https://www.idv.org.br/sitemap_index.xml', '/noticia/'],
    ['nubank-newsroom', 'https://nu.com/sitemap/institutional.xml', '/pt/sala-de-imprensa/'],
    ['guia-bolso-blog', 'https://meubolsoemdia.com.br/sitemap.xml', '/Materias/'],
    ['one-mile-at-a-time', 'https://onemileatatime.com/news-sitemap.xml', '/news/'],
    ['accor-newsroom', 'https://group.accor.com/api/sitemap', '/en/news-stories/'],
  ];

  it('os 2 feeds novos: https, no host da fonte, com a contagem e a data lidas anotadas', () => {
    for (const [id, url] of feeds) {
      const s = get(id);
      expect(s.feedUrl, id).toBe(url);
      expect(new URL(url).protocol).toBe('https:'); expect(new URL(url).host, id).toBe(s.host);
      expect(notes(id), id).toContain(MARCA); expect(notes(id), id).toMatch(/\d+ itens/);
    }
  });

  it('os 8 sitemaps novos: https, no host da fonte, dentro do pathPrefix da fonte e com prefixo de notícias definido', () => {
    for (const [id, url, prefixo] of sitemaps) {
      const s = get(id);
      expect(s.sitemapUrl, id).toBe(url); expect(s.sitemapPathPrefix, id).toBe(prefixo);
      const u = new URL(url);
      expect(u.protocol).toBe('https:'); expect(u.host, `${id}: sitemap no host da fonte`).toBe(s.host);
      expect(prefixo.startsWith('/') && prefixo.endsWith('/'), id).toBe(true);
      if (s.pathPrefix) { expect(u.pathname.startsWith(s.pathPrefix), `${id}: sitemap dentro do pathPrefix`).toBe(true); expect(prefixo.startsWith(s.pathPrefix)).toBe(true); }
      expect(s.feedUrl, `${id}: sitemap só entra quando não há feed`).toBeNull();
      expect(notes(id), id).toContain(MARCA);
    }
  });

  it('limite por hora das fontes novas cobre a rodada (robots + sitemap + filhos lidos + 5 páginas); com 6 a 5ª página sairia em rate_limited', () => {
    const PAGINAS = SITEMAP_MAX_PAGES_PER_RUN;
    const filhos: Record<string, number> = { dinheirama: 0, 'guia-bolso-blog': 0, 'nubank-newsroom': 0, 'one-mile-at-a-time': 0, 'accor-newsroom': 0, idv: 2 }; // filhos lidos por rodada (idv: os 2 mais recentes do índice com lastmod)
    for (const [id, k] of Object.entries(filhos)) {
      const s = get(id);
      expect(SEED_SOURCES.filter((x) => x.host === s.host).map((x) => x.id), `${id}: único no host`).toEqual([id]);
      expect(s.maxRequestsPerHour, id).toBeGreaterThanOrEqual(1 + 1 + k + PAGINAS);
    }
  });

  it('Meu Bolso em Dia: o host passou para o domínio sem www, que é onde o site e o sitemap respondem', () => {
    const s = get('guia-bolso-blog');
    expect(s.host).toBe('meubolsoemdia.com.br');
    expect(new URL(s.listingUrl!).host).toBe(s.host); expect(new URL(s.sitemapUrl!).host).toBe(s.host);
    expect(notes('guia-bolso-blog')).toMatch(/sem www/);
  });

  it('Nubank: o pathPrefix da fonte deixou de ser /en/newsroom (o sitemap fica em /sitemap/ e seria recusado); as páginas seguem limitadas ao prefixo do sitemap', () => {
    const s = get('nubank-newsroom');
    expect(s.pathPrefix).toBeNull(); expect(s.sitemapPathPrefix).toBe('/pt/sala-de-imprensa/');
    expect(notes('nubank-newsroom')).toMatch(/pathPrefix da fonte passou de \/en\/newsroom para null/);
  });

  it('Dinheirama usa o sitemap de artigos direto, não o índice (o índice tem lastmod e o coletor leria só páginas e simuladores)', () => {
    expect(get('dinheirama').sitemapUrl).not.toMatch(/sitemap-index/);
    expect(notes('dinheirama')).toMatch(/índice tem lastmod/);
  });
});

describe('fontes sem feed nem sitemap utilizável: o motivo fica registrado e nada é inventado', () => {
  const semFeed = ['abecs', 'abras', 'administradores', 'azul-ri', 'bb-ri', 'gol-ri', 'febraban', 'magalu-ri', 'mcti', 'senacon', 'oneworld', 'zendesk-newsroom'];
  it('12 fontes seguem só com listagem e cada uma diz por quê', () => {
    for (const id of semFeed) {
      const s = get(id);
      expect(s.feedUrl, id).toBeNull(); expect(s.sitemapUrl ?? null, id).toBeNull();
      expect(notes(id), id).toContain(MARCA);
    }
  });
  it('as 3 de programas (Dotz, Km de Vantagens, Premmia) já tinham o motivo registrado e não mudam', () => {
    for (const id of ['dotz-site', 'km-de-vantagens', 'petrobras-premmia']) { expect(get(id).feedUrl, id).toBeNull(); expect(get(id).verification?.notes ?? '', id).toMatch(/NÃO coletável hoje/); }
  });
  it('Febraban segue fora: sitemap sem lastmod e páginas que são casca de aplicação, e o Accor registra por que usa a exclusão', () => {
    expect(notes('accor-newsroom')).toMatch(/sitemapPathExclude/);
    expect(notes('febraban')).toMatch(/sem lastmod/); expect(notes('febraban')).toMatch(/casca de aplicação/);
    expect(notes('mcti')).toMatch(/404/); expect(notes('senacon')).toMatch(/403/);
  });
});

describe('feeds parados e ANPD: URL nova procurada, o que não há é dito', () => {
  it('ABEMF, A4A e Million Mile Secrets: sem URL nova; baixa frequência, e MMS inativa desde 2024', () => {
    for (const id of ['abemf', 'a4a']) { expect(notes(id), id).toMatch(/não há URL nova/); expect(notes(id), id).toMatch(/baixa frequência/); }
    expect(notes('million-mile-secrets')).toMatch(/parou de publicar em 2024/);
  });
  it('RD Station, Wise Marketer e One Mile at a Time: a checagem leu o filho errado do índice; a fonte está ativa', () => {
    for (const id of ['rd-station-blog', 'wise-marketer', 'one-mile-at-a-time']) expect(notes(id), id).toMatch(/checagem/);
    expect(notes('rd-station-blog')).toMatch(/25\/11\/2026/); expect(notes('wise-marketer')).toMatch(/24\/11\/2026/);
  });
  it('ANPD: o "sem itens" veio do jeito de ler o índice; o que se conferiu (e o que não) está dito', () => {
    expect(notes('anpd')).toMatch(/1\.395 e 54 URLs/); expect(notes('anpd')).toMatch(/não conferi com o coletor real/);
  });
});

describe('Itaú RI e ICO: URL de listagem corrigida; seguem inacessíveis e desabilitados', () => {
  it('Itaú RI aponta a página de RI do próprio itau.com.br; o 403 não foi contornado', () => {
    const s = get('itau-ri');
    expect(s.listingUrl).toBe('https://www.itau.com.br/relacoes-com-investidores/');
    expect(new URL(s.listingUrl!).host).toBe(s.host);
    expect(s.feedUrl).toBeNull(); expect(s.enabled).toBe(false); expect(s.urlVerified).toBe(false);
    expect(s.verification?.level).toBe('inacessivel');
    expect(notes('itau-ri')).toMatch(/403/); expect(notes('itau-ri')).toMatch(/nada foi contornado/);
    expect(eligibility(s).ok).toBe(false);
  });
  it('ICO aponta a página de notícias; o feed que o ICO declara fica só na nota, não em feedUrl (não foi conferido)', () => {
    const s = get('ico-uk');
    expect(s.listingUrl).toBe('https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/');
    expect(new URL(s.listingUrl!).host).toBe(s.host);
    expect(s.feedUrl).toBeNull(); expect(s.enabled).toBe(false); expect(s.urlVerified).toBe(false);
    expect(s.verification?.level).toBe('inacessivel');
    expect(notes('ico-uk')).toMatch(/rss-feeds\/news-and-blogs/); expect(notes('ico-uk')).toMatch(/NÃO cadastrado como feedUrl/);
    expect(eligibility(s).ok).toBe(false);
  });
});

describe('invariante do cadastro inteiro: listagem, feed e sitemap ficam no host da fonte', () => {
  it('nenhuma URL cadastrada sai do host da fonte (o coletor recusaria)', () => {
    for (const s of SEED_SOURCES) for (const [campo, url] of [['listingUrl', s.listingUrl], ['feedUrl', s.feedUrl], ['sitemapUrl', s.sitemapUrl]] as const) {
      if (!url) continue;
      expect(new URL(url).host, `${s.id}.${campo}`).toBe(s.host);
    }
  });
});
