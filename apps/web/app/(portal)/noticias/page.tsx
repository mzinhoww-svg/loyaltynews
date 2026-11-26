import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';
import { emDemonstracao } from '../_lib/demo';
import { ogImagensDaPagina } from '../_lib/seo-source';
import { isMockSource } from '../_lib/source';
import { canonicalPaginado, descricaoPaginada, paginaDe, tituloPaginado } from '../_lib/seo';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
const TITULO = 'Últimas notícias';
const DESCRICAO = 'Todas as notícias do Loyalty News, da mais recente para a mais antiga.';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = paginaDe((await searchParams).page);
  const canonical = canonicalPaginado('/noticias', page);
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

export default async function NoticiasPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const demo = emDemonstracao({
    appEnv: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    portalDemo: process.env.NEXT_PUBLIC_PORTAL_DEMO,
    mock: isMockSource(),
  });
  return (
    <Listing
      title="Últimas notícias"
      lead={
        demo
          ? 'Conteúdo de demonstração — não é o arquivo publicado. Da mais recente para a mais antiga.'
          : 'Tudo o que foi publicado, da mais recente para a mais antiga.'
      }
      basePath="/noticias"
      page={parsePage(sp.page)}
      showEditoriaChips
    />
  );
}
