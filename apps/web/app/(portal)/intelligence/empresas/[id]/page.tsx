import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ErrorState } from '../../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../../_components/ui';
import { formatDate } from '../../../_lib/format';
import { KIND_LABEL, relationLabel } from '../../../_lib/intelligence-source';
import { getSource } from '../../../_lib/source';
import { jsonLdString } from '../../../_lib/jsonld';
import { datasetLd } from '../../../_lib/seo';
import { metadadosPagina, urlAbsoluta } from '../../../_seo/paginas';
import { MoveCard, RolesTable } from '../../_components/intel';
import s from '../../_components/intel.module.css';
import { ScrollRegion } from '../../../_components/ScrollRegion';

// Mostra pessoa: sempre dinâmica (PM-2026-11-23-O, DP-38), para uma remoção pedida pelo titular valer na próxima visita.
// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';

const load = cache((id: string) => getSource().getCompany(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await load(id);
  if (r.status === 'not_found') return { title: 'Página não encontrada', robots: { index: false } };
  if (r.status !== 'ok') return { title: 'Empresa — Loyalty Intelligence', robots: { index: false } };
  const c = r.company;
  const n = c.relations.length;
  const vinculos = n ? `${n} ${n === 1 ? 'vínculo declarado' : 'vínculos declarados'}` : 'sem vínculo publicado';
  return metadadosPagina({
    title: `${c.name} — Loyalty Intelligence`,
    description: `${c.name} (${KIND_LABEL[c.kind].toLowerCase()}): ${vinculos} no mercado de fidelização, com fonte pública e data de coleta.`,
    path: `/intelligence/empresas/${c.id}`,
    noindex: c.mock,
  });
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
  // Todos os vínculos com o mesmo rótulo (ex.: as 12 associadas da ABEMF): a coluna "Vínculo" seria a mesma frase em cada linha.
  const umTipo = c.relations.length > 1 && new Set(c.relations.map((x) => relationLabel(x))).size === 1;
  const [people, moves] = await Promise.all([getSource().getPeopleDirectory({ companyId: c.id }), getSource().getMovesFeed({ companyId: c.id })]);
  // Descrição visível do perfil: é ela que lastreia o Dataset (parecer QA 11: os 8 perfis/Move ficaram sem description).
  const descricao = `Perfil público de ${c.name}, ${KIND_LABEL[c.kind].toLowerCase()}, com fonte pública e data de coleta.`;
  // JSON-LD só com o que a página afirma: nome, razão social e a URL canônica. Os vínculos não viram propriedade schema.org
  // ("associada"/"parceria" não equivalem a memberOf/parentOrganization; não inferimos).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: c.name,
    ...(c.legalName !== c.name ? { legalName: c.legalName } : {}),
    url: urlAbsoluta(`/intelligence/empresas/${c.id}`),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(datasetLd({ name: c.name, description: descricao, path: `/intelligence/empresas/${c.id}` })) }} />
      <PageHead title={c.name} lead={descricao} crumbs={[...crumbs, { label: c.name }]} />
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
          <>
          {/* M-02 (revisão completa 25/11): legenda fora da região de rolagem (no celular saía cortada), dica de rolagem visível e a coluna
              "Vínculo" só quando os vínculos são de tipos diferentes (todos iguais = o tipo vai uma vez na legenda, sem repetir em cada linha). */}
          <p className="pt-meta" id="legenda-relations" style={{ margin: '0 0 6px' }}>
            {umTipo ? <><strong>{relationLabel(c.relations[0]!)}</strong> as organizações abaixo. </> : null}
            Somente o que a fonte pública afirma; nenhum vínculo é inferido. Associação ou parceria não indica participação societária.
          </p>
          <p className={`pt-meta ${s.dicaRolagem}`} aria-hidden="true">Deslize a tabela para o lado para ver a fonte e a data.</p>
          <ScrollRegion label="Vínculos declarados, organizações e fontes">
            <table className="pt-table" data-testid="relations" aria-describedby="legenda-relations">
              <thead>
                <tr>{!umTipo && <th scope="col">Vínculo</th>}<th scope="col">Organização</th><th scope="col">Fonte</th><th scope="col">Validado em</th></tr>
              </thead>
              <tbody>
                {c.relations.map((rel) => (
                  <tr key={`${rel.id}-${rel.direction}`}>
                    {!umTipo && <td>{rel.mock && <MockTag />}{relationLabel(rel)}</td>}
                    <td>
                      {umTipo && rel.mock && <MockTag />}
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
          </>
        ) : (
          // Limitado ao que a API publica: vínculo sem fonte validada ou inferido não é exibido, então não se pode dizer que
          // nenhuma fonte no mundo os afirma (medido em fast-track/intelligence-qualidade-2026-11-25.md).
          <EmptyState title="Nenhum vínculo publicado">Nenhum vínculo empresa–empresa declarado com fonte pública validada foi publicado. Vínculos sem fonte validada ou de fonte secundária não são exibidos como fato; ausência aqui não prova inexistência.</EmptyState>
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
          // "Executivo" inventaria qualificação: há pessoas sem cargo declarado e cargos inferidos que não são publicados.
          <EmptyState title="Nenhum cargo declarado com fonte oficial foi publicado para esta empresa">
            Cargos de fonte secundária (The Org) não são exibidos como fato. Pessoas e cargos só são publicados com identidade e vínculo verificáveis por fonte pública, após a avaliação de privacidade.
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
