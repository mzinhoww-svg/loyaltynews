import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Últimas notícias',
  description: 'Todas as notícias do Loyalty News, da mais recente para a mais antiga.',
  alternates: { canonical: '/noticias' },
};

export default async function NoticiasPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  return (
    <Listing
      title="Últimas notícias"
      lead="Tudo o que foi publicado, da mais recente para a mais antiga."
      basePath="/noticias"
      page={parsePage(sp.page)}
      showEditoriaChips
    />
  );
}
