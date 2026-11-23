import type { Metadata } from 'next';
import Link from 'next/link';
import { Sidebar } from './_components/Sidebar';
import { AdSlot, ArticleCard, ArticleGrid, EmptyState, RankedList, Section } from './_components/ui';
import { EDITORIAS } from './_lib/editorias';
import { dayOf, monthAbbrev } from './_lib/format';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { getSource } from './_lib/source';
import { flags } from './_lib/flags';

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const src = getSource();
  const [highlights, trending, latest, flash, events, ...byEditoria] = await Promise.all([
    src.getHighlights(),
    src.getTrending('24h'),
    src.getLatest({ pageSize: 8 }),
    src.getLatest({ contentType: 'flash', pageSize: 4 }),
    src.listEvents(),
    ...EDITORIAS.map((e) => src.getLatest({ editoriaSlug: e.slug, pageSize: 4 })),
  ]);

  const [main, ...secondary] = highlights;
  const upcoming = events.filter((e) => e.status === 'validado' && new Date(e.startsAt) >= new Date()).slice(0, 4);
  const editoriaBlocks = EDITORIAS.map((e, i) => ({ e, page: byEditoria[i]! })).filter((b) => b.page.items.length > 0);
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

      <Section title="Destaques" id="destaques">
        {main ? (
          <div className="pt-hero">
            <div className="pt-hero-main">
              <ArticleCard article={main} size="lg" />
            </div>
            <div className="pt-hero-side">
              {secondary.slice(0, 5).map((a) => (
                <ArticleCard key={a.slug} article={a} size="sm" />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="Em breve: primeiras matérias">
            O Loyalty News está se preparando para publicar. Enquanto isso, explore as{' '}
            <Link href="#editorias">editorias</Link> ou veja a <Link href="/sobre">metodologia editorial</Link>.
          </EmptyState>
        )}
      </Section>

      <div className="pt-layout">
        <div>
          <Section title="Em alta" id="em-alta" href="/em-alta">
            {trending.length ? (
              <RankedList items={trending.slice(0, 8)} />
            ) : (
              <EmptyState title="Ranking em formação">
                O ranking de mais lidas aparece quando houver matérias publicadas e histórico de leitura suficiente. Nada é simulado.
              </EmptyState>
            )}
          </Section>

          <Section title="Últimas notícias" id="ultimas" href="/noticias" moreLabel="Ver todas →">
            {latest.items.length ? (
              <ArticleGrid items={latest.items} cols={3} />
            ) : (
              <EmptyState title="Em breve: primeiras matérias">As notícias mais recentes aparecerão aqui, em ordem de publicação.</EmptyState>
            )}
          </Section>

          <Section title="Loyalty Flash" id="flash" href="/flash" moreLabel="Ver todos →">
            {flash.items.length ? (
              <ArticleGrid items={flash.items} />
            ) : (
              <EmptyState title="Loyalty Flash em breve">Notas curtas e rápidas sobre o que muda no mercado de fidelização.</EmptyState>
            )}
          </Section>

          <AdSlot slot="entre-secoes" />

          {editoriaBlocks.map(({ e, page }) => (
            <Section key={e.slug} title={e.name} href={`/editoria/${e.slug}`} moreLabel="Ver editoria →">
              <ArticleGrid items={page.items} />
            </Section>
          ))}

          <Section title="Editorias" id="editorias">
            <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {EDITORIAS.map((e) => (
                <li key={e.slug} className="pt-panel">
                  <h3 style={{ marginBottom: 6 }}>
                    <Link href={`/editoria/${e.slug}`}>{e.name}</Link>
                  </h3>
                  <p className="pt-meta" style={{ margin: 0 }}>{e.description}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div>
          <Sidebar />
          <section className="pt-panel" style={{ marginTop: 24 }} aria-labelledby="home-agenda">
            <h2 id="home-agenda" style={{ fontSize: 20 }}>Agenda</h2>
            {upcoming.length ? (
              <ul className="pt-list">
                {upcoming.map((ev) => (
                  <li key={ev.slug} className="pt-event" style={{ borderBottom: 0, padding: 0 }}>
                    <div className="pt-date">
                      <b>{dayOf(ev.startsAt)}</b>
                      <span>{monthAbbrev(ev.startsAt)}</span>
                    </div>
                    <div>
                      <Link href={`/agenda/${ev.slug}`} style={{ fontWeight: 700 }}>{ev.title}</Link>
                      <div className="pt-meta">{ev.online ? 'Online' : ev.city}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-meta">Nenhum evento verificado por enquanto. Eventos só entram após validação de fonte.</p>
            )}
            <Link href="/agenda" className="pt-more">Ver agenda completa →</Link>
          </section>
        </div>
      </div>

      {flags.theLoyal && (
        <section className="pt-hero-band" aria-labelledby="home-loyal">
          <h2 id="home-loyal" style={{ color: '#fff' }}>The Loyal</h2>
          <p>O que move a fidelidade, no seu e-mail.</p>
          <Link href="/the-loyal" className="ln-btn ln-btn--primary">Quero receber</Link>
        </section>
      )}
      <AdSlot slot="rodape" />
    </>
  );
}
