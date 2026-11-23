import type { Metadata } from 'next';
import Link from 'next/link';
import { Sidebar } from './_components/Sidebar';
import { AdSlot, ArticleCard, ArticleGrid, EmptyState, Section } from './_components/ui';
import { editoriaName } from './_lib/editorias';
import { dayOf, monthAbbrev } from './_lib/format';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { getSource } from './_lib/source';
import { flags } from './_lib/flags';
import type { Article } from './_lib/types';

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
};

/** Blocos de editoria da home (wireframe v1.0): só quatro; as outras seis ficam no menu e nas páginas próprias. */
const HOME_EDITORIAS = ['mercado', 'programas', 'bancos', 'tech'] as const;

export default async function HomePage() {
  const src = getSource();
  const [highlights, latest, flash, events, ...byEditoria] = await Promise.all([
    src.getHighlights(),
    src.getLatest({ pageSize: 12 }),
    src.getLatest({ contentType: 'flash', pageSize: 6 }),
    src.listEvents(),
    ...HOME_EDITORIAS.map((slug) => src.getLatest({ editoriaSlug: slug, pageSize: 6 })),
  ]);

  // Cada matéria aparece uma única vez na home (sem repetir entre Destaques, Últimas, Flash e editorias).
  const seen = new Set<string>();
  const take = (items: Article[], n: number): Article[] => {
    const out: Article[] = [];
    for (const a of items) {
      if (seen.has(a.slug)) continue;
      seen.add(a.slug);
      out.push(a);
      if (out.length === n) break;
    }
    return out;
  };

  const hero = take(highlights, 5);
  const [main, ...secondary] = hero;
  const latestItems = take(latest.items, 6);
  const flashItems = take(flash.items, 4);
  const blocks = HOME_EDITORIAS.map((slug, i) => ({ slug, items: take(byEditoria[i]?.items ?? [], 3) })).filter((b) => b.items.length > 0);
  const upcoming = events.filter((e) => e.status === 'validado' && new Date(e.startsAt) >= new Date()).slice(0, 4);
  const hasContent = hero.length + latestItems.length + flashItems.length + blocks.length > 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/busca?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="pt-sr">{SITE_NAME} — {SITE_TAGLINE}</h1>
      <AdSlot slot="topo" />

      {!hasContent && (
        <div className="pt-section">
          <EmptyState title="Em breve: primeiras matérias">
            O Loyalty News está se preparando para publicar. Explore as editorias no menu ou veja a <Link href="/sobre">metodologia editorial</Link>.
          </EmptyState>
        </div>
      )}

      {main && (
        <Section title="Destaques" id="destaques">
          <div className={main.image?.src ? 'pt-hero' : 'pt-hero pt-hero--text'}>
            <div className="pt-hero-main">
              <ArticleCard article={main} size="lg" headingLevel={3} />
            </div>
            <div className="pt-hero-side">
              {secondary.map((a) => (
                <ArticleCard key={a.slug} article={a} size="sm" />
              ))}
            </div>
          </div>
        </Section>
      )}

      <div className={hasContent ? 'pt-layout' : 'pt-layout pt-layout--solo'}>
        {hasContent && (
        <div className="pt-col">
          {latestItems.length > 0 && (
            <Section title="Últimas notícias" id="ultimas" href="/noticias" moreLabel="Ver todas →">
              <ArticleGrid items={latestItems} cols={3} />
            </Section>
          )}

          {flashItems.length > 0 && (
            <Section title="Loyalty Flash" id="flash" href="/flash" moreLabel="Ver todos →">
              <ArticleGrid items={flashItems} cols={3} />
            </Section>
          )}

          <AdSlot slot="entre-secoes" />

          {blocks.map(({ slug, items }) => (
            <Section key={slug} title={editoriaName(slug)} href={`/editoria/${slug}`} moreLabel="Ver editoria →">
              <ArticleGrid items={items} cols={3} />
            </Section>
          ))}
        </div>
        )}

        <div className="pt-col">
          {hasContent && <Sidebar />}
          <section className="pt-panel" style={hasContent ? { marginTop: 'var(--ln-space-5)' } : undefined} aria-labelledby="home-agenda">
            <h2 id="home-agenda" className="pt-panel-title">Agenda</h2>
            {upcoming.length ? (
              <ul className="pt-list">
                {upcoming.map((ev) => (
                  <li key={ev.slug} className="pt-event">
                    <div className="pt-date">
                      <b>{dayOf(ev.startsAt)}</b>
                      <span>{monthAbbrev(ev.startsAt)}</span>
                    </div>
                    <div>
                      <Link href={`/agenda/${ev.slug}`} className="pt-event-title">{ev.title}</Link>
                      <div className="pt-meta">{ev.online ? 'Online' : ev.city}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-meta">Nenhum evento verificado por enquanto.</p>
            )}
            <Link href="/agenda" className="pt-more">Ver agenda completa →</Link>
          </section>
        </div>
      </div>

      {flags.theLoyal && (
        <section className="pt-hero-band" aria-labelledby="home-loyal">
          <h2 id="home-loyal">The Loyal</h2>
          <p>O que move a fidelidade, no seu e-mail.</p>
          <Link href="/the-loyal" className="ln-btn ln-btn--primary">Quero receber</Link>
        </section>
      )}
      <AdSlot slot="rodape" />
    </>
  );
}
