import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../../_components/ds-client';
import { ErrorState } from '../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../_components/ui';
import { formatDate } from '../../_lib/format';
import { getSource } from '../../_lib/source';
import { metadadosPagina } from '../../_seo/paginas';
import { PEOPLE_EMPTY } from '../_components/intel';
import s from '../_components/intel.module.css';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return metadadosPagina({
    title: 'Pessoas — Loyalty Intelligence',
    description: 'Executivos do mercado de fidelização com cargos de fonte pública e data de validação.',
    path: '/intelligence/pessoas',
  });
}

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
        // Três estados, não dois (P3 do QA 8): o recurso pode ter perfis que esta versão ainda não publica. Nesse caso não se
        // diz "ainda não há" (mentira por omissão) nem se descartam os itens em silêncio.
        (dir.withheld ?? 0) > 0 ? (
          <EmptyState title="Existem perfis, ainda não publicados nesta versão">
            A base tem perfis verificados, mas eles não estão publicados nesta versão do portal. Nenhum dado é exibido antes da liberação.
          </EmptyState>
        ) : (
          <EmptyState title="Ainda não há perfis publicados">{PEOPLE_EMPTY}</EmptyState>
        )
      ) : (
        <>
          <SearchInput action="/intelligence/pessoas" label="Buscar pessoa" placeholder="Buscar pelo nome" defaultValue={q} />
          {dir.items.length ? (
            <>
              <p className="pt-meta" data-testid="people-count">{dir.total} {dir.total === 1 ? 'pessoa' : 'pessoas'}</p>
              <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }} data-testid="people-list">
                {dir.items.map((p) => (
                  <li key={p.id} className="pt-panel">
                    <h2 style={{ fontSize: 20 }}>{p.mock && <MockTag />}<Link href={`/intelligence/pessoas/${p.id}`} className={s.touch} data-testid="person-card-link">{p.name}</Link></h2>
                    {p.roles.length ? (
                      p.roles.map((r) => (
                        <p key={r.id} className="pt-meta">
                          {r.title} · <Link href={`/intelligence/empresas/${r.company.id}`} style={{ textDecoration: 'underline' }}>{r.company.name}</Link>
                          {' · '}validado em {r.validatedAt ? <time dateTime={r.validatedAt}>{formatDate(r.validatedAt)}</time> : 'não confirmado'}
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
            // disponivel=true e nenhum item = filtro sem resultado (o recurso TEM dado). Com q, oferece limpar o filtro.
            <EmptyState title={q ? `Nenhuma pessoa para “${q}”` : 'Nenhum perfil publicado'}>
              {q ? <Link href="/intelligence/pessoas" style={{ textDecoration: 'underline' }}>Ver todas as pessoas</Link> : PEOPLE_EMPTY}
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
