import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEWS_JANELA_MS, NEWS_MAX, newsSitemapXml, noticiasRecentes, type NewsItem } from '../app/(portal)/_lib/news-sitemap';
import { robotsTxt } from '../app/(portal)/_lib/indexing';
import { OG_EDITORIA_ASSETS, OG_PADRAO_URL, ROBOTS_INDEXAVEL, breadcrumbLd, canonicalPaginado, descricaoPaginada, ogImagemDaEditoria, paginaDe, PUBLISHER_LD, tituloPaginado } from '../app/(portal)/_lib/seo';
import { EDITORIAS } from '../app/(portal)/_lib/editorias';

const AGORA = new Date('2026-12-05T12:00:00-03:00');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();
const item = (slug: string, h: number, titulo = `Título ${slug}`): NewsItem => ({ slug, titulo, publicadoEm: horasAtras(h) });

describe('news-sitemap (Google Notícias)', () => {
  it('só entram matérias das últimas 48 h, da mais nova para a mais antiga; futuras e datas inválidas ficam de fora', () => {
    const r = noticiasRecentes([item('antiga', 49), item('nova', 1), item('meio', 30), { slug: 'futura', titulo: 'x', publicadoEm: horasAtras(-5) }, { slug: 'ruim', titulo: 'x', publicadoEm: 'ontem' }, item('limite', 48)], AGORA);
    expect(r.map((i) => i.slug)).toEqual(['nova', 'meio', 'limite']);
    expect(NEWS_JANELA_MS).toBe(48 * 3_600_000);
  });

  it('no máximo 1000 itens', () => {
    const muitos = Array.from({ length: NEWS_MAX + 50 }, (_, i) => item(`m${i}`, 1));
    expect(noticiasRecentes(muitos, AGORA)).toHaveLength(NEWS_MAX);
  });

  it('XML válido com as tags news: obrigatórias (publicação, idioma pt, data ISO e título) e domínio do release', () => {
    const xml = newsSitemapXml([item('a-b', 2, 'Título')], 'https://www.loyaltynews.com.br', 'Loyalty News', AGORA);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain('<loc>https://www.loyaltynews.com.br/noticia/a-b</loc>');
    expect(xml).toContain('<news:name>Loyalty News</news:name>');
    expect(xml).toContain('<news:language>pt</news:language>');
    expect(xml).toContain(`<news:publication_date>${new Date(horasAtras(2)).toISOString()}</news:publication_date>`);
    expect(xml).toContain('<news:title>Título</news:title>');
  });

  it('escapa XML (&, <, >, aspas) no título e no slug; nunca deixa um "</news:title>" falso passar', () => {
    const xml = newsSitemapXml([item('x', 1, 'Bancos & "cartões" <b>e</b> </news:title><x>')], 'https://s.test', 'L&N', AGORA);
    expect(xml).toContain('<news:title>Bancos &amp; &quot;cartões&quot; &lt;b&gt;e&lt;/b&gt; &lt;/news:title&gt;&lt;x&gt;</news:title>');
    expect(xml).toContain('<news:name>L&amp;N</news:name>');
    expect((xml.match(/<news:title>/g) ?? []).length).toBe(1);
  });

  it('sem itens gera um urlset válido e vazio (ambiente não indexável ou sem matérias recentes)', () => {
    const xml = newsSitemapXml([], 'https://s.test', 'L', AGORA);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
    expect(xml).not.toContain('<url>');
  });
});

