import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ErrorState } from '../../_components/states';
import { PageHead } from '../../_components/ui';
import { MOVE_KIND_LABEL } from '../../_lib/intelligence-source';
import { getSource } from '../../_lib/source';
import { MoveCard } from '../../intelligence/_components/intel';

export const revalidate = 60;
const load = cache((id: string) => getSource().getMove(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id);
  if (r.status !== 'ok') return { title: 'Loyalty Moves', robots: { index: false } };
  return {
    title: `${r.move.person.name}: ${MOVE_KIND_LABEL[r.move.kind].toLowerCase()} — Loyalty Moves`,
    description: `Movimentação confirmada de ${r.move.person.name}, com a fonte do antes e do depois.`,
    alternates: { canonical: `/moves/${r.move.id}` },
  };
}

// Sem loading.tsx aqui: Move não confirmado ou inexistente precisa responder 404 de verdade.
export default async function MovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await load(id);
  if (r.status === 'not_found') notFound();
  const crumbs = [{ label: 'Intelligence', href: '/intelligence' }, { label: 'Moves', href: '/moves' }];
  if (r.status === 'unavailable') {
    return (
      <>
        <PageHead title="Movimentação" crumbs={[...crumbs, { label: 'Indisponível' }]} />
        <ErrorState title="Movimentação temporariamente indisponível" retryHref={`/moves/${id}`}>
          Não conseguimos carregar esta movimentação agora. Tente de novo em instantes ou volte ao <Link href="/moves" style={{ textDecoration: 'underline' }}>Loyalty Moves</Link>.
        </ErrorState>
      </>
    );
  }
  return (
    <>
      <PageHead title={`${MOVE_KIND_LABEL[r.move.kind]}: ${r.move.person.name}`} crumbs={[...crumbs, { label: r.move.person.name }]} />
      <MoveCard m={r.move} link={false} />
      <p className="pt-meta" style={{ marginTop: 18 }}>
        &quot;Antes&quot; é a última fonte que sustentou o cargo anterior; &quot;depois&quot; é a leitura que registrou a mudança. A data efetiva só aparece quando a fonte a declara.
      </p>
    </>
  );
}
