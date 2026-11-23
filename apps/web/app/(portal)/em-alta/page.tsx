import type { Metadata } from 'next';
import Link from 'next/link';
import { WithSidebar } from '../_components/Sidebar';
import { EmptyState, PageHead, RankedList } from '../_components/ui';
import { getSource } from '../_lib/source';
import type { TrendingWindow } from '../_lib/types';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Em alta',
  description: 'As matérias mais lidas do Loyalty News nas últimas 24 horas, 7 e 30 dias.',
  alternates: { canonical: '/em-alta' },
};

const WINDOWS: { id: TrendingWindow; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

export default async function EmAltaPage({ searchParams }: { searchParams: Promise<{ janela?: string }> }) {
  const sp = await searchParams;
  const win = (WINDOWS.find((w) => w.id === sp.janela)?.id ?? '24h') as TrendingWindow;
  const items = await getSource().getTrending(win);
  return (
    <>
      <PageHead
        title="Em alta"
        lead="Mais lidas, por leituras qualificadas e deduplicadas. Quando o histórico é insuficiente, não simulamos popularidade."
        crumbs={[{ label: 'Em alta' }]}
      />
      <ul className="pt-chips" aria-label="Janela de tempo">
        {WINDOWS.map((w) => (
          <li key={w.id}>
            <Link className="pt-chip" href={w.id === '24h' ? '/em-alta' : `/em-alta?janela=${w.id}`} aria-current={w.id === win ? 'true' : undefined}>
              {w.label}
            </Link>
          </li>
        ))}
      </ul>
      <WithSidebar>
        <div>
          {items.length ? (
            <RankedList items={items} />
          ) : (
            <EmptyState title="Ranking em formação">
              O ranking de mais lidas depende de matérias publicadas e de histórico de leitura suficiente. Nada é simulado.
            </EmptyState>
          )}
        </div>
        </WithSidebar>
    </>
  );
}
