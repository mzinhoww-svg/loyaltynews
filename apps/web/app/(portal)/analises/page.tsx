import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

export const revalidate = 60;
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
