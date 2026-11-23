import { indexingBlocked } from '../_lib/indexing';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '../_lib/site';
import { getSource } from '../_lib/source';

export const revalidate = 300;

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET() {
  const src = getSource();
  // Sem itens quando a indexação está bloqueada (produção pré-go-live sem PORTAL_INDEXAVEL=1, staging, vitrine; igual ao sitemap)
  // e com fonte MOCK/vitrine (Security R6): o canal RSS existe, mas não publica itens.
  const noindexPublicado = (await src.getSiteConfig())?.seo?.noindex === true;
  const items = src.kind === 'mock' || indexingBlocked() || noindexPublicado ? [] : (await src.getLatest({ pageSize: 30 })).items;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${x(SITE_NAME)}</title><link>${SITE_URL}</link><description>${x(SITE_DESCRIPTION)}</description><language>pt-BR</language>
${items
  .map(
    (a) => `<item><title>${x(a.title)}</title><link>${SITE_URL}/noticia/${a.slug}</link><guid isPermaLink="true">${SITE_URL}/noticia/${a.slug}</guid><pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate><description>${x(a.summary)}</description></item>`,
  )
  .join('\n')}
</channel></rss>`;
  return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
