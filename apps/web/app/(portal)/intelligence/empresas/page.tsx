import type { Metadata } from 'next';
import { EmptyState, MockTag, PageHead } from '../../_components/ui';
import { formatDate, normalize } from '../../_lib/format';
import { getSource } from '../../_lib/source';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Empresas — Loyalty Intelligence',
  description: 'Diretório de empresas e programas do mercado de fidelização.',
  alternates: { canonical: '/intelligence/empresas' },
};

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 120);
  const all = await getSource().listCompanies();
  const items = q ? all.filter((c) => normalize(`${c.name} ${c.segment ?? ''}`).includes(normalize(q))) : all;
  return (
    <>
      <PageHead title="Empresas" lead="Companhias, programas e parceiros do setor." crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Empresas' }]} />
      {items.length ? (
        <ul className="ln-grid ln-grid-3" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((c) => (
            <li key={c.slug} className="ln-panel">
              <h2 style={{ fontSize: 20 }}>{c.mock && <MockTag />}{c.name}</h2>
              {c.segment && <p className="ln-meta">{c.segment}</p>}
              <p className="ln-meta">{c.lastReviewedAt ? `Revisado em ${formatDate(c.lastReviewedAt)}` : 'Revisão pendente'}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={q ? `Nenhuma empresa para “${q}”` : 'Em breve: primeiros perfis verificados'}>
          O diretório só publica empresas com fonte primária e data de revisão. Perfis candidatos ficam internos até a verificação.
        </EmptyState>
      )}
    </>
  );
}
