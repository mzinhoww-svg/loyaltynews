import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { getSource } from '../_lib/source';
import type { ContentType } from '../_lib/types';
import { Sidebar } from './Sidebar';
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
        <ul className="ln-chips" aria-label="Editorias">
          {EDITORIAS.map((e) => (
            <li key={e.slug}>
              <Link className="ln-chip" href={`/editoria/${e.slug}`}>
                {e.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="ln-layout">
        <div>
          {data.items.length ? (
            <>
              <ArticleGrid items={data.items} cols={3} />
              <Pager page={data} basePath={p.basePath} />
            </>
          ) : (
            <EmptyState title={p.emptyTitle ?? 'Em breve: primeiras matérias'}>
              {p.emptyText ?? 'Ainda não há matérias publicadas aqui. Quando houver, elas aparecerão em ordem de publicação.'}
            </EmptyState>
          )}
        </div>
        <Sidebar />
      </div>
      <AdSlot slot="rodape" />
    </>
  );
}
