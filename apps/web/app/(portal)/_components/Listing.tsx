import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { getSource } from '../_lib/source';
import type { ContentType } from '../_lib/types';
import { WithSidebar } from './Sidebar';
import { ErrorState } from './states';
import { AdSlot, ArticleGrid, EmptyState, PageHead, Pager } from './ui';

export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

interface ListingProps {
  title: string;
  lead?: string;
  basePath: string;
  page: number;
  crumbs?: { label: string; href?: string }[];
  editoriaSlug?: string;
  contentType?: ContentType;
  emptyTitle?: string;
  emptyText?: string;
  showEditoriaChips?: boolean;
}

/** Listagem paginada com estado vazio honesto. Usada por /noticias, formatos e editorias. */
export async function Listing(p: ListingProps) {
  const data = await getSource().getLatest({
    page: p.page,
    pageSize: 12,
    editoriaSlug: p.editoriaSlug,
    contentType: p.contentType,
  });
  return (
    <>
      <AdSlot slot="topo" />
      <PageHead title={p.title} lead={p.lead} crumbs={p.crumbs ?? [{ label: p.title }]} />
      {p.showEditoriaChips && (
        <ul className="pt-chips" aria-label="Editorias">
          {EDITORIAS.map((e) => (
            <li key={e.slug}>
              <Link className="pt-chip" href={`/editoria/${e.slug}`}>
                {e.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <WithSidebar>
        <div>
          {data.unavailable ? (
            <ErrorState title="Não conseguimos carregar as matérias agora" retryHref={p.page > 1 ? `${p.basePath}?page=${p.page}` : p.basePath}>
              Isso não significa que não haja matérias aqui: tente novamente em instantes.
            </ErrorState>
          ) : data.total > 0 && data.items.length === 0 ? (
            <EmptyState title="Não há matérias nesta página">
              A listagem tem {data.total} matéria(s) em outras páginas. <Link href={p.basePath}>Voltar à primeira página</Link>.
            </EmptyState>
          ) : data.items.length ? (
            <>
              <ArticleGrid items={data.items} cols={3} headingLevel={2} />
              <Pager page={data} basePath={p.basePath} />
            </>
          ) : (
            <EmptyState title={p.emptyTitle ?? 'Em breve: primeiras matérias'}>
              {p.emptyText ?? 'Ainda não há matérias publicadas aqui. Quando houver, elas aparecerão em ordem de publicação.'}
            </EmptyState>
          )}
        </div>
        </WithSidebar>
      <AdSlot slot="rodape" />
    </>
  );
}
