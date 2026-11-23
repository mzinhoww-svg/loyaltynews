import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Entrevistas',
  description: 'Conversas e perfis com quem constrói o mercado de fidelização.',
  alternates: { canonical: '/entrevistas' },
};

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
