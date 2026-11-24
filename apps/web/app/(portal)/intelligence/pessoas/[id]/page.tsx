import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ErrorState } from '../../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../../_components/ui';
import { getSource } from '../../../_lib/source';
import { linkPedido } from '../../../_titular/pedido';
import { MoveCard, RolesTable, SourceLink } from '../../_components/intel';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
export const dynamic = 'force-dynamic';
const load = cache((id: string) => getSource().getPerson(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id);
  if (r.status !== 'ok') return { title: 'Pessoa — Loyalty Intelligence', robots: { index: false } };
  return {
    title: `${r.person.name} — Loyalty Intelligence`,
    description: `${r.person.name}: cargos de fonte pública no mercado de fidelização, com data de validação.`,
    alternates: { canonical: `/intelligence/pessoas/${r.person.id}` },
  };
}

// Sem loading.tsx: pessoa inexistente, suprimida ou com a flag desligada responde 404 de verdade.
export default async function PessoaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await load(id);
  if (r.status === 'not_found') notFound();
  const crumbs = [{ label: 'Intelligence', href: '/intelligence' }, { label: 'Pessoas', href: '/intelligence/pessoas' }];
  if (r.status === 'unavailable') {
    return (
      <>
        <PageHead title="Pessoa" crumbs={[...crumbs, { label: 'Indisponível' }]} />
        <ErrorState title="Perfil temporariamente indisponível" retryHref={`/intelligence/pessoas/${id}`}>
          Não conseguimos carregar este perfil agora. Tente de novo em instantes ou volte à <Link href="/intelligence/pessoas" style={{ textDecoration: 'underline' }}>lista de pessoas</Link>.
        </ErrorState>
      </>
    );
  }
  const p = r.person;
  return (
    <>
      <PageHead title={p.name} crumbs={[...crumbs, { label: p.name }]} />
      <p style={{ margin: '0 0 8px' }}>
        <Link href={linkPedido(`/intelligence/pessoas/${p.id}`)} className="ln-btn ln-btn--ghost" data-testid="request-correction">
          Solicitar correção ou remoção
        </Link>
      </p>
      <p className="pt-meta" data-testid="person-meta">
        {p.mock && <MockTag />}Fonte: <SourceLink source={p.source} />
        {p.profileUrl && (
          <> · <a href={p.profileUrl} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>perfil público<span className="pt-sr"> (abre em nova aba)</span></a></>
        )}
      </p>

      <section className="pt-section" aria-labelledby="cargos-t">
        <div className="pt-section-head"><h2 id="cargos-t">Cargos atuais</h2></div>
        {p.currentRoles.length ? (
          <RolesTable roles={p.currentRoles} testId="current-roles" caption="Cargos declarados em fonte pública oficial; nenhum cargo é inferido." />
        ) : (
          <EmptyState title="Sem cargo vigente registrado">Ausência de registro não prova inexistência.</EmptyState>
        )}
      </section>

      {p.history.length > 0 && (
        <section className="pt-section" aria-labelledby="hist-t">
          <div className="pt-section-head"><h2 id="hist-t">Cargos anteriores</h2></div>
          <RolesTable roles={p.history} testId="history-roles" caption="Cargos encerrados, com a última fonte que os sustentou." />
        </section>
      )}

      <section className="pt-section" aria-labelledby="moves-t">
        <div className="pt-section-head"><h2 id="moves-t">Movimentações confirmadas</h2></div>
        {p.moves.length ? (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }}>
            {p.moves.map((m) => <li key={m.id}><MoveCard m={m} headingLevel={3} /></li>)}
          </ul>
        ) : (
          <EmptyState title="Nenhuma movimentação confirmada">Movimentações só aparecem depois de duas leituras de fonte pública e de revisão.</EmptyState>
        )}
      </section>

      <p className="pt-meta" style={{ marginTop: 18 }}>
        Informação profissional de fonte pública. Titulares podem pedir correção ou remoção: veja a{' '}
        <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link>.
      </p>
    </>
  );
}
