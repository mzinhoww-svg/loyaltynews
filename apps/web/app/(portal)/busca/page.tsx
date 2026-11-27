import type { Metadata } from 'next';
import { ogDaPaginaPublicada } from '../_seo/paginas';
import { parsePage } from '../_components/Listing';
import { SearchInput } from '../_components/ds-client';
import { WithSidebar } from '../_components/Sidebar';
import { ErrorState } from '../_components/states';
import { ArticleGrid, EmptyState, PageHead, Pager } from '../_components/ui';
import { getSource } from '../_lib/source';
import { MedicaoBusca } from '../_medicao/Medicao';
import { medicaoAtiva } from '../../../lib/portal-medicao';

export async function generateMetadata(): Promise<Metadata> {
  return {
  title: 'Busca',
  description: 'Busque matérias, editorias e temas no Loyalty News.',
  // Resultados de busca não são indexáveis (evita URLs duplicadas, Blueprint §2).
  robots: { index: false, follow: true },
  alternates: { canonical: '/busca' },
  openGraph: await ogDaPaginaPublicada({ title: 'Busca', description: 'Busque matérias, editorias e temas no Loyalty News.', path: '/busca' }),
  };
}

export default async function BuscaPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const result = q ? await getSource().search(q, parsePage(sp.page)) : null;
  return (
    <>
      <PageHead title="Busca" lead="Pesquise por matérias, empresas, programas ou temas." crumbs={[{ label: 'Busca' }]} />
      {/* Sem termo o campo já vem com foco (autofocus do HTML): a lupa do cabeçalho sem JavaScript leva a esta página e cai direto no campo. */}
      <SearchInput action="/busca" defaultValue={q} label="Buscar no portal" autoFocus={!q} />
      {/* Só busca respondida e na primeira página. Vai o termo inteiro da URL: a redação acontece antes de qualquer corte. */}
      {result && !result.unavailable && parsePage(sp.page) === 1 && <MedicaoBusca ligada={medicaoAtiva()} termo={sp.q ?? ''} total={result.total} />}
      <WithSidebar>
        <div aria-live="polite">
          {!result ? (
            <EmptyState title="Digite um termo para buscar">Os resultados vêm da busca no título e no resumo das matérias publicadas, da mais recente para a mais antiga.</EmptyState>
          ) : result.unavailable ? (
            <ErrorState title="Não conseguimos buscar agora" retryHref={`/busca?q=${encodeURIComponent(q)}`}>
              A busca não respondeu; isso não significa que não haja resultados para “{q}”. Tente novamente em instantes.
            </ErrorState>
          ) : result.items.length ? (
            <>
              <p className="pt-meta" data-testid="result-count">{result.total} resultado(s) para “{q}”</p>
              <ArticleGrid items={result.items} cols={3} headingLevel={2} />
              <Pager page={result} basePath="/busca" query={{ q }} />
            </>
          ) : (
            <EmptyState title={`Nenhum resultado para “${q}”`}>
              Tente outro termo ou navegue pelas editorias: a busca procura no título e no resumo das matérias publicadas.
            </EmptyState>
          )}
        </div>
        </WithSidebar>
    </>
  );
}
