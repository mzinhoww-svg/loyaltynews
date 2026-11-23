import { Breadcrumb } from '@ln/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WithSidebar } from '../../_components/Sidebar';
import { AdSlot, ArticleGrid, MockTag, Section } from '../../_components/ui';
import { CONTENT_TYPE_LABEL, editoriaName } from '../../_lib/editorias';
import { flags } from '../../_lib/flags';
import { formatDate } from '../../_lib/format';
import { jsonLdString } from '../../_lib/jsonld';
import { SITE_NAME, SITE_URL } from '../../_lib/site';
import { getSource } from '../../_lib/source';

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getSource().getArticle(slug);
  if (!a) return { title: 'Matéria não encontrada', robots: { index: false } };
  const url = `/noticia/${a.slug}`;
  return {
    title: a.title,
    description: a.summary,
    alternates: { canonical: url },
    // Conteúdo MOCK nunca deve ser indexado.
    robots: a.mock ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'article',
      title: a.title,
      description: a.summary,
      url,
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt,
      section: editoriaName(a.editoriaSlug),
      images: a.image ? [{ url: a.image.src, alt: a.image.alt }] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const src = getSource();
  const a = await src.getArticle(slug);
  if (!a) notFound();
  const related = await src.getRelated(a, 3);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    description: a.summary,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt ?? a.publishedAt,
    articleSection: editoriaName(a.editoriaSlug),
    author: { '@type': 'Organization', name: a.authorLabel },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    mainEntityOfPage: `${SITE_URL}/noticia/${a.slug}`,
    image: a.image ? [new URL(a.image.src, SITE_URL).toString()] : undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <AdSlot slot="topo" />
      <WithSidebar>
        <article className="pt-article">
          <Breadcrumb linkAs={Link} items={[{ label: 'Início', href: '/' }, { label: editoriaName(a.editoriaSlug), href: `/editoria/${a.editoriaSlug}` }, { label: a.title }]} />
          <div className="pt-kicker">
            {a.mock && <MockTag />}
            {CONTENT_TYPE_LABEL[a.contentType]}
            {a.sponsored && (
              <>
                {' '}
                <span className="pt-sponsored">Conteúdo patrocinado</span>
              </>
            )}
          </div>
          <h1>{a.title}</h1>
          {a.subtitle && <p className="pt-article-sub">{a.subtitle}</p>}
          <div className="pt-byline">
            <span>{a.authorLabel}</span>
            <span>
              Publicado em <time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time>
            </span>
            {a.updatedAt && (
              <span>
                Atualizado em <time dateTime={a.updatedAt}>{formatDate(a.updatedAt)}</time>
              </span>
            )}
            <span>{a.readingMinutes} min de leitura</span>
          </div>
          {a.corrections.length > 0 && (
            <aside className="pt-correction" role="note" aria-labelledby="aviso-correcao" data-testid="correction-notice">
              <h2 id="aviso-correcao">Matéria corrigida</h2>
              {a.corrections.map((c) => (
                <p key={c.at + c.text}>
                  <time dateTime={c.at}>{formatDate(c.at)}</time>: {c.text}
                </p>
              ))}
              <p className="pt-meta">
                Veja a <Link href="/correcoes" style={{ textDecoration: 'underline' }}>política de correções</Link>.
              </p>
            </aside>
          )}
          {a.image && (
            <figure className="pt-figure" data-testid="article-image">
              <img src={a.image.src} alt={a.image.alt} />
              <figcaption>
                {a.image.label && (
                  <strong className="pt-img-label" data-testid="image-label">
                    {a.image.label}
                  </strong>
                )}
                {a.image.label ? ' · ' : ''}
                Crédito: {a.image.credit}
                {a.image.link && (
                  <>
                    {' · '}
                    <a href={a.image.link} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>fonte da imagem</a>
                  </>
                )}
              </figcaption>
            </figure>
          )}
          <div className="pt-body">
            {a.body.map((b, i) =>
              b.type === 'heading' ? (
                <h2 key={i}>{b.text}</h2>
              ) : b.type === 'quote' ? (
                <blockquote key={i}>
                  {b.text}
                  {b.attribution && <footer className="pt-meta">— {b.attribution}</footer>}
                </blockquote>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
          <AdSlot slot="in-article" />
          <section className="pt-sources" aria-labelledby="fontes">
            <h2 id="fontes" style={{ fontSize: 20 }}>Fontes e referências</h2>
            {a.sources.length ? (
              <ul>
                {a.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noopener noreferrer" target="_blank">{s.label}</a>
                    {s.publishedAt && <span className="pt-meta"> · {formatDate(s.publishedAt)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-meta">Fontes não informadas.</p>
            )}
            <h3 style={{ marginTop: 16 }}>Histórico de correções</h3>
            {a.corrections.length ? (
              <ul>
                {a.corrections.map((c) => (
                  <li key={c.at}>
                    <time dateTime={c.at}>{formatDate(c.at)}</time>: {c.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-meta">Nenhuma correção registrada. Veja a <Link href="/correcoes" style={{ textDecoration: 'underline' }}>política de correções</Link>.</p>
            )}
          </section>
          {flags.theLoyal && (
            <p>
              <Link className="ln-btn ln-btn--primary" href="/the-loyal">Receber notícias no The Loyal</Link>
            </p>
          )}
          {related.length > 0 && (
            <Section title="Leia também">
              <ArticleGrid items={related} cols={3} />
            </Section>
          )}
        </article>
        </WithSidebar>
    </>
  );
}
