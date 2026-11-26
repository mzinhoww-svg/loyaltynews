import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';
import { ogImagensDaPagina } from '../_lib/seo-source';
import { canonicalPaginado, descricaoPaginada, paginaDe, tituloPaginado } from '../_lib/seo';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
const TITULO = 'Entrevistas';
const DESCRICAO = 'Conversas e perfis com quem constrói o mercado de fidelização.';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = paginaDe((await searchParams).page);
  const canonical = canonicalPaginado('/entrevistas', page);
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

export default async function EntrevistasPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  return (
    <Listing
      title="Entrevistas"
      lead="Conversas e perfis com quem constrói o mercado. Só publicamos entrevistas efetivamente realizadas."
      basePath="/entrevistas"
      page={parsePage(sp.page)}
      contentType="entrevista"
      emptyTitle="Nenhuma entrevista publicada"
      emptyText="Entrevistas publicadas aparecem aqui, sempre com autoria e consentimento do entrevistado."
    />
  );
}
