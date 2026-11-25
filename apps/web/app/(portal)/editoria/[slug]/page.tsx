import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Listing, parsePage } from '../../_components/Listing';
import { EDITORIAS, getEditoria } from '../../_lib/editorias';
import { breadcrumbLd, canonicalPaginado, descricaoPaginada, ogImagemDaEditoria, paginaDe, tituloPaginado } from '../../_lib/seo';
import { jsonLdString } from '../../_lib/jsonld';
import { SITE_NAME, SITE_URL } from '../../_lib/site';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return EDITORIAS.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const e = getEditoria(slug);
  if (!e) return {};
  const page = paginaDe((await searchParams).page);
  const titulo = tituloPaginado(e.name, page);
  const descricao = descricaoPaginada(e.description, page);
  const canonical = canonicalPaginado(`/editoria/${e.slug}`, page);
  const img = ogImagemDaEditoria(e.slug);
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'pt_BR', title: `${titulo} | ${SITE_NAME}`, description: descricao, url: canonical, images: [img] },
    twitter: { card: 'summary_large_image', title: `${titulo} | ${SITE_NAME}`, description: descricao, images: [img.url] },
  };
}

export default async function EditoriaPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const e = getEditoria(slug);
  if (!e) notFound();
  const sp = await searchParams;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: e.name, description: e.description, url: `${SITE_URL}/editoria/${e.slug}`, inLanguage: 'pt-BR', isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL } },
    breadcrumbLd([{ nome: 'Início', path: '/' }, { nome: e.name }]),
  ];
  return (
    <>
      {ld.map((o) => (
        <script key={o['@type']} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(o) }} />
      ))}
    <Listing
      title={e.name}
      lead={e.description}
      basePath={`/editoria/${e.slug}`}
      page={parsePage(sp.page)}
      editoriaSlug={e.slug}
      crumbs={[{ label: 'Editorias', href: '/noticias' }, { label: e.name }]}
      emptyTitle="Em breve: primeiras matérias"
      emptyText={`A editoria ${e.name} ainda não tem matérias publicadas. A cobertura começa em breve.`}
    />
    </>
  );
}
