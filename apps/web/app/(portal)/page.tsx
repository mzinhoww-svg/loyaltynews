import type { Metadata } from 'next';
import Link from 'next/link';
import { Sidebar } from './_components/Sidebar';
import { ErrorState } from './_components/states';
import { AdSlot, Arrow, ArticleCard, ArticleGrid, EmptyState, Section } from './_components/ui';
import { editoriaName } from './_lib/editorias';
import { eventWhere, isUpcoming, noon } from './_lib/events';
import { dayOf, formatDate, monthAbbrev } from './_lib/format';
import { prepareHome } from './_lib/home';
import { jsonLdString } from './_lib/jsonld';
import { PUBLISHER_LD } from './_lib/seo';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from './_lib/site';
import { imagemDoCard } from './_lib/ilustracao';
import { getSource } from './_lib/source';
import { flags } from './_lib/flags';
import type { Article, SiteConfig, SiteEvent } from './_lib/types';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';

/** Título e descrição da home vêm do SEO publicado no Studio (fonte api); sem ele valem os padrões. */
export async function generateMetadata(): Promise<Metadata> {
  const seo = (await getSource().getSiteConfig())?.seo ?? null;
  return {
    title: { absolute: seo?.title ?? `${SITE_NAME} — ${SITE_TAGLINE}` },
    description: seo?.description ?? SITE_DESCRIPTION,
    alternates: { canonical: '/' },
  };
}

/** Blocos de editoria da home (wireframe v1.0): só quatro; as outras seis ficam no menu e nas páginas próprias. */
const HOME_EDITORIAS = ['mercado', 'programas', 'bancos', 'tech'] as const;

