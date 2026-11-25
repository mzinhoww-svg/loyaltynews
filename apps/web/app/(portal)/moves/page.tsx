import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../_components/ds-client';
import { ErrorState } from '../_components/states';
import { EmptyState, PageHead } from '../_components/ui';
import { MOVES_EMPTY, MoveCard } from '../intelligence/_components/intel';
import s from '../intelligence/_components/intel.module.css';
import { filterMoves } from '../_lib/moves-filter';
import { getSource } from '../_lib/source';
import { metadadosPagina } from '../_seo/paginas';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática e vazia; em execução (PORTAL_SOURCE=api) o Next
// recusaria a busca no-store e serviria a cópia congelada (achado no ensaio contra as rotas reais da int/011, next start).
export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return metadadosPagina({
    title: 'Loyalty Moves',
    description: 'Movimentações profissionais confirmadas no mercado de fidelização, com a fonte do antes e do depois.',
    path: '/moves',
  });
}

export default async function MovesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 60);
  const feed = await getSource().getMovesFeed();

  // Três estados de vazio, distinguíveis (QA 8, 822bcc7):
  //  (a) o recurso não tem nenhuma publicação, (b) existem Moves mas não estão publicados nesta versão, e
  //  (c) o recurso tem Moves e o FILTRO não casou nenhum. Nunca um "vazio genérico" para os três.
  const retido = feed.status === 'ok' && !feed.available && (feed.withheld ?? 0) > 0;
  const semPublicacao = feed.status === 'ok' && !feed.available && !retido;
  const filtrados = feed.status === 'ok' && feed.available ? filterMoves(feed.items, q) : [];
  const filtroVazio = feed.status === 'ok' && feed.available && filtrados.length === 0;

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
      ) : retido ? (
        <EmptyState title="Existem movimentações, ainda não publicadas nesta versão">
          <span className={s.emptyText} data-testid="moves-empty-text">{MOVES_EMPTY}</span>
          <span className={s.emptyText} data-testid="moves-empty-withheld"> Há movimentações na base, mas elas ainda não foram publicadas nesta versão do portal; nenhuma aparece antes da liberação.</span>
        </EmptyState>
      ) : semPublicacao ? (
        <EmptyState title="Ainda não há Moves publicados">
          <span className={s.emptyText} data-testid="moves-empty-text">{MOVES_EMPTY}</span>
          <span className={s.emptyText} data-testid="moves-empty-honest"> Nenhuma movimentação foi publicada até agora; a primeira entra quando houver confirmação por fonte primária, com o antes e o depois.</span>
        </EmptyState>
      ) : (
        <>
          <SearchInput action="/moves" label="Buscar movimento" placeholder="Pessoa ou empresa" defaultValue={q} />
          {q && (
            <p className="pt-meta" data-testid="moves-filter-active">
              Filtro: <strong>{q}</strong> · <Link href="/moves" className={s.touch} style={{ textDecoration: 'underline' }} data-testid="moves-filter-clear">limpar</Link>
            </p>
          )}
          {filtroVazio ? (
            <EmptyState title={q ? `Nenhum Move para “${q}”` : 'Nenhum Move publicado no momento'}>
              <span className={s.emptyText} data-testid="moves-filter-empty">
                {q
                  ? 'Nenhuma movimentação confirmada casa com esse filtro. A busca olha o nome da pessoa e das empresas do antes e do depois. Nada foi escondido: é só este filtro que não tem resultado.'
                  : 'O recurso está publicado, mas não há movimentação confirmada para exibir agora.'}
              </span>
              {q && (
                <p style={{ marginTop: 8 }}>
                  <Link href="/moves" style={{ textDecoration: 'underline' }} data-testid="moves-filter-empty-clear">Ver todos os Moves</Link>
                </p>
              )}
            </EmptyState>
          ) : (
            <>
              <p className="pt-meta" data-testid="moves-count" aria-live="polite">
                {filtrados.length} {filtrados.length === 1 ? 'movimentação' : 'movimentações'}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }} data-testid="moves-list">
                {filtrados.map((m) => (
                  <li key={m.id}><MoveCard m={m} /></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {(retido || semPublicacao) && (
        <section className={s.meanwhile} aria-labelledby="moves-meanwhile" data-testid="moves-meanwhile">
          <h2 id="moves-meanwhile" style={{ fontSize: 18 }}>Enquanto isso</h2>
          <ul>
            <li><Link href="/intelligence/empresas" className={s.touch} style={{ textDecoration: 'underline' }}>Diretório de empresas e programas, com a fonte de cada vínculo</Link></li>
            <li><Link href="/intelligence/pessoas" className={s.touch} style={{ textDecoration: 'underline' }}>Pessoas e cargos de fonte pública</Link></li>
          </ul>
        </section>
      )}
      <p className="pt-meta" style={{ marginTop: 18 }}>
        Veja a <Link href="/privacidade" className={s.touch} style={{ textDecoration: 'underline' }} data-testid="moves-privacy">política de privacidade e LGPD</Link> para pedidos de correção ou remoção de dados profissionais.
      </p>
    </>
  );
}
