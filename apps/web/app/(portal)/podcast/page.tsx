import type { Metadata } from 'next';
import { EmptyState, PageHead } from '../_components/ui';
import { flags } from '../_lib/flags';

export const metadata: Metadata = {
  title: 'Loyalty Talks — podcast',
  description: 'Loyalty Talks: conversas com quem constrói o mercado de fidelização.',
  alternates: { canonical: '/podcast' },
  robots: flags.podcast ? undefined : { index: false, follow: true },
};

export default function PodcastPage() {
  return (
    <>
      <PageHead title="Loyalty Talks" lead="Conversas com quem constrói o mercado." crumbs={[{ label: 'Podcast' }]} />
      <EmptyState title="Loyalty Talks em breve">
        Ainda não há episódios. Só publicaremos episódios reais, com convidado real, player externo e, quando autorizada, transcrição.
      </EmptyState>
    </>
  );
}