describe('robots.txt', () => {
  it('liberado: Allow, bloqueios de busca/studio/api e os DOIS sitemaps (sitemap.xml e news-sitemap.xml) no domínio do release', () => {
    const t = robotsTxt(false, 'https://www.loyaltynews.com.br');
    expect(t).toContain('Allow: /');
    expect(t).toContain('Disallow: /busca'); // cobre também /busca/sugestoes
    expect(t).toContain('Sitemap: https://www.loyaltynews.com.br/sitemap.xml');
    expect(t).toContain('Sitemap: https://www.loyaltynews.com.br/news-sitemap.xml');
  });
  it('bloqueado (staging, produção sem o interruptor): Disallow: / e nenhum sitemap', () => {
    expect(robotsTxt(true, 'https://x.test')).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('og:image por editoria', () => {
  it('toda editoria tem o seu PNG do pacote de marca (1200×630, arquivo existente) e alt próprio', () => {
    const alts = new Set<string>();
    for (const e of EDITORIAS) {
      const i = ogImagemDaEditoria(e.slug);
      expect(i.url).toBe(`/og/editoria-${e.slug}.png`);
      expect([i.width, i.height]).toEqual([1200, 630]);
      expect(existsSync(resolve(__dirname, '..', 'public', i.url.slice(1))), `${i.url} existe em public/`).toBe(true);
      expect(i.alt).toContain(e.name);
      alts.add(i.alt);
    }
    expect(Object.keys(OG_EDITORIA_ASSETS)).toHaveLength(EDITORIAS.length);
    expect(alts.size).toBe(EDITORIAS.length); // um alt por editoria
  });
  it('slug sem asset cai no padrão (1200×630, arquivo existente) sem lançar', () => {
    expect(ogImagemDaEditoria('nao-existe')).toMatchObject({ url: OG_PADRAO_URL, alt: 'Loyalty News', width: 1200, height: 630 });
    expect(OG_PADRAO_URL).toBe('/og/padrao.png');
    expect(existsSync(resolve(__dirname, '..', 'public', 'og', 'padrao.png'))).toBe(true);
  });
  it('o logo do Organization é o ícone QUADRADO da marca (512×512), nunca o banner de compartilhamento', () => {
    expect(PUBLISHER_LD.logo.url).toMatch(/\/brand\/icon-512\.png$/);
    expect([PUBLISHER_LD.logo.width, PUBLISHER_LD.logo.height]).toEqual([512, 512]);
    expect(PUBLISHER_LD.logo.url).not.toContain('/og/');
  });
});

describe('paginação: canonical, título e descrição únicos por página', () => {
  it('página 1 é o caminho puro; as demais apontam para si mesmas, nunca para a 1ª', () => {
    expect(canonicalPaginado('/noticias', 1)).toBe('/noticias');
    expect(canonicalPaginado('/noticias', 2)).toBe('/noticias?page=2');
    expect(canonicalPaginado('/editoria/bancos', 7)).toBe('/editoria/bancos?page=7');
    expect(tituloPaginado('Análises', 1)).toBe('Análises');
    expect(tituloPaginado('Análises', 3)).toBe('Análises — página 3');
    expect(descricaoPaginada('Texto.', 1)).toBe('Texto.');
    expect(descricaoPaginada('Texto.', 2)).toBe('Texto. Página 2.');
  });
  it('?page= inválido, zero, negativo ou ausente vira 1', () => {
    for (const v of [undefined, '', 'abc', '0', '-3', '1']) expect(paginaDe(v), String(v)).toBe(1);
    expect(paginaDe('4')).toBe(4);
  });
});

describe('robots de produção e dados estruturados', () => {
  it('robots indexável pede prévia grande de imagem (Discover e Notícias)', () => {
    expect(ROBOTS_INDEXAVEL).toMatchObject({ index: true, follow: true, googleBot: { 'max-image-preview': 'large', 'max-snippet': -1 } });
  });
  it('BreadcrumbList: posições 1..n, item absoluto no domínio do release e a página atual sem item', () => {
    const b = breadcrumbLd([{ nome: 'Início', path: '/' }, { nome: 'Bancos', path: '/editoria/bancos' }, { nome: 'Matéria' }]);
    expect(b['@type']).toBe('BreadcrumbList');
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(b.itemListElement[1]).toMatchObject({ name: 'Bancos' });
    expect(String((b.itemListElement[1] as { item?: string }).item)).toMatch(/^https?:\/\/.+\/editoria\/bancos$/);
    expect((b.itemListElement[2] as { item?: string }).item).toBeUndefined();
  });
});
