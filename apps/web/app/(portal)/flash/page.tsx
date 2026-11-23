import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Loyalty Flash',
  description: 'Notas curtas e rápidas sobre o que muda no mercado de fidelização.',
  alternates: { canonical: '/flash' },
};

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
