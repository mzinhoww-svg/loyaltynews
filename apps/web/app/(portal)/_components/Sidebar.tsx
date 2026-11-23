import Link from 'next/link';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import { AdSlot, RankedList } from './ui';

export async function Sidebar() {
  const trending = (await getSource().getTrending('24h')).slice(0, 5);
  return (
    <aside className="pt-side" aria-label="Barra lateral">
      <AdSlot slot="sidebar-1" />
      <section className="pt-panel" aria-labelledby="side-trending">
        <h2 id="side-trending" style={{ fontSize: 20 }}>
          Em alta
        </h2>
        {trending.length ? (
          <RankedList items={trending} />
        ) : (
          <p className="pt-meta">Ranking de leitura disponível quando houver matérias e histórico de leitura suficiente.</p>
        )}
      </section>
      <AdSlot slot="sidebar-2" />
      {flags.theLoyal && (
        <section className="pt-panel" aria-labelledby="side-loyal">
          <h2 id="side-loyal" style={{ fontSize: 20 }}>
            The Loyal
          </h2>
          <p>O mercado de fidelidade, direto na sua caixa de entrada.</p>
          <Link href="/the-loyal" className="ln-btn ln-btn--primary">
            Assinar
          </Link>
        </section>
      )}
      <AdSlot slot="sidebar-3" />
    </aside>
  );
}
