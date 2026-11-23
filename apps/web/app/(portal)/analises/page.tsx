import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Análises',
  description: 'Análises do Loyalty News sobre estratégia, economia e tecnologia da fidelização.',
  alternates: { canonical: '/analises' },
};

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
