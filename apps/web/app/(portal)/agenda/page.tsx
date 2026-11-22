import type { Metadata } from 'next';
import Link from 'next/link';
import { Sidebar } from '../_components/Sidebar';
import { AdSlot, EmptyState, MockTag, PageHead } from '../_components/ui';
import { dayOf, formatDate, formatDateTime, monthAbbrev } from '../_lib/format';
import { getSource } from '../_lib/source';
import type { EventItem } from '../_lib/types';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Agenda',
  description: 'Eventos do mercado de fidelização: congressos, webinars e fóruns verificados.',
  alternates: { canonical: '/agenda' },
};

const FILTERS = [
  { id: 'todos', label: 'Todos' },
  { id: 'presencial', label: 'Presencial' },
  { id: 'online', label: 'Online' },
] as const;

function EventRow({ ev }: { ev: EventItem }) {
  return (
    <li className="ln-event">
      <div className="ln-date" aria-hidden="true">
        <b>{dayOf(ev.startsAt)}</b>
        <span>{monthAbbrev(ev.startsAt)}</span>
      </div>
      <div>
        <h3 style={{ marginBottom: 4 }}>
          {ev.mock && <MockTag />}
          <Link href={`/agenda/${ev.slug}`}>{ev.title}</Link>
        </h3>
        <div className="ln-meta">
          <time dateTime={ev.startsAt}>{formatDateTime(ev.startsAt)}</time> · {ev.online ? 'Online' : ev.city ?? 'Local a confirmar'} · {ev.organizer}
        </div>
      </div>
    </li>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const sp = await searchParams;
  const filtro = FILTERS.find((f) => f.id === sp.filtro)?.id ?? 'todos';
  const all = (await getSource().listEvents())
    .filter((e) => e.status === 'validado')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date();
  const matches = (e: EventItem) => (filtro === 'online' ? e.online : filtro === 'presencial' ? !e.online : true);
  const upcoming = all.filter((e) => new Date(e.startsAt) >= now && matches(e));
  const past = all.filter((e) => new Date(e.startsAt) < now && matches(e)).reverse();

  return (
    <>
      <AdSlot slot="topo" />
      <PageHead
        title="Agenda"
        lead="Eventos do mercado. Só listamos eventos com organizador, data e link oficial verificados."
        crumbs={[{ label: 'Agenda' }]}
      />
      <ul className="ln-chips" aria-label="Filtros">
        {FILTERS.map((f) => (
          <li key={f.id}>
            <Link className="ln-chip" href={f.id === 'todos' ? '/agenda' : `/agenda?filtro=${f.id}`} aria-current={f.id === filtro ? 'true' : undefined}>
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="ln-layout">
        <div>
          <section aria-labelledby="proximos">
            <h2 id="proximos">Próximos eventos</h2>
            {upcoming.length ? (
              <ul className="ln-list" style={{ gap: 0 }}>
                {upcoming.map((e) => <EventRow key={e.slug} ev={e} />)}
              </ul>
            ) : (
              <EmptyState title="Nenhum evento verificado por enquanto">
                A agenda começa vazia de propósito: eventos só entram depois de validação de fonte. Organizadores poderão enviar eventos para moderação quando o cadastro for ativado.
              </EmptyState>
            )}
          </section>
          {past.length > 0 && (
            <section aria-labelledby="passados" style={{ marginTop: 32 }}>
              <h2 id="passados">Eventos passados</h2>
              <ul className="ln-list" style={{ gap: 0 }}>
                {past.map((e) => <EventRow key={e.slug} ev={e} />)}
              </ul>
              <p className="ln-meta">Arquivo até {formatDate(now.toISOString())}.</p>
            </section>
          )}
        </div>
        <Sidebar />
      </div>
    </>
  );
}
