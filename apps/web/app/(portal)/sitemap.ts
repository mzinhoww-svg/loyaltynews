import type { MetadataRoute } from 'next';
import { EDITORIAS } from './_lib/editorias';
import { flags } from './_lib/flags';
import { isProductionEnv } from './_lib/indexing';
import { INFO_SLUGS } from './_lib/institutional';
import { SITE_URL } from './_lib/site';
import { getSource } from './_lib/source';

// Decidido em tempo de execução (APP_ENV): fora de produção o sitemap é vazio.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const src = getSource();
  /**
   * Etapa A do go-live (auditoria de produção de 25/11): o sitemap lista as URLs reais MESMO com o noindex ainda ligado
   * (`PORTAL_INDEXAVEL` ausente). Assim dá para provar sitemap + canonical no domínio certo ANTES de abrir o índice — a
   * ordem obrigatória é essa, nunca o contrário. Continua vazio fora de produção, na vitrine, com fonte MOCK ou com
   * `noindex` publicado de propósito no Studio (aí o portal está sendo escondido de propósito).
   */
  if (!isProductionEnv() || src.kind === 'mock' || (await src.getSiteConfig())?.seo?.noindex) return [];

  // A home sai sem barra final, igual ao canonical do layout (`SITE_URL`); barra a mais criaria duas URLs para a mesma página.
  const abs = (p: string) => (p === '/' ? SITE_URL : `${SITE_URL}${p}`);
  const staticPaths = [
    '/', '/noticias', '/flash', '/analises', '/entrevistas', '/opiniao', '/em-alta', '/agenda',
    '/moves', '/intelligence', '/intelligence/empresas', '/intelligence/pessoas', '/midia-kit',
    ...(flags.theLoyal ? ['/the-loyal'] : []),
    ...(flags.podcast ? ['/podcast'] : []),
    ...(flags.marketData ? ['/indicadores'] : []),
  ];
  const entries: MetadataRoute.Sitemap = [
    ...staticPaths.map((p) => ({ url: abs(p), changeFrequency: 'daily' as const, priority: p === '/' ? 1 : 0.7 })),
    ...EDITORIAS.map((e) => ({ url: abs(`/editoria/${e.slug}`), changeFrequency: 'daily' as const, priority: 0.8 })),
    ...INFO_SLUGS.map((s) => ({ url: abs(`/${s}`), changeFrequency: 'yearly' as const, priority: 0.3 })),
  ];

  for (let page = 1; page <= 50; page++) {
    const res = await src.getLatest({ page, pageSize: 100 });
    for (const a of res.items) {
      entries.push({ url: abs(`/noticia/${a.slug}`), lastModified: a.updatedAt ?? a.publishedAt, changeFrequency: 'weekly', priority: 0.6 });
    }
    if (page * res.pageSize >= res.total) break;
  }
  for (const ev of (await src.listEvents()).items) {
    if (ev.status === 'validado') entries.push({ url: abs(`/agenda/${encodeURIComponent(ev.slug)}`), changeFrequency: 'weekly', priority: 0.5 });
  }
  // Perfis do Intelligence: empresas e pessoas verificadas. Vêm do DADO, não de lista escrita à mão; só entram os que a
  // fonte entrega como publicáveis (a pessoa sem diretório disponível não entra).
  for (const c of await src.listCompanies()) {
    entries.push({ url: abs(`/intelligence/empresas/${c.slug}`), changeFrequency: 'weekly', priority: 0.6 });
  }
  const pessoas = await src.getPeopleDirectory();
  if (pessoas.status === 'ok' && pessoas.available) {
    for (const p of pessoas.items) {
      entries.push({ url: abs(`/intelligence/pessoas/${p.id}`), changeFrequency: 'weekly', priority: 0.5 });
    }
  }
  // Moves confirmados (cada um tem página própria, com a fonte do antes e do depois).
  const moves = await src.getMovesFeed();
  if (moves.status === 'ok' && moves.available) {
    for (const m of moves.items) {
      entries.push({ url: abs(`/moves/${m.id}`), changeFrequency: 'monthly', priority: 0.4 });
    }
  }
  return entries;
}
