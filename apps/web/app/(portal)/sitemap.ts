import type { MetadataRoute } from 'next';
import { EDITORIAS } from './_lib/editorias';
import { flags } from './_lib/flags';
import { INFO_SLUGS } from './_lib/institutional';
import { SITE_URL } from './_lib/site';
import { getSource } from './_lib/source';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const src = getSource();
  // Conteúdo MOCK nunca entra no sitemap.
  if (src.kind === 'mock') return [{ url: `${SITE_URL}/` }];

  const abs = (p: string) => `${SITE_URL}${p}`;
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
  for (const ev of await src.listEvents()) {
    if (ev.status === 'validado') entries.push({ url: abs(`/agenda/${ev.slug}`), changeFrequency: 'weekly', priority: 0.5 });
  }
  return entries;
}
