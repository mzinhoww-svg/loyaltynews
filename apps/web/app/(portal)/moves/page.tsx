import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorState } from '../_components/states';
import { EmptyState, PageHead } from '../_components/ui';
import { MOVES_EMPTY, MoveCard } from '../intelligence/_components/intel';
import { getSource } from '../_lib/source';

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
        <EmptyState title="Em breve: primeiras movimentações confirmadas">{MOVES_EMPTY}</EmptyState>
      )}
      <p className="pt-meta" style={{ marginTop: 18 }}>
        Veja a <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link> para pedidos de correção ou remoção de dados profissionais.
      </p>
    </>
  );
}
