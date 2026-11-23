import type { Metadata } from 'next';
import { EmptyState, MockTag, PageHead } from '../../_components/ui';
import { formatDate } from '../../_lib/format';
import { getSource } from '../../_lib/source';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Pessoas — Loyalty Intelligence',
  description: 'Perfis profissionais verificados do mercado de fidelização.',
  alternates: { canonical: '/intelligence/pessoas' },
};

export default async function PessoasPage() {
  const items = await getSource().listPeople();
  return (
    <>
      <PageHead
        title="Pessoas"
        lead="Somente dados profissionais relevantes e verificáveis. Sem relações privadas ou sensíveis."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Pessoas' }]}
      />
      {items.length ? (
        <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((p) => (
            <li key={p.slug} className="pt-panel">
              <h2 style={{ fontSize: 20 }}>{p.mock && <MockTag />}{p.name}</h2>
              <p className="pt-meta">{p.lastReviewedAt ? `Revisado em ${formatDate(p.lastReviewedAt)}` : 'Revisão pendente'}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Em breve: primeiros perfis verificados">
          Perfis de pessoas só são publicados com identidade e vínculo verificáveis por fonte pública. Titulares podem solicitar correção ou remoção.
        </EmptyState>
      )}
    </>
  );
}
