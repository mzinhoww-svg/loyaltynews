import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Listing, parsePage } from '../../_components/Listing';
import { EDITORIAS, getEditoria } from '../../_lib/editorias';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return EDITORIAS.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const e = getEditoria(slug);
  if (!e) return {};
  return {
    title: e.name,
    description: e.description,
    alternates: { canonical: `/editoria/${e.slug}` },
    openGraph: { title: `${e.name} | Loyalty News`, description: e.description },
  };
}

export default async function EditoriaPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const e = getEditoria(slug);
  if (!e) notFound();
  const sp = await searchParams;
  return (
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
  );
}
