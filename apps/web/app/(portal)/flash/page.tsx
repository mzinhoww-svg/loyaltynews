import type { Metadata } from 'next';
import { Listing, parsePage } from '../_components/Listing';

export const revalidate = 60;
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
      emptyTitle="Loyalty Flash em breve"
      emptyText="As primeiras notas curtas aparecerão aqui assim que forem publicadas e verificadas."
    />
  );
}
