import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';
import { ogImagensDaPagina } from '../_lib/seo-source';
import { canonicalPaginado, descricaoPaginada, paginaDe, tituloPaginado } from '../_lib/seo';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
const TITULO = 'Loyalty Flash';
const DESCRICAO = 'Notas curtas e rápidas sobre o que muda no mercado de fidelização.';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = paginaDe((await searchParams).page);
  const canonical = canonicalPaginado('/flash', page);
  const titulo = tituloPaginado(TITULO, page);
  const descricao = descricaoPaginada(DESCRICAO, page);
  const images = await ogImagensDaPagina();
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical },
    openGraph: { title: `${titulo} | Loyalty News`, description: descricao, url: canonical, images },
  };
}

export default async function FlashPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  return (
    <Listing
      title="Loyalty Flash"
      lead="Notas curtas e rápidas sobre o que muda no mercado de fidelização."
      basePath="/flash"
      page={parsePage(sp.page)}
      contentType="flash"
      emptyTitle="Nenhuma nota do Loyalty Flash publicada"
      emptyText="Quando houver notas curtas publicadas e verificadas, elas aparecem aqui, da mais recente para a mais antiga."
    />
  );
}
