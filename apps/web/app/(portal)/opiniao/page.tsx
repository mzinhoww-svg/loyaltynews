import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Opinião',
  description: 'Artigos de opinião assinados sobre o mercado de fidelização.',
  alternates: { canonical: '/opiniao' },
};

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
