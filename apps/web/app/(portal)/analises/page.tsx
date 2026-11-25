import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';
import { ogImagensDaPagina } from '../_lib/seo-source';
import { canonicalPaginado, descricaoPaginada, paginaDe, tituloPaginado } from '../_lib/seo';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
const TITULO = 'Análises';
const DESCRICAO = 'Análises do Loyalty News sobre estratégia, economia e tecnologia da fidelização.';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = paginaDe((await searchParams).page);
  const canonical = canonicalPaginado('/analises', page);
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

export default async function AnalisesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  return (
    <Listing
      title="Análises"
      lead="Contexto e leitura de negócio sobre o que move a fidelização."
      basePath="/analises"
      page={parsePage(sp.page)}
      contentType="analise"
      emptyTitle="Nenhuma análise publicada"
      emptyText="Quando houver análises publicadas, elas aparecem aqui, da mais recente para a mais antiga."
    />
  );
}
