import Link from 'next/link';
import type { ReactNode } from 'react';
import { CONTENT_TYPE_LABEL, editoriaName } from '../_lib/editorias';
import { formatDate } from '../_lib/format';
import type { AdSlotId, Article, Page } from '../_lib/types';
import { getSource } from '../_lib/source';

export function MockTag() {
  return <span className="ln-mocktag">MOCK</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ln-empty" role="status">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
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
    <div className="ln-pagehead">
      {crumbs && (
        <nav className="ln-crumbs" aria-label="Trilha">
          <Link href="/">Início</Link>
          {crumbs.map((c) => (
            <span key={c.label}>
              {' / '}
              {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
            </span>
          ))}
        </nav>
      )}
      <h1>{title}</h1>
      {lead && <p className="ln-lead">{lead}</p>}
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
    <section className="ln-section" aria-labelledby={id ? `${id}-t` : undefined} id={id}>
      <div className="ln-section-head">
        <h2 id={id ? `${id}-t` : undefined}>{title}</h2>
        {href && (
          <Link href={href} className="ln-more">
            {moreLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function ArticleCard({ article, withSummary = true }: { article: Article; withSummary?: boolean }) {
  return (
    <article className="ln-card">
      <Link href={`/noticia/${article.slug}`} className="ln-card-img" aria-hidden="true" tabIndex={-1}>
        {article.image ? <img src={article.image.src} alt="" loading="lazy" /> : <span>{editoriaName(article.editoriaSlug)}</span>}
      </Link>
      <div className="ln-kicker">
        {editoriaName(article.editoriaSlug)} · {CONTENT_TYPE_LABEL[article.contentType]}
        {article.sponsored && (
          <>
            {' '}
            <span className="ln-sponsored">Patrocinado</span>
          </>
        )}
      </div>
      <h3>
        <Link href={`/noticia/${article.slug}`}>{article.title}</Link>
      </h3>
      {withSummary && <p>{article.summary}</p>}
      <div className="ln-meta">
        {article.authorLabel} · <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      </div>
    </article>
  );
}

export function ArticleGrid({ items, cols = 4 }: { items: Article[]; cols?: 3 | 4 }) {
  return (
    <div className={cols === 3 ? 'ln-grid ln-grid-3' : 'ln-grid'}>
      {items.map((a) => (
        <ArticleCard key={a.slug} article={a} />
      ))}
    </div>
  );
}

export function RankedList({ items }: { items: Article[] }) {
  return (
    <ol className="ln-list" style={{ listStyle: 'none', padding: 0 }}>
      {items.map((a, i) => (
        <li key={a.slug} className="ln-rank">
          <span className="ln-rank-n" aria-hidden="true">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div>
            <div className="ln-kicker">{editoriaName(a.editoriaSlug)}</div>
            <Link href={`/noticia/${a.slug}`} style={{ fontFamily: 'var(--ln-editorial)', fontWeight: 700 }}>
              {a.title}
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Pager simples por querystring; o caminho base já pode conter outros parâmetros. */
export function Pager({ page, basePath, query }: { page: Page<unknown>; basePath: string; query?: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (pages <= 1) return null;
  const href = (n: number) => {
    const p = new URLSearchParams(query);
    if (n > 1) p.set('page', String(n));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className="ln-pager" aria-label="Paginação">
      {page.page > 1 && (
        <Link className="ln-chip" href={href(page.page - 1)} rel="prev">
          ← Anterior
        </Link>
      )}
      <span className="ln-chip" aria-current="page">
        Página {page.page} de {pages}
      </span>
      {page.page < pages && (
        <Link className="ln-chip" href={href(page.page + 1)} rel="next">
          Próxima →
        </Link>
      )}
    </nav>
  );
}

export const AD_SIZES: Record<AdSlotId, { w: number; h: number; label: string }> = {
  topo: { w: 1280, h: 150, label: 'Banner topo' },
  'entre-secoes': { w: 1280, h: 150, label: 'Entre seções' },
  'sidebar-1': { w: 336, h: 280, label: 'Sidebar 1' },
  'sidebar-2': { w: 336, h: 280, label: 'Sidebar 2' },
  'sidebar-3': { w: 336, h: 280, label: 'Sidebar 3' },
  'in-article': { w: 728, h: 90, label: 'In-article' },
  rodape: { w: 1280, h: 200, label: 'Banner rodapé' },
};

/**
 * Espaço publicitário. Sem criativo vendido/aprovado no inventário, não renderiza nada
 * (nenhum "posição reservada" em produção). Com criativo, reserva a dimensão para evitar CLS
 * e rotula como publicidade.
 */
export async function AdSlot({ slot }: { slot: AdSlotId }) {
  const ad = await getSource().getAd(slot);
  if (!ad) return null;
  const size = AD_SIZES[slot];
  return (
    <aside aria-label="Publicidade" style={{ margin: '16px 0' }}>
      <div className="ln-meta" style={{ textAlign: 'center' }}>Publicidade · {ad.advertiser}</div>
      <a href={ad.href} rel="sponsored noopener" style={{ display: 'block', maxWidth: size.w, aspectRatio: `${size.w} / ${size.h}`, margin: '0 auto' }}>
        <img src={ad.imageSrc} alt={ad.alt} width={size.w} height={size.h} />
      </a>
    </aside>
  );
}
