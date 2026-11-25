/**
 * Sitemap do Google Notícias (news-sitemap.xml): só matérias das últimas 48 horas, no máximo 1000, com as tags `news:` obrigatórias.
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap
 */
export const NEWS_JANELA_MS = 48 * 60 * 60 * 1000;
export const NEWS_MAX = 1000;

export interface NewsItem {
  slug: string;
  titulo: string;
  publicadoEm: string;
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Itens que entram: publicados nas últimas 48 h (data válida e não futura), mais recentes primeiro, até 1000. */
export function noticiasRecentes(itens: readonly NewsItem[], agora: Date = new Date()): NewsItem[] {
  const t0 = agora.getTime();
  return itens
    .filter((i) => {
      const t = Date.parse(i.publicadoEm);
      return Number.isFinite(t) && t <= t0 + 60_000 && t0 - t <= NEWS_JANELA_MS;
    })
    .sort((a, b) => Date.parse(b.publicadoEm) - Date.parse(a.publicadoEm))
    .slice(0, NEWS_MAX);
}

/** XML do news-sitemap. `itens` vazio gera um urlset válido e vazio (ambiente não indexável ou sem matérias recentes). */
export function newsSitemapXml(itens: readonly NewsItem[], siteUrl: string, publicacao: string, agora: Date = new Date()): string {
  const linhas = noticiasRecentes(itens, agora).map(
    (i) =>
      `<url><loc>${xml(`${siteUrl}/noticia/${encodeURIComponent(i.slug)}`)}</loc><news:news><news:publication><news:name>${xml(publicacao)}</news:name><news:language>pt</news:language></news:publication><news:publication_date>${xml(new Date(i.publicadoEm).toISOString())}</news:publication_date><news:title>${xml(i.titulo)}</news:title></news:news></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${linhas.join('\n')}${linhas.length ? '\n' : ''}</urlset>\n`;
}
