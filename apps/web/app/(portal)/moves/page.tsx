import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, MockTag, PageHead } from '../_components/ui';
import { formatDate } from '../_lib/format';
import { getSource } from '../_lib/source';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Loyalty Moves',
  description: 'Movimentações profissionais confirmadas no mercado de fidelização.',
  alternates: { canonical: '/moves' },
};

export default async function MovesPage() {
  const moves = (await getSource().listMoves()).sort((a, b) => b.announcedAt.localeCompare(a.announcedAt));
  return (
    <>
      <PageHead
        title="Loyalty Moves"
        lead="Quem mudou de cargo ou de empresa no mercado de fidelização. Só publicamos movimentações confirmadas por fonte primária."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Moves' }]}
      />
      {moves.length ? (
        <div className="ln-scroll">
          <table className="ln-table">
            <caption className="ln-meta" style={{ textAlign: 'left', paddingBottom: 6 }}>Movimentações confirmadas, da mais recente para a mais antiga.</caption>
            <thead>
              <tr><th>Pessoa</th><th>Empresa</th><th>De</th><th>Para</th><th>Data</th><th>Fonte</th></tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td>{m.mock && <MockTag />}{m.personName}</td>
                  <td>{m.companyName}</td>
                  <td>{m.fromRole ?? '—'}</td>
                  <td>{m.toRole}</td>
                  <td><time dateTime={m.announcedAt}>{formatDate(m.announcedAt)}</time></td>
                  <td><a href={m.sourceUrl} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>Fonte</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Em breve: primeiras movimentações confirmadas">
          O Loyalty Moves detecta candidatos, confirma com fonte primária e só então publica. Nada é publicado como fato antes da confirmação.
        </EmptyState>
      )}
      <p className="ln-meta" style={{ marginTop: 18 }}>
        Veja a <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link> para pedidos de correção ou remoção de dados profissionais.
      </p>
    </>
  );
}
