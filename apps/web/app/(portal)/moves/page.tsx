import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorState } from '../_components/states';
import { EmptyState, PageHead } from '../_components/ui';
import { MOVES_EMPTY, MoveCard } from '../intelligence/_components/intel';
import s from '../intelligence/_components/intel.module.css';
import { getSource } from '../_lib/source';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática e vazia; em execução (PORTAL_SOURCE=api) o Next
// recusaria a busca no-store e serviria a cópia congelada (achado no ensaio contra as rotas reais da int/011, next start).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Loyalty Moves',
  description: 'Movimentações profissionais confirmadas no mercado de fidelização.',
  alternates: { canonical: '/moves' },
};

export default async function MovesPage() {
  const feed = await getSource().getMovesFeed();
  return (
    <>
      <PageHead
        title="Loyalty Moves"
        lead="Quem mudou de cargo ou de empresa no mercado de fidelização. Só publicamos movimentações confirmadas, com a fonte do antes e do depois."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Moves' }]}
      />
      {feed.status === 'unavailable' ? (
        <ErrorState title="Moves temporariamente indisponíveis" retryHref="/moves">
          Não conseguimos carregar as movimentações agora. Isso não significa que não existam; tente de novo em instantes.
        </ErrorState>
      ) : feed.items.length ? (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }} data-testid="moves-list">
          {feed.items.map((m) => (
            <li key={m.id}><MoveCard m={m} /></li>
          ))}
        </ul>
      ) : (
        <>
          <EmptyState title="Em breve: primeiras movimentações confirmadas">
            <span className={s.emptyText} data-testid="moves-empty-text">{MOVES_EMPTY}</span>
          </EmptyState>
          <section className={s.meanwhile} aria-labelledby="moves-meanwhile" data-testid="moves-meanwhile">
            <h2 id="moves-meanwhile" style={{ fontSize: 18 }}>Enquanto isso</h2>
            <ul>
              <li><Link href="/intelligence/empresas" className={s.touch} style={{ textDecoration: 'underline' }}>Diretório de empresas e programas, com a fonte de cada vínculo</Link></li>
              <li><Link href="/intelligence/pessoas" className={s.touch} style={{ textDecoration: 'underline' }}>Pessoas e cargos de fonte pública</Link></li>
            </ul>
          </section>
        </>
      )}
      <p className="pt-meta" style={{ marginTop: 18 }}>
        Veja a <Link href="/privacidade" className={s.touch} style={{ textDecoration: 'underline' }} data-testid="moves-privacy">política de privacidade e LGPD</Link> para pedidos de correção ou remoção de dados profissionais.
      </p>
    </>
  );
}
