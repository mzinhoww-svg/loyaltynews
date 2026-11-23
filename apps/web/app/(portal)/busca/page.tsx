import type { Metadata } from 'next';
import { parsePage } from '../_components/Listing';
import { SearchInput } from '../_components/ds-client';
import { WithSidebar } from '../_components/Sidebar';
import { ArticleGrid, EmptyState, PageHead, Pager } from '../_components/ui';
import { getSource } from '../_lib/source';

export const metadata: Metadata = {
  title: 'Busca',
  description: 'Busque matérias, editorias e temas no Loyalty News.',
  // Resultados de busca não são indexáveis (evita URLs duplicadas, Blueprint §2).
  robots: { index: false, follow: true },
  alternates: { canonical: '/busca' },
};

export default async function BuscaPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 120);
  const result = q ? await getSource().search(q, parsePage(sp.page)) : null;
  return (
    <>
      <PageHead title="Busca" lead="Pesquise por matérias, empresas, programas ou temas." crumbs={[{ label: 'Busca' }]} />
      <SearchInput action="/busca" defaultValue={q} label="Buscar no portal" />
      <WithSidebar>
        <div aria-live="polite">
          {!result ? (
            <EmptyState title="Digite um termo para buscar">Resultados aparecem aqui, por relevância e data de publicação.</EmptyState>
          ) : result.items.length ? (
            <>
              <p className="pt-meta" data-testid="result-count">{result.total} resultado(s) para “{q}”</p>
              <ArticleGrid items={result.items} cols={3} />
              <Pager page={result} basePath="/busca" query={{ q }} />
            </>
          ) : (
            <EmptyState title={`Nenhum resultado para “${q}”`}>
              Tente outro termo ou navegue pelas editorias. Enquanto o portal não tem matérias publicadas, a busca não retorna conteúdo.
            </EmptyState>
          )}
        </div>
        </WithSidebar>
    </>
  );
}
