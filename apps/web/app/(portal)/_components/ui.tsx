import {
  AdSlot as DsAdSlot,
  ArticleCard as DsArticleCard,
  Breadcrumb,
  EmptyState as DsEmptyState,
  MockBadge,
  Pagination,
  type AdPosition,
} from '@ln/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { editoriaName } from '../_lib/editorias';
import { getSource } from '../_lib/source';
import type { AdSlotId, Article, Page } from '../_lib/types';

/** Selo compacto "MOCK" visível + texto completo só para leitor de tela ("MOCK · dados de exemplo"; Security R5). */
export function MockTag() {
  return (
    <>
      <MockBadge label="" />
      <span className="pt-sr"> · dados de exemplo</span>
    </>
  );
}

/** Estado vazio honesto (DS `EmptyState`), discreto por padrão: uma linha, sem caixa. */
export function EmptyState({ title, children, appearance = 'inline' }: { title: string; children?: ReactNode; appearance?: 'inline' | 'box' }) {
  return <DsEmptyState title={title} description={children} appearance={appearance} />;
}

export function PageHead({
  title,
  lead,
  crumbs,
}: {
  title: string;
  lead?: string;
  crumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="pt-pagehead">
      {crumbs && <Breadcrumb linkAs={Link} items={[{ label: 'Início', href: '/' }, ...crumbs]} />}
      <h1>{title}</h1>
      {lead && <p className="pt-lead">{lead}</p>}
    </div>
  );
}

export function Section({
  title,
  href,
  moreLabel = 'Ver mais →',
  id,
  children,
}: {
  title: string;
  href?: string;
  moreLabel?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-section" aria-labelledby={id ? `${id}-t` : undefined} id={id}>
      <div className="pt-section-head">
        <h2 id={id ? `${id}-t` : undefined}>{title}</h2>
        {href && (
          <Link href={href} className="pt-more">
            {moreLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

type CardSize = 'lg' | 'md' | 'sm' | 'compact';

/** Adapta o `Article` do portal ao `ArticleCard` do design system. */
export function ArticleCard({
  article,
  size = 'md',
  rank,
  headingLevel = 3,
}: {
  article: Article;
  size?: CardSize;
  rank?: number;
  headingLevel?: 2 | 3 | 4;
}) {
  const nome = editoriaName(article.editoriaSlug);
  return (
    <DsArticleCard
      title={article.title}
      href={`/noticia/${article.slug}`}
      size={size}
      editoria={{ slug: article.editoriaSlug, nome }}
      excerpt={article.summary}
      publishedAt={article.publishedAt}
      readingMinutes={article.readingMinutes}
      author={article.authorLabel}
      imageSrc={article.image?.src}
      imageAlt={article.image?.alt}
      imageLabel={article.image?.label ?? undefined}
      headingLevel={headingLevel}
      rank={rank}
      isMock={article.mock}
      linkAs={Link}
    />
  );
}

/** `headingLevel`: use 2 quando a grade vem logo abaixo do h1 (listagens); 3 dentro de uma Section (h2). */
export function ArticleGrid({ items, cols = 4, headingLevel = 3 }: { items: Article[]; cols?: 3 | 4; headingLevel?: 2 | 3 | 4 }) {
  return (
    <div className={cols === 3 ? 'pt-grid pt-grid-3' : 'pt-grid'}>
      {items.map((a) => (
        <ArticleCard key={a.slug} article={a} headingLevel={headingLevel} />
      ))}
    </div>
  );
}

export function RankedList({ items, headingLevel = 3 }: { items: Article[]; headingLevel?: 2 | 3 | 4 }) {
  return (
    <ol className="pt-list">
      {items.map((a, i) => (
        <li key={a.slug}>
          <ArticleCard article={a} size="compact" rank={i + 1} headingLevel={headingLevel} />
        </li>
      ))}
    </ol>
  );
}

/** Paginação por querystring com links reais (DS `Pagination`). */
export function Pager({ page, basePath, query }: { page: Page<unknown>; basePath: string; query?: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const href = (n: number) => {
    const p = new URLSearchParams(query);
    if (n > 1) p.set('page', String(n));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return <Pagination page={page.page} totalPages={pages} hrefFor={href} linkAs={Link} />;
}

const AD_POSITION: Record<AdSlotId, AdPosition> = {
  topo: 'TOP',
  'entre-secoes': 'HOME_BETWEEN',
  'sidebar-1': 'SIDEBAR_1',
  'sidebar-2': 'SIDEBAR_2',
  'sidebar-3': 'SIDEBAR_3',
  'in-article': 'ARTICLE_INLINE',
  rodape: 'FOOTER',
};

/**
 * Espaço publicitário. Sem criativo no inventário não renderiza nada (o placeholder do DS não é
 * usado em produção). Com criativo, usa o `AdSlot` do DS (rotulado "Publicidade", dimensão reservada).
 */
export async function AdSlot({ slot }: { slot: AdSlotId }) {
  const ad = await getSource().getAd(slot);
  if (!ad) return null;
  return (
    <DsAdSlot position={AD_POSITION[slot]}>
      <a href={ad.href} rel="sponsored noopener">
        <img src={ad.imageSrc} alt={ad.alt} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </a>
    </DsAdSlot>
  );
}
