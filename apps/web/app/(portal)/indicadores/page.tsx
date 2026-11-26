import type { Metadata } from 'next';
import { ogDaPaginaPublicada } from '../_seo/paginas';
import { EmptyState, PageHead } from '../_components/ui';
import { flags } from '../_lib/flags';

export async function generateMetadata(): Promise<Metadata> {
  return {
  title: 'Loyalty Market Data',
  description: 'Indicadores do mercado de fidelização com metodologia, fonte e carimbo de atualização.',
  alternates: { canonical: '/indicadores' },
  openGraph: await ogDaPaginaPublicada({ title: 'Loyalty Market Data', description: 'Indicadores do mercado de fidelização com metodologia, fonte e carimbo de atualização.', path: '/indicadores' }),
  robots: flags.marketData ? undefined : { index: false, follow: true },
  };
}

export default function IndicadoresPage() {
  return (
    <>
      <PageHead
        title="Loyalty Market Data"
        lead="Indicadores com metodologia, fonte e data de atualização."
        crumbs={[{ label: 'Market Data' }]}
      />
      <EmptyState title="Market Data em breve (fase 2)">
        Nenhum índice ou preço de milheiro é exibido antes de haver cesta, pesos, fontes licenciadas e metodologia validados. Indicadores estimados nunca são apresentados como reais.
      </EmptyState>
    </>
  );
}
