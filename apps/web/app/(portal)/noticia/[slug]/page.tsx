import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sidebar } from '../../_components/Sidebar';
import { AdSlot, ArticleGrid, MockTag, Section } from '../../_components/ui';
import { CONTENT_TYPE_LABEL, editoriaName } from '../../_lib/editorias';
import { flags } from '../../_lib/flags';
import { formatDate } from '../../_lib/format';
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
    image: a.image ? [a.image.src] : undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <AdSlot slot="topo" />
      <div className="ln-layout" style={{ marginTop: 24 }}>
        <article className="ln-article">
          <nav className="ln-crumbs" aria-label="Trilha">
            <Link href="/">Início</Link> / <Link href={`/editoria/${a.editoriaSlug}`}>{editoriaName(a.editoriaSlug)}</Link>
          </nav>
          <div className="ln-kicker">
            {a.mock && <MockTag />}
            {CONTENT_TYPE_LABEL[a.contentType]}
            {a.sponsored && (
              <>
                {' '}
                <span className="ln-sponsored">Conteúdo patrocinado</span>
              </>
            )}
          </div>
          <h1>{a.title}</h1>
          {a.subtitle && <p className="ln-article-sub">{a.subtitle}</p>}
          <div className="ln-byline">
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
          {a.image && (
            <figure className="ln-figure">
              <img src={a.image.src} alt={a.image.alt} />
              <figcaption>Crédito: {a.image.credit}</figcaption>
            </figure>
          )}
          <div className="ln-body">
            {a.body.map((b, i) =>
              b.type === 'heading' ? (
                <h2 key={i}>{b.text}</h2>
              ) : b.type === 'quote' ? (
                <blockquote key={i}>
                  {b.text}
                  {b.attribution && <footer className="ln-meta">— {b.attribution}</footer>}
                </blockquote>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
          <AdSlot slot="in-article" />
          <section className="ln-sources" aria-labelledby="fontes">
            <h2 id="fontes" style={{ fontSize: 20 }}>Fontes e referências</h2>
            {a.sources.length ? (
              <ul>
                {a.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noopener noreferrer" target="_blank">{s.label}</a>
                    {s.publishedAt && <span className="ln-meta"> · {formatDate(s.publishedAt)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ln-meta">Fontes não informadas.</p>
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
              <p className="ln-meta">Nenhuma correção registrada. Veja a <Link href="/correcoes" style={{ textDecoration: 'underline' }}>política de correções</Link>.</p>
            )}
          </section>
          {flags.theLoyal && (
            <p>
              <Link className="ln-btn" href="/the-loyal">Receber notícias no The Loyal</Link>
            </p>
          )}
          {related.length > 0 && (
            <Section title="Leia também">
              <ArticleGrid items={related} cols={3} />
            </Section>
          )}
        </article>
        <Sidebar />
      </div>
    </>
  );
}
