import type { Metadata } from 'next';
import Link from 'next/link';
import { WithSidebar } from './_components/Sidebar';
import { AdSlot, ArticleCard, EmptyState, Section } from './_components/ui';
import { EDITORIAS } from './_lib/editorias';
import { dayOf, monthAbbrev } from './_lib/format';
import { HOME_EDITORIAS, HOME_LIMITS, take } from './_lib/home';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { getSource } from './_lib/source';

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
};

/**
 * Home compacta: Destaques (1 grande + 4 pequenos), Últimas (lista densa), Flash em faixa e até 3 blocos de editoria.
 * Nenhuma matéria se repete entre seções; "Em alta" e "Agenda" só na lateral; seção sem conteúdo some e, sem nada
 * publicado, aparece UM aviso de "primeiras matérias em breve".
 */
export default async function HomePage() {
  const src = getSource();
  const [highlights, latest, flash, events, ...byEditoria] = await Promise.all([
    src.getHighlights(),
    src.getLatest({ pageSize: 24 }),
    src.getLatest({ contentType: 'flash', pageSize: 8 }),
    src.listEvents(),
    ...HOME_EDITORIAS.map((slug) => src.getLatest({ editoriaSlug: slug, pageSize: 8 })),
  ]);

  // Ordem de prioridade na deduplicação: Destaques > Flash > blocos de editoria > Últimas.
  const seen = new Set<string>();
  const hero = take(highlights, seen, 1 + HOME_LIMITS.highlightsSmall);
  const [main, ...side] = hero;
  const flashItems = take(flash.items, seen, HOME_LIMITS.flash);
  const blocks = HOME_EDITORIAS.map((slug, i) => ({
    slug,
    name: EDITORIAS.find((e) => e.slug === slug)?.name ?? slug,
    items: take(byEditoria[i]!.items, seen, HOME_LIMITS.perEditoria),
  })).filter((b) => b.items.length > 0);
  const latestItems = take(latest.items, seen, HOME_LIMITS.latest);
  const nothing = !main && flashItems.length === 0 && blocks.length === 0 && latestItems.length === 0;

  const upcoming = events.filter((e) => e.status === 'validado' && new Date(e.startsAt) >= new Date()).slice(0, 3);
  const agenda =
    upcoming.length > 0 ? (
      <section className="pt-panel" aria-labelledby="home-agenda">
        <h2 id="home-agenda">Agenda</h2>
        <ul className="pt-list">
          {upcoming.map((ev) => (
            <li key={ev.slug} className="pt-event">
              <div className="pt-date" aria-hidden="true">
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
        <Link href="/agenda" className="pt-more">Ver agenda completa →</Link>
      </section>
    ) : undefined;

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

      <WithSidebar extra={agenda}>
        {nothing ? (
          <div className="pt-section">
            <EmptyState title="Em breve: primeiras matérias">
              O Loyalty News está se preparando para publicar. Explore as editorias no menu ou conheça a{' '}
              <Link href="/metodologia">metodologia editorial</Link>.
            </EmptyState>
          </div>
        ) : (
          <>
            {main && (
              <Section title="Destaques" id="destaques">
                <div className="pt-hero">
                  <div className="pt-hero-main">
                    <ArticleCard article={main} size="lg" />
                  </div>
                  <div className="pt-hero-side">
                    {side.map((a) => (
                      <ArticleCard key={a.slug} article={a} size="sm" />
                    ))}
                  </div>
                </div>
              </Section>
            )}

            {latestItems.length > 0 && (
              <Section title="Últimas notícias" id="ultimas" href="/noticias" moreLabel="Ver todas →">
                <div className="pt-dense">
                  {latestItems.map((a) => (
                    <ArticleCard key={a.slug} article={a} size="sm" />
                  ))}
                </div>
              </Section>
            )}

            {flashItems.length > 0 && (
              <Section title="Loyalty Flash" id="flash" href="/flash" moreLabel="Ver todos →">
                <div className="pt-strip">
                  {flashItems.map((a) => (
                    <ArticleCard key={a.slug} article={a} size="compact" />
                  ))}
                </div>
              </Section>
            )}

            <AdSlot slot="entre-secoes" />

            {blocks.map((b) => (
              <Section key={b.slug} title={b.name} href={`/editoria/${b.slug}`} moreLabel="Ver editoria →">
                <div className="pt-grid pt-grid-3">
                  {b.items.map((a) => (
                    <ArticleCard key={a.slug} article={a} size="md" />
                  ))}
                </div>
              </Section>
            ))}
          </>
        )}
      </WithSidebar>
      <AdSlot slot="rodape" />
    </>
  );
}
