import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../../../_components/ds-client';
import { ErrorState } from '../../../_components/states';
import { EmptyState, MockTag, PageHead } from '../../../_components/ui';
import { formatDate } from '../../../_lib/format';
import { asKind, DIRETORIO_PAGINA, KIND_FILTER_LABEL, KIND_LABEL } from '../../../_lib/intelligence-source';
import { getSource } from '../../../_lib/source';
import { jsonLdString } from '../../../_lib/jsonld';
import { datasetLd } from '../../../_lib/seo';
import { metadadosPagina } from '../../../_seo/paginas';
import s from '../../_components/intel.module.css';

// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática; em execução (PORTAL_SOURCE=api) o Next recusaria
// a busca no-store e serviria a cópia congelada ('static to dynamic at runtime', visto na int/011 e no staging).
export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return metadadosPagina({
    title: 'Empresas — Loyalty Intelligence',
    description: 'Diretório de empresas e programas do mercado de fidelização, com fonte pública e data de validação.',
    path: '/intelligence/empresas',
  });
}

const hrefFor = (tipo?: string, q?: string, pagina?: number) => {
  const qs = new URLSearchParams();
  if (tipo) qs.set('tipo', tipo);
  if (q) qs.set('q', q);
  if (pagina && pagina > 1) qs.set('pagina', String(pagina));
  const s = qs.toString();
  return `/intelligence/empresas${s ? `?${s}` : ''}`;
};

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const kind = asKind(sp.tipo);
  const pagina = Math.max(1, Number.parseInt(sp.pagina ?? '1', 10) || 1);
  const dir = await getSource().getCompanyDirectory({ kind, q: q || undefined, offset: (pagina - 1) * DIRETORIO_PAGINA });
  const paginas = dir.status === 'ok' && dir.total ? Math.ceil(dir.total / dir.limit) : 0;
  const fim = dir.status === 'ok' ? dir.offset + dir.items.length : 0;
  // Três estados, não dois (P2 da auditoria do Senior Auditor, 26/11): com o diretório VAZIO não se culpa o filtro nem se
  // promete "em breve". `kinds` é contado sobre a busca (q) e sem o filtro de tipo: só sem busca a soma zero prova diretório vazio.
  const vazio = dir.status === 'ok' && !q && dir.kinds.reduce((n, k) => n + k.total, 0) === 0;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(datasetLd({
        name: 'Empresas',
        description: 'Companhias, programas e associações do setor. Cada vínculo vem de página pública oficial, com fonte e data de validação.',
        path: '/intelligence/empresas',
      })) }} />
      <PageHead
        title="Empresas"
        lead="Companhias, programas e associações do setor. Cada vínculo vem de página pública oficial, com fonte e data de validação."
        crumbs={[{ label: 'Intelligence', href: '/intelligence' }, { label: 'Empresas' }]}
      />
      <SearchInput action="/intelligence/empresas" label="Buscar empresa" placeholder="Buscar empresa ou programa" defaultValue={q} />
      {dir.status === 'unavailable' ? (
        <ErrorState title="Diretório temporariamente indisponível" retryHref={hrefFor(kind, q, pagina)}>
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
              {/* O total é o do banco, não o desta página: com mais de uma página, a faixa diz o que está na tela. */}
              {paginas > 1 && (
                <p className="pt-meta" data-testid="directory-range">
                  Mostrando {dir.offset + 1}–{fim} de {dir.total}
                </p>
              )}
              <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }} data-testid="company-list">
                {dir.items.map((c) => (
                  <li key={c.id} className="pt-panel">
                    <h2 style={{ fontSize: 20 }}>
                      {c.mock && <MockTag />}
                      <Link href={`/intelligence/empresas/${c.id}`} className={s.touch} data-testid="company-card-link">{c.name}</Link>
                    </h2>
                    <p className="pt-meta">{KIND_LABEL[c.kind]}</p>
                    <p className="pt-meta">
                      {/* Empresa não tem data de validação no schema: o campo é a data de COLETA da fonte. */}
                      {c.relationCount ? `${c.relationCount} ${c.relationCount === 1 ? 'vínculo declarado' : 'vínculos declarados'}` : 'Nenhum vínculo publicado'}
                      {' · '}Coletado em <time dateTime={c.validatedAt}>{formatDate(c.validatedAt)}</time>
                    </p>
                  </li>
                ))}
              </ul>
              {paginas > 1 && (
                <nav aria-label="Paginação do diretório" data-testid="directory-pagination"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                  {pagina > 1 ? (
                    <Link className={s.touch} href={hrefFor(kind, q, pagina - 1)} rel="prev">← Página anterior</Link>
                  ) : <span aria-hidden="true" />}
                  <span className="pt-meta" data-testid="directory-page">Página {pagina} de {paginas}</span>
                  {fim < dir.total ? (
                    <Link className={s.touch} href={hrefFor(kind, q, pagina + 1)} rel="next">Próxima página →</Link>
                  ) : <span aria-hidden="true" />}
                </nav>
              )}
            </>
          ) : paginas > 0 ? (
            // Página fora do intervalo (link antigo, total encolheu): não finge que o filtro não tem resultado.
            <EmptyState title="Esta página não existe mais">
              O diretório tem {dir.total} {dir.total === 1 ? 'organização publicada' : 'organizações publicadas'}{q || kind ? ' com este filtro' : ''} em {paginas} {paginas === 1 ? 'página' : 'páginas'}.
              {' '}<Link className={s.touch} href={hrefFor(kind, q, paginas)} style={{ textDecoration: 'underline' }}>Ir para a última página</Link>.
            </EmptyState>
          ) : vazio ? (
            <EmptyState title="Ainda não há perfis publicados">
              O diretório só publica empresas com fonte primária e data de validação. Perfis candidatos ficam internos até a verificação.
            </EmptyState>
          ) : (
            <EmptyState title="Nenhuma empresa com esse filtro">
              <Link className={s.touch} href="/intelligence/empresas" style={{ textDecoration: 'underline' }}>Ver todas as empresas</Link>
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}
