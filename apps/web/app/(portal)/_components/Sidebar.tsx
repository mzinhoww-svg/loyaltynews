import { Button } from '@ln/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
import type { AdSlotId } from '../_lib/types';
import { AdSlot, RankedList } from './ui';

const SIDE_ADS: AdSlotId[] = ['sidebar-1', 'sidebar-2', 'sidebar-3'];

/**
 * Conteúdo + lateral. A lateral só existe quando tem algo para mostrar (anúncio real, "Em alta" com dado,
 * The Loyal ligado ou `extra`); sem nada, o conteúdo ocupa a largura toda (sem coluna vazia nem aviso).
 * "Em alta" aparece SÓ aqui (nunca repetido no corpo da home).
 */
export async function WithSidebar({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const src = getSource();
  const [trending, ads] = await Promise.all([src.getTrending('24h'), Promise.all(SIDE_ADS.map((s) => src.getAd(s)))]);
  const top = trending.slice(0, 5);
  const hasSide = top.length > 0 || ads.some(Boolean) || flags.theLoyal || Boolean(extra);
  if (!hasSide) return <>{children}</>;
  return (
    <div className="pt-layout">
      <div className="pt-main-col">{children}</div>
      <aside className="pt-side" aria-label="Barra lateral">
        <AdSlot slot="sidebar-1" />
        {top.length > 0 && (
          <section className="pt-panel" aria-labelledby="side-trending">
            <h2 id="side-trending">Em alta</h2>
            <RankedList items={top} />
          </section>
        )}
        <AdSlot slot="sidebar-2" />
        {extra}
        {flags.theLoyal && (
          <section className="pt-panel" aria-labelledby="side-loyal">
            <h2 id="side-loyal">The Loyal</h2>
            <p>O mercado de fidelidade, direto na sua caixa de entrada.</p>
            <Button href="/the-loyal" linkAs={Link}>
              Assinar
            </Button>
          </section>
        )}
        <AdSlot slot="sidebar-3" />
      </aside>
    </div>
  );
}
