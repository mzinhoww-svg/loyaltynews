import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';
import { canonicalPaginado, descricaoPaginada, paginaDe, tituloPaginado } from '../_lib/seo';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
const TITULO = 'Opinião';
const DESCRICAO = 'Artigos de opinião assinados sobre o mercado de fidelização.';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = paginaDe((await searchParams).page);
  const canonical = canonicalPaginado('/opiniao', page);
  const titulo = tituloPaginado(TITULO, page);
  const descricao = descricaoPaginada(DESCRICAO, page);
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical },
    openGraph: { title: `${titulo} | Loyalty News`, description: descricao, url: canonical },
  };
}

export default async function OpiniaoPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  return (
    <Listing
      title="Opinião"
      lead="Artigos assinados por autores que consentiram a publicação."
      basePath="/opiniao"
      page={parsePage(sp.page)}
      contentType="opiniao"
      emptyTitle="Nenhum artigo de opinião publicado"
      emptyText="Artigos de opinião publicados aparecem aqui, sempre com autoria identificada."
    />
  );
}