function PublishedAgenda({ title, events }: { title?: string; events: SiteEvent[] }) {
  return (
    <section className="pt-panel" aria-labelledby="home-agenda">
      <h2 id="home-agenda" className="pt-panel-title">{title ?? 'Agenda'}</h2>
      <ul className="pt-list">
        {events.map((ev) => (
          <li key={ev.id} className="pt-event">
            <div className="pt-date">
              <b>{dayOf(noon(ev.startsAt))}</b>
              <span>{monthAbbrev(noon(ev.startsAt))}</span>
            </div>
            <div>
              <Link href={`/agenda/${encodeURIComponent(ev.id)}`} className="pt-event-title">{ev.title}</Link>
              <div className="pt-meta">
                {ev.place ?? 'Local a confirmar'} · {formatDate(noon(ev.startsAt), { day: '2-digit', month: 'short' })}
                {ev.sponsored && <> · <span className="pt-sponsored">Patrocinado</span></>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/agenda" className="pt-more">Ver agenda completa<Arrow /></Link>
    </section>
  );
}

/** Home publicada no Studio (fonte api): a ordem, os títulos e as listas são do editor; o portal só deduplica e esconde bloco vazio. */
function PublishedHome({ site }: { site: SiteConfig }) {
  const home = prepareHome(site.home?.blocks ?? []);
  return (
    <>
      {!home.hasContent && (
        <div className="pt-section">
          <EmptyState title="Em breve: primeiras matérias">
            O Loyalty News está se preparando para publicar. Explore as editorias no menu ou veja a <Link href="/sobre">metodologia editorial</Link>.
          </EmptyState>
        </div>
      )}
      {home.hero && (
        <Section title={home.hero.title ?? 'Destaques'} id="destaques">
          <div className={(home.hero.articles[0] ? imagemDoCard(home.hero.articles[0])?.src : undefined) ? 'pt-hero' : 'pt-hero pt-hero--text'}>
            <div className="pt-hero-main">{home.hero.articles[0] && <ArticleCard article={home.hero.articles[0]} size="lg" headingLevel={3} />}</div>
            <div className="pt-hero-side">
              {home.hero.articles.slice(1).map((a) => (
                <ArticleCard key={a.slug} article={a} size="sm" />
              ))}
            </div>
          </div>
        </Section>
      )}
      {(home.sections.length > 0 || home.agenda) && (
        <div className="pt-layout">
          <div className="pt-col">
            {home.sections.map((s) => (
              <Section
                key={s.id}
                id={`bloco-${s.id}`}
                title={s.title ?? (s.kind === 'lista_editoria' && s.editoriaSlug ? editoriaName(s.editoriaSlug) : s.kind === 'ultimas' ? 'Últimas notícias' : 'Destaques')}
                href={s.kind === 'lista_editoria' && s.editoriaSlug ? `/editoria/${s.editoriaSlug}` : s.kind === 'ultimas' ? '/noticias' : undefined}
                moreLabel={s.kind === 'ultimas' ? 'Ver todas' : 'Ver editoria'}
              >
                <ArticleGrid items={s.articles} cols={3} />
              </Section>
            ))}
          </div>
          <div className="pt-col">
            <Sidebar />
            {home.agenda && <PublishedAgenda title={home.agenda.title} events={home.agenda.events} />}
          </div>
        </div>
      )}
    </>
  );
}

// Sem Suspense/esqueleto: sem JavaScript o visitante ficava só com o esqueleto (o conteúdo vinha num bloco escondido que só um script
// troca). A home espera os dados e chega pronta (decisão do PM sobre a recomendação da UI/UX).
export default function HomePage() {
  return <HomeContent />;
}

async function HomeContent() {
  const src = getSource();
  const site = await src.getSiteConfig();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/busca?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  };
  const org = site?.seo?.organization;
  // Organization sempre na home: a publicada no Studio quando existe; senão a padrão do portal (nome, domínio do release e logo padrão).
  const orgLd = org
    ? { '@context': 'https://schema.org', '@type': 'Organization', name: org.name, url: org.url, ...(org.logo ? { logo: org.logo } : {}), ...(org.sameAs.length ? { sameAs: org.sameAs } : {}) }
    : { '@context': 'https://schema.org', ...PUBLISHER_LD };

  // Home publicada no Studio (fonte api): renderiza os blocos do editor.
  if (site?.home) {
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
        {orgLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(orgLd) }} />}
        <h1 className="pt-sr">{SITE_NAME} — {SITE_TAGLINE}</h1>
        <AdSlot slot="topo" />
        <PublishedHome site={site} />
        <AdSlot slot="rodape" />
      </>
    );
  }

  const [highlights, latest, flash, eventList, ...byEditoria] = await Promise.all([
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
  const now = new Date();
  const upcoming = eventList.items.filter((e) => e.status === 'validado' && isUpcoming(e, now)).slice(0, 4);
  const hasContent = hero.length + latestItems.length + flashItems.length + blocks.length > 0;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      {orgLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(orgLd) }} />}
      <h1 className="pt-sr">{SITE_NAME} — {SITE_TAGLINE}</h1>
      <AdSlot slot="topo" />

      {!hasContent && (
        <div className="pt-section">
          {latest.unavailable ? (
            <ErrorState title="Não conseguimos carregar as matérias agora" retryHref="/">
              O portal não conseguiu falar com a redação digital. Isso não significa que não haja matérias: tente novamente em instantes.
            </ErrorState>
          ) : (
            <EmptyState title="Em breve: primeiras matérias">
              O Loyalty News está se preparando para publicar. Explore as editorias no menu ou veja a <Link href="/sobre">metodologia editorial</Link>.
            </EmptyState>
          )}
        </div>
      )}

      {main && (
        <Section title="Destaques" id="destaques">
          <div className={imagemDoCard(main)?.src ? 'pt-hero' : 'pt-hero pt-hero--text'}>
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
            <Section title="Últimas notícias" id="ultimas" href="/noticias" moreLabel="Ver todas">
              <ArticleGrid items={latestItems} cols={3} />
            </Section>
          )}

          {flashItems.length > 0 && (
            <Section title="Loyalty Flash" id="flash" href="/flash" moreLabel="Ver todos">
              <ArticleGrid items={flashItems} cols={3} />
            </Section>
          )}

          <AdSlot slot="entre-secoes" />

          {blocks.map(({ slug, items }) => (
            <Section key={slug} title={editoriaName(slug)} href={`/editoria/${slug}`} moreLabel="Ver editoria">
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
                      <b>{dayOf(noon(ev.startsAt))}</b>
                      <span>{monthAbbrev(noon(ev.startsAt))}</span>
                    </div>
                    <div>
                      <Link href={`/agenda/${encodeURIComponent(ev.slug)}`} className="pt-event-title">{ev.title}</Link>
                      <div className="pt-meta">{eventWhere(ev)}{ev.sponsored ? <> · <span className="pt-sponsored">Patrocinado</span></> : null}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : eventList.unavailable ? (
              <ErrorState appearance="inline" title="Agenda indisponível agora." retryHref="/">Tente novamente em instantes.</ErrorState>
            ) : (
              <p className="pt-meta">Nenhum evento verificado por enquanto.</p>
            )}
            <Link href="/agenda" className="pt-more">Ver agenda completa<Arrow /></Link>
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
