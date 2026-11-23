import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WithSidebar } from '../../_components/Sidebar';
import { MockTag, PageHead } from '../../_components/ui';
import { formatDateTime } from '../../_lib/format';
import { jsonLdString } from '../../_lib/jsonld';
import { getSource } from '../../_lib/source';

type Props = { params: Promise<{ slug: string }> };
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ev = await getSource().getEvent(slug);
  if (!ev) return { title: 'Evento não encontrado', robots: { index: false } };
  return {
    title: ev.title,
    description: `${ev.title} — ${ev.online ? 'online' : ev.city ?? 'local a confirmar'}, organizado por ${ev.organizer}.`,
    alternates: { canonical: `/agenda/${ev.slug}` },
    robots: ev.mock ? { index: false, follow: false } : undefined,
  };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const ev = await getSource().getEvent(slug);
  if (!ev) notFound();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.title,
    startDate: ev.startsAt,
    endDate: ev.endsAt,
    eventStatus: ev.status === 'cancelado' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: ev.online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    location: ev.online ? { '@type': 'VirtualLocation', url: ev.officialUrl } : { '@type': 'Place', name: ev.city ?? '' },
    organizer: { '@type': 'Organization', name: ev.organizer },
    url: ev.officialUrl,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <PageHead title={ev.title} crumbs={[{ label: 'Agenda', href: '/agenda' }, { label: ev.title }]} />
      <WithSidebar>
        <div>
          {ev.mock && <p><MockTag /> Evento sintético de teste.</p>}
          {ev.status === 'cancelado' && <p className="pt-state">Evento cancelado</p>}
          <dl className="pt-panel" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 18px' }}>
            <dt>Quando</dt>
            <dd style={{ margin: 0 }}><time dateTime={ev.startsAt}>{formatDateTime(ev.startsAt)}</time> ({ev.timezone})</dd>
            <dt>Onde</dt>
            <dd style={{ margin: 0 }}>{ev.online ? 'Online' : ev.city ?? 'A confirmar'}</dd>
            <dt>Organizador</dt>
            <dd style={{ margin: 0 }}>{ev.organizer}</dd>
            <dt>Preço</dt>
            <dd style={{ margin: 0 }}>{ev.priceNote ?? 'Não confirmado'}</dd>
            <dt>Fonte</dt>
            <dd style={{ margin: 0 }}><a href={ev.sourceUrl} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>Fonte da informação</a></dd>
          </dl>
          <p style={{ marginTop: 16 }}>
            <a className="ln-btn ln-btn--primary" href={ev.officialUrl} rel="noopener noreferrer" target="_blank">Página oficial do evento</a>{' '}
            <a className="ln-btn ln-btn--ghost" href={`/agenda/${ev.slug}/ics`}>Adicionar ao calendário (.ics)</a>
          </p>
          <p><Link href="/agenda" className="pt-more">← Voltar à agenda</Link></p>
        </div>
        </WithSidebar>
    </>
  );
}
