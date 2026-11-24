import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../../../_components/ds-client';
import { ErrorState } from '../../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../../_components/ui';
import { formatDate } from '../../../_lib/format';
import { asKind, KIND_FILTER_LABEL, KIND_LABEL } from '../../../_lib/intelligence-source';
import { getSource } from '../../../_lib/source';
import s from '../../_components/intel.module.css';

// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Empresas — Loyalty Intelligence',
  description: 'Diretório de empresas e programas do mercado de fidelização, com fonte pública e data de validação.',
  alternates: { canonical: '/intelligence/empresas' },
};

const hrefFor = (tipo?: string, q?: string) => {
  const qs = new URLSearchParams();
  if (tipo) qs.set('tipo', tipo);
  if (q) qs.set('q', q);
  const s = qs.toString();
  return `/intelligence/empresas${s ? `?${s}` : ''}`;
};

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const kind = asKind(sp.tipo);
  const dir = await getSource().getCompanyDirectory({ kind, q: q || undefined });

  return (
    <>
      <PageHead
        title="Empresas"
        lead="Companhias, programas e associações do setor. Cada vínculo vem de página pública oficial, com fonte e data de validação."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Empresas' }]}
      />
      <SearchInput action="/intelligence/empresas" label="Buscar empresa" placeholder="Buscar empresa ou programa" defaultValue={q} />
      {dir.status === 'unavailable' ? (
        <ErrorState title="Diretório temporariamente indisponível" retryHref={hrefFor(kind, q)}>
          Não conseguimos carregar as empresas agora. Isso não significa que o diretório esteja vazio; tente de novo em instantes.
        </ErrorState>
      ) : (
        <>
          {dir.kinds.length > 1 && (
            <ul className="pt-chips" aria-label="Filtrar por tipo">
              <li>
                <Link className="pt-chip" href={hrefFor(undefined, q)} aria-current={!kind ? 'true' : undefined}>
                  Todos ({dir.kinds.reduce((n, k) => n + k.total, 0)})
                </Link>
              </li>
              {dir.kinds.map((k) => (
                <li key={k.kind}>
                  <Link className="pt-chip" href={hrefFor(k.kind, q)} aria-current={kind === k.kind ? 'true' : undefined}>
                    {KIND_FILTER_LABEL[k.kind]} ({k.total})
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {dir.items.length ? (
            <>
              <p className="pt-meta" data-testid="directory-count" aria-live="polite">
                {dir.total} {dir.total === 1 ? 'organização' : 'organizações'}
                {kind ? ` · ${KIND_FILTER_LABEL[kind]}` : ''}
              </p>
              <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }} data-testid="company-list">
                {dir.items.map((c) => (
                  <li key={c.id} className="pt-panel">
                    <h2 style={{ fontSize: 20 }}>
                      {c.mock && <MockTag />}
                      <Link href={`/intelligence/empresas/${c.id}`} className={s.touch} data-testid="company-card-link">{c.name}</Link>
                    </h2>
                    <p className="pt-meta">{KIND_LABEL[c.kind]}</p>
                    <p className="pt-meta">
                      {c.relationCount ? `${c.relationCount} ${c.relationCount === 1 ? 'vínculo declarado' : 'vínculos declarados'}` : 'Sem vínculos declarados'}
                      {' · '}Validado em <time dateTime={c.validatedAt}>{formatDate(c.validatedAt)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title={q || kind ? 'Nenhuma empresa com esse filtro' : 'Em breve: primeiros perfis verificados'}>
              {q || kind ? (
                <Link href="/intelligence/empresas" style={{ textDecoration: 'underline' }}>Ver todas as empresas</Link>
              ) : (
                'O diretório só publica empresas com fonte primária e data de validação. Perfis candidatos ficam internos até a verificação.'
              )}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
