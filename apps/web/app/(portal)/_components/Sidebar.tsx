import Link from 'next/link';
import { flags } from '../_lib/flags';
import { getSource } from '../_lib/source';
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
