import Link from 'next/link';
import type { ReactNode } from 'react';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import type { AdSlotId } from '../_lib/types';
import { AdSlot, RankedList } from './ui';

/** Barra lateral: "Em alta" (só quando há ranking real), anúncios reais e The Loyal (flag). Sem texto de vazio repetido. */
export async function Sidebar() {
  const trending = (await getSource().getTrending('24h')).slice(0, 5);
  return (
    <aside className="pt-side" aria-label="Barra lateral">
      <AdSlot slot="sidebar-1" />
      {trending.length > 0 && (
        <section className="pt-panel" aria-labelledby="side-trending">
          <h2 id="side-trending" className="pt-panel-title">
            Em alta
          </h2>
          <RankedList items={trending} />
          <Link href="/em-alta" className="pt-more">
            Ver ranking →
          </Link>
        </section>
      )}
      <AdSlot slot="sidebar-2" />
      {flags.theLoyal && (
        <section className="pt-panel" aria-labelledby="side-loyal">
          <h2 id="side-loyal" className="pt-panel-title">
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

const SIDE_ADS: AdSlotId[] = ['sidebar-1', 'sidebar-2', 'sidebar-3'];

/**
 * Conteúdo + lateral. A lateral só existe quando tem o que mostrar (anúncio real, "Em alta" com dado ou The Loyal ligado);
 * sem nada, o conteúdo ocupa a largura toda (sem coluna vazia).
 */
export async function WithSidebar({ children }: { children: ReactNode }) {
  const src = getSource();
  const [trending, ads] = await Promise.all([src.getTrending('24h'), Promise.all(SIDE_ADS.map((s) => src.getAd(s)))]);
  if (trending.length === 0 && !ads.some(Boolean) && !flags.theLoyal) return <>{children}</>;
  return (
    <div className="pt-layout">
      <div className="pt-col">{children}</div>
      <Sidebar />
    </div>
  );
}
