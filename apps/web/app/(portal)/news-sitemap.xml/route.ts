import { CACHE_60S, NO_STORE } from '../../../lib/cache-60s';
import { indexingBlocked } from '../_lib/indexing';
import { newsSitemapXml, NEWS_JANELA_MS, type NewsItem } from '../_lib/news-sitemap';
import { SITE_NAME, SITE_URL } from '../_lib/site';
import { getSource } from '../_lib/source';

/**
 * Sitemap do Google Notícias. Decidido em tempo de execução, como o sitemap.xml: fora de produção indexável (staging, produção sem o interruptor,
 * fonte MOCK, noindex publicado no Studio) o conjunto é vazio. Em produção indexável lista as matérias das últimas 48 h (não patrocinadas).
 */
export const dynamic = 'force-dynamic';

// O arquivo é para o rastreador: ele mesmo não vai ao índice.
const CABECALHOS = { 'content-type': 'application/xml; charset=utf-8', 'x-robots-tag': 'noindex' } as const;

export async function GET(): Promise<Response> {
  const src = getSource();
  const bloqueado = indexingBlocked() || src.kind === 'mock' || (await src.getSiteConfig())?.seo?.noindex === true;
  if (bloqueado) return new Response(newsSitemapXml([], SITE_URL, SITE_NAME), { headers: { ...CABECALHOS, 'cache-control': NO_STORE } });

  const agora = Date.now();
  const itens: NewsItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await src.getLatest({ page, pageSize: 100 });
    for (const a of r.items) if (!a.sponsored && !a.mock) itens.push({ slug: a.slug, titulo: a.title, publicadoEm: a.publishedAt });
    const maisAntigo = r.items.length ? Date.parse(r.items[r.items.length - 1]!.publishedAt) : 0;
    // ordenado do mais novo ao mais antigo: ao passar de 48 h, o resto também passou
    if (r.unavailable || page * r.pageSize >= r.total || !(agora - maisAntigo <= NEWS_JANELA_MS)) break;
  }
  return new Response(newsSitemapXml(itens, SITE_URL, SITE_NAME), { headers: { ...CABECALHOS, 'cache-control': CACHE_60S } });
}
