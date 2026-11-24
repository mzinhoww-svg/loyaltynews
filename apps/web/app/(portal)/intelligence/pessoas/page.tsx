import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../../_components/ds-client';
import { ErrorState } from '../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../_components/ui';
import { formatDate } from '../../_lib/format';
import { getSource } from '../../_lib/source';
import { PEOPLE_EMPTY } from '../_components/intel';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Pessoas — Loyalty Intelligence',
  description: 'Executivos do mercado de fidelização com cargos de fonte pública e data de validação.',
  alternates: { canonical: '/intelligence/pessoas' },
};

export default async function PessoasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const dir = await getSource().getPeopleDirectory({ q: q || undefined });
  return (
    <>
      <PageHead
        title="Pessoas"
        lead="Somente dados profissionais relevantes e verificáveis: nome, cargo e empresa, com fonte pública e data de validação."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Pessoas' }]}
      />
      {dir.status === 'unavailable' ? (
        <ErrorState title="Pessoas temporariamente indisponíveis" retryHref={q ? `/intelligence/pessoas?q=${encodeURIComponent(q)}` : '/intelligence/pessoas'}>
          Não conseguimos carregar os perfis agora. Isso não significa que não existam; tente de novo em instantes.
        </ErrorState>
      ) : !dir.available ? (
        <EmptyState title="Em breve: primeiros perfis verificados">{PEOPLE_EMPTY}</EmptyState>
      ) : (
        <>
          <SearchInput action="/intelligence/pessoas" label="Buscar pessoa" placeholder="Buscar pelo nome" defaultValue={q} />
          {dir.items.length ? (
            <>
              <p className="pt-meta" data-testid="people-count">{dir.total} {dir.total === 1 ? 'pessoa' : 'pessoas'}</p>
              <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }} data-testid="people-list">
                {dir.items.map((p) => (
                  <li key={p.id} className="pt-panel">
                    <h2 style={{ fontSize: 20 }}>{p.mock && <MockTag />}<Link href={`/intelligence/pessoas/${p.id}`}>{p.name}</Link></h2>
                    {p.roles.length ? (
                      p.roles.map((r) => (
                        <p key={r.id} className="pt-meta">
                          {r.title} · <Link href={`/intelligence/empresas/${r.company.id}`} style={{ textDecoration: 'underline' }}>{r.company.name}</Link>
                          {' · '}validado em <time dateTime={r.validatedAt}>{formatDate(r.validatedAt)}</time>
                        </p>
                      ))
                    ) : (
                      <p className="pt-meta">Sem cargo vigente registrado</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title={q ? `Nenhuma pessoa para “${q}”` : 'Em breve: primeiros perfis verificados'}>
              {q ? <Link href="/intelligence/pessoas" style={{ textDecoration: 'underline' }}>Ver todas as pessoas</Link> : PEOPLE_EMPTY}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
