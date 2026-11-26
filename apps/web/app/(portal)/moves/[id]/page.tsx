import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ErrorState } from '../../_components/states';
import { PageHead } from '../../_components/ui';
import { MOVE_KIND_LABEL } from '../../_lib/intelligence-source';
import { getSource } from '../../_lib/source';
import { jsonLdString } from '../../_lib/jsonld';
import { datasetLd } from '../../_lib/seo';
import { metadadosPagina } from '../../_seo/paginas';
import { linkPedido } from '../../_titular/pedido';
import { MoveCard } from '../../intelligence/_components/intel';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';
const load = cache((id: string) => getSource().getMove(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id);
  if (r.status === 'not_found') return { title: 'Página não encontrada', robots: { index: false } };
  if (r.status !== 'ok') return { title: 'Loyalty Moves', robots: { index: false } };
  const m = r.move;
  const para = m.after ? ` para ${m.after.title} na ${m.after.company.name}` : '';
  return metadadosPagina({
    title: `${m.person.name}: ${MOVE_KIND_LABEL[m.kind].toLowerCase()} — Loyalty Moves`,
    description: `Movimentação confirmada de ${m.person.name}${para}, com a fonte do antes e do depois.`,
    path: `/moves/${m.id}`,
    type: 'article',
    noindex: m.mock,
  });
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
  // Descrição visível: lastreia o Dataset do Move (parecer QA 11).
  const para = r.move.after ? ` para ${r.move.after.title} na ${r.move.after.company.name}` : '';
  const descricao = `Movimentação confirmada de ${r.move.person.name}${para}, com a fonte do antes e do depois.`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(datasetLd({ name: `${MOVE_KIND_LABEL[r.move.kind]}: ${r.move.person.name}`, description: descricao, path: `/moves/${r.move.id}` })) }} />
      <PageHead title={`${MOVE_KIND_LABEL[r.move.kind]}: ${r.move.person.name}`} lead={descricao} crumbs={[...crumbs, { label: r.move.person.name }]} />
      <p style={{ margin: '0 0 8px' }}>
        <Link href={linkPedido(`/moves/${r.move.id}`)} className="ln-btn ln-btn--ghost" data-testid="move-correction">
          Solicitar correção ou remoção
        </Link>
      </p>
      <MoveCard m={r.move} link={false} />
      <p className="pt-meta" style={{ marginTop: 18 }}>
        &quot;Antes&quot; é a última fonte que sustentou o cargo anterior; &quot;depois&quot; é a leitura que registrou a mudança. A data efetiva só aparece quando a fonte a declara.
      </p>
    </>
  );
}
