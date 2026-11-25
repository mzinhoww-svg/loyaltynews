import { Breadcrumb } from '@ln/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { WithSidebar } from '../../_components/Sidebar';
import { ErrorState } from '../../_components/states';
import { AdSlot, ArticleGrid, MockTag, Section } from '../../_components/ui';
import { CONTENT_TYPE_LABEL, editoriaName } from '../../_lib/editorias';
import { flags } from '../../_lib/flags';
import { formatDate } from '../../_lib/format';
import { linkTerms } from '../../_lib/site-config';
import { jsonLdString } from '../../_lib/jsonld';
import { breadcrumbLd, ogImagemDaEditoria, PUBLISHER_LD } from '../../_lib/seo';
import { SITE_URL } from '../../_lib/site';
import { getSource } from '../../_lib/source';

type Props = { params: Promise<{ slug: string }> };

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';

/** Uma leitura por requisição (metadados e página compartilham o resultado). */
const loadArticle = cache((slug: string) => getSource().getArticle(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { article: a, unavailable } = await loadArticle(slug);
  if (!a) return { title: unavailable ? 'Matéria indisponível' : 'Matéria não encontrada', robots: { index: false } };
  const url = `/noticia/${a.slug}`;
  const imagem = a.image ? { url: a.image.src, alt: a.image.alt } : ogImagemDaEditoria(a.editoriaSlug);
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
      tags: a.tags.length ? a.tags : undefined,
      // Sem imagem própria, vale a imagem da editoria (placeholder até a UI/UX entregar os assets): nunca uma matéria sem og:image.
      images: [imagem],
    },
    twitter: { card: 'summary_large_image', title: a.title, description: a.summary, images: [imagem.url] },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const src = getSource();
  const { article: a, unavailable } = await loadArticle(slug);
  if (!a && unavailable) {
    // A API falhou: não é "matéria inexistente". Página de erro honesta (noindex nos metadados), sem 500 e sem detalhe técnico.
    return (
      <ErrorState title="Não conseguimos carregar esta matéria agora" retryHref={`/noticia/${encodeURIComponent(slug)}`}>
        A matéria não respondeu a tempo. Ela pode existir: tente novamente em instantes ou <Link href="/noticias">veja as últimas notícias</Link>.
      </ErrorState>
    );
  }
  if (!a) notFound();
  const related = await src.getRelated(a, 3);
  // Links internos publicados no Studio: 1ª ocorrência de cada termo vira link (só em parágrafos; nunca em títulos ou citações).
  const linkRules = (await src.getSiteConfig())?.internalLinks ?? [];
  const linked = new Set<string>();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    description: a.summary,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt ?? a.publishedAt,
    articleSection: editoriaName(a.editoriaSlug),
    author: { '@type': 'Organization', name: a.authorLabel },
    publisher: PUBLISHER_LD,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/noticia/${a.slug}` },
    url: `${SITE_URL}/noticia/${a.slug}`,
    inLanguage: 'pt-BR',
    isAccessibleForFree: !a.sponsored,
    ...(a.tags.length ? { keywords: a.tags.join(', ') } : {}),
    // Rich results de matéria exigem imagem: a da matéria ou, sem ela, a da editoria.
    image: [new URL(a.image ? a.image.src : ogImagemDaEditoria(a.editoriaSlug).url, SITE_URL).toString()],
  };
  const crumbs = breadcrumbLd([{ nome: 'Início', path: '/' }, { nome: editoriaName(a.editoriaSlug), path: `/editoria/${a.editoriaSlug}` }, { nome: a.title }]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(crumbs) }} />
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
                <p key={i}>
                  {linkTerms(b.text, linkRules, linked).map((part, j) =>
                    typeof part === 'string' ? part : <Link key={j} href={part.href} data-testid="internal-link">{part.text}</Link>,
                  )}
                </p>
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
