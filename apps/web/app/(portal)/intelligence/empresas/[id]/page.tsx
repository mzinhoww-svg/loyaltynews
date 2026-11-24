import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ErrorState } from '../../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../../_components/ui';
import { formatDate } from '../../../_lib/format';
import { KIND_LABEL, relationLabel } from '../../../_lib/intelligence-source';
import { getSource } from '../../../_lib/source';
import { MoveCard, RolesTable } from '../../_components/intel';
import { ScrollRegion } from '../../../_components/ScrollRegion';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';

const load = cache((id: string) => getSource().getCompany(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await load(id);
  if (r.status !== 'ok') return { title: 'Empresa — Loyalty Intelligence', robots: { index: false } };
  return {
    title: `${r.company.name} — Loyalty Intelligence`,
    description: `${r.company.name}: vínculos declarados no mercado de fidelização, com fonte pública e data de validação.`,
    alternates: { canonical: `/intelligence/empresas/${r.company.id}` },
  };
}

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await load(id);
  if (r.status === 'not_found') notFound();
  const crumbs = [{ label: 'Intelligence', href: '/intelligence' }, { label: 'Empresas', href: '/intelligence/empresas' }];

  if (r.status === 'unavailable') {
    return (
      <>
        <PageHead title="Empresa" crumbs={[...crumbs, { label: 'Indisponível' }]} />
        <ErrorState title="Perfil temporariamente indisponível" retryHref={`/intelligence/empresas/${id}`}>
          Não conseguimos carregar este perfil agora. Tente de novo em instantes ou volte ao <Link href="/intelligence/empresas" style={{ textDecoration: 'underline' }}>diretório</Link>.
        </ErrorState>
      </>
    );
  }

  const c = r.company;
  const [people, moves] = await Promise.all([getSource().getPeopleDirectory({ companyId: c.id }), getSource().getMovesFeed({ companyId: c.id })]);
  return (
    <>
      <PageHead title={c.name} crumbs={[...crumbs, { label: c.name }]} />
      <p className="pt-meta" data-testid="company-meta">
        {c.mock && <MockTag />}
        {KIND_LABEL[c.kind]}
        {c.legalName !== c.name ? ` · ${c.legalName}` : ''}
        {' · '}Fonte:{' '}
        <a href={c.source.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>{c.source.name}</a>
        {', '}coletada em <time dateTime={c.source.retrievedAt}>{formatDate(c.source.retrievedAt)}</time>
      </p>

      <section className="pt-section" aria-labelledby="rel-t">
        <div className="pt-section-head"><h2 id="rel-t">Vínculos declarados</h2></div>
        {c.relations.length ? (
          <ScrollRegion label="Vínculos declarados, organizações e fontes">
            <table className="pt-table" data-testid="relations">
              <caption className="pt-meta" style={{ textAlign: 'left', paddingBottom: 6 }}>
                Somente o que a fonte pública afirma; nenhum vínculo é inferido. Associação ou parceria não indica participação societária.
              </caption>
              <thead>
                <tr><th scope="col">Vínculo</th><th scope="col">Organização</th><th scope="col">Fonte</th><th scope="col">Validado em</th></tr>
              </thead>
              <tbody>
                {c.relations.map((rel) => (
                  <tr key={`${rel.id}-${rel.direction}`}>
                    <td>{rel.mock && <MockTag />}{relationLabel(rel)}</td>
                    <td>
                      <Link href={`/intelligence/empresas/${rel.other.id}`} style={{ textDecoration: 'underline' }}>{rel.other.name}</Link>
                      <span className="pt-meta"> · {KIND_LABEL[rel.other.kind]}</span>
                    </td>
                    <td>
                      <a href={rel.source.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>{rel.source.name}</a>
                      <span className="pt-sr"> (abre em nova aba)</span>
                    </td>
                    <td><time dateTime={rel.validatedAt}>{formatDate(rel.validatedAt)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          <EmptyState title="Sem vínculos declarados">Nenhuma fonte pública verificada afirma vínculos desta organização. Ausência de registro não prova inexistência.</EmptyState>
        )}
      </section>

      <section className="pt-section" aria-labelledby="pes-t">
        <div className="pt-section-head"><h2 id="pes-t">Pessoas e cargos</h2></div>
        {people.status === 'unavailable' ? (
          <ErrorState title="Pessoas temporariamente indisponíveis" appearance="inline" retryHref={`/intelligence/empresas/${c.id}`} />
        ) : people.available && people.items.length ? (
          <RolesTable
            showPerson
            testId="company-people"
            caption="Cargos vigentes declarados em fonte pública oficial; nenhum cargo é inferido."
            roles={people.items.flatMap((p) => p.roles.filter((r) => r.company.id === c.id).map((r) => ({ ...r, personId: p.id, personName: p.name })))}
          />
        ) : (
          <EmptyState title="Em breve: executivos verificados">
            Pessoas e cargos só são publicados com identidade e vínculo verificáveis por fonte pública, após a avaliação de privacidade.
          </EmptyState>
        )}
      </section>

      {moves.status === 'ok' && moves.items.length > 0 && (
        <section className="pt-section" aria-labelledby="mov-t">
          <div className="pt-section-head"><h2 id="mov-t">Movimentações confirmadas</h2></div>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }}>
            {moves.items.map((m) => <li key={m.id}><MoveCard m={m} headingLevel={3} /></li>)}
          </ul>
        </section>
      )}

      <p className="pt-meta" style={{ marginTop: 18 }}>
        Informação profissional de fonte pública, com data de validação. Para correção, veja a{' '}
        <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link>.
      </p>
    </>
  );
}
