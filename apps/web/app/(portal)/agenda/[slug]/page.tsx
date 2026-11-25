import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { WithSidebar } from '../../_components/Sidebar';
import { ErrorState } from '../../_components/states';
import { MockTag, PageHead } from '../../_components/ui';
import { eventWhen, eventWhere } from '../../_lib/events';
import { jsonLdString } from '../../_lib/jsonld';
import { metadadosPagina } from '../../_seo/paginas';
import { getSource } from '../../_lib/source';

type Props = { params: Promise<{ slug: string }> };
// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';

/** Uma leitura por requisição (metadados e página compartilham o resultado). */
const loadEvent = cache((slug: string) => getSource().getEvent(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { event: ev, unavailable } = await loadEvent(slug);
  if (!ev) return { title: unavailable ? 'Agenda' : 'Evento não encontrado', robots: { index: false } };
  return metadadosPagina({
    title: ev.title,
    description: `${ev.title} — ${eventWhen(ev)}, ${eventWhere(ev)}.`,
    path: `/agenda/${encodeURIComponent(ev.slug)}`,
    noindex: ev.mock,
  });
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const { event: ev, unavailable } = await loadEvent(slug);
  if (!ev && unavailable) {
    return (
      <>
        <PageHead title="Agenda" crumbs={[{ label: 'Agenda', href: '/agenda' }]} />
        <ErrorState title="Não conseguimos carregar este evento agora" retryHref={`/agenda/${encodeURIComponent(slug)}`}>
          A agenda não respondeu. O evento pode existir: tente novamente em instantes ou <Link href="/agenda">volte à agenda</Link>.
        </ErrorState>
      </>
    );
  }
  if (!ev) notFound();

  // Só o que a fonte publica: sem organizador, modalidade ou local inventados.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.title,
    startDate: ev.startsAt,
    ...(ev.endsAt ? { endDate: ev.endsAt } : {}),
    eventStatus: ev.status === 'cancelado' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    ...(ev.online === true ? { eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' } : ev.online === false ? { eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode' } : {}),
    ...(ev.online === true
      ? ev.officialUrl ? { location: { '@type': 'VirtualLocation', url: ev.officialUrl } } : {}
      : ev.city ?? ev.place ? { location: { '@type': 'Place', name: ev.city ?? ev.place } } : {}),
    ...(ev.organizer ? { organizer: { '@type': 'Organization', name: ev.organizer } } : {}),
    ...(ev.officialUrl ? { url: ev.officialUrl } : {}),
  };
  const row = { margin: 0 } as const;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <PageHead title={ev.title} crumbs={[{ label: 'Agenda', href: '/agenda' }, { label: ev.title }]} />
      <WithSidebar>
        <div>
          {ev.mock && <p><MockTag /> Evento sintético de teste.</p>}
          {ev.status === 'cancelado' && <p className="pt-state">Evento cancelado</p>}
          {ev.sponsored && <p><span className="pt-sponsored" data-testid="event-sponsored">Patrocinado</span> Evento patrocinado: o patrocínio não influencia a seleção editorial.</p>}
          <dl className="pt-panel" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 18px' }}>
            <dt>Quando</dt>
            <dd style={row}><time dateTime={ev.startsAt}>{eventWhen(ev)}</time></dd>
            <dt>Onde</dt>
            <dd style={row}>{eventWhere(ev)}</dd>
            {ev.organizer && (
              <>
                <dt>Organizador</dt>
                <dd style={row}>{ev.organizer}</dd>
              </>
            )}
            {ev.priceNote && (
              <>
                <dt>Preço</dt>
                <dd style={row}>{ev.priceNote}</dd>
              </>
            )}
            {ev.sourceUrl && (
              <>
                <dt>Fonte</dt>
                <dd style={row}><a href={ev.sourceUrl} rel="noopener noreferrer" target="_blank" className="pt-more" style={{ textDecoration: 'underline' }}>Fonte da informação</a></dd>
              </>
            )}
          </dl>
          <p style={{ marginTop: 16 }}>
            {ev.officialUrl && (
              <>
                <a className="ln-btn ln-btn--primary" href={ev.officialUrl} rel="noopener noreferrer" target="_blank">Página oficial do evento</a>{' '}
              </>
            )}
            <a className="ln-btn ln-btn--ghost" href={`/agenda/${encodeURIComponent(ev.slug)}/ics`}>Adicionar ao calendário (.ics)</a>
          </p>
          <p><Link href="/agenda" className="pt-more">← Voltar à agenda</Link></p>
        </div>
      </WithSidebar>
    </>
  );
}
