import type { Metadata } from 'next';
import Link from 'next/link';
import { WithSidebar } from '../_components/Sidebar';
import { ErrorState } from '../_components/states';
import { AdSlot, EmptyState, MockTag, PageHead } from '../_components/ui';
import { eventWhen, eventWhere, isUpcoming, noon } from '../_lib/events';
import { dayOf, monthAbbrev } from '../_lib/format';
import { getSource } from '../_lib/source';
import type { EventItem } from '../_lib/types';

// Dinâmica: a fonte api lê com cache 'no-store'; com revalidate o Next congelaria no build a cópia sem API ("Page changed from static to dynamic at runtime").
export const dynamic = 'force-dynamic';
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
    <li className="pt-event" data-testid="event-row">
      <div className="pt-date" aria-hidden="true">
        <b>{dayOf(noon(ev.startsAt))}</b>
        <span>{monthAbbrev(noon(ev.startsAt))}</span>
      </div>
      <div>
        <h3 style={{ marginBottom: 4 }}>
          {ev.mock && <MockTag />}
          <Link href={`/agenda/${encodeURIComponent(ev.slug)}`}>{ev.title}</Link>
        </h3>
        <div className="pt-meta">
          <time dateTime={ev.startsAt}>{eventWhen(ev)}</time> · {eventWhere(ev)}
          {ev.organizer ? <> · {ev.organizer}</> : null}
          {ev.sponsored ? <> · <span className="pt-sponsored">Patrocinado</span></> : null}
        </div>
      </div>
    </li>
  );
}

async function AgendaList({ filtro }: { filtro: (typeof FILTERS)[number]['id'] }) {
  const list = await getSource().listEvents();
  const all = list.items.filter((e) => e.status === 'validado').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date();
  // Modalidade desconhecida (a fonte não informa) só aparece em "Todos": nunca é classificada por palpite.
  const matches = (e: EventItem) => (filtro === 'online' ? e.online === true : filtro === 'presencial' ? e.online === false : true);
  const upcoming = all.filter((e) => isUpcoming(e, now) && matches(e));
  const past = all.filter((e) => !isUpcoming(e, now) && matches(e)).reverse();

  return (
    <div>
      {list.unavailable ? (
        <ErrorState title="Não conseguimos carregar a agenda agora" retryHref={filtro === 'todos' ? '/agenda' : `/agenda?filtro=${filtro}`}>
          A agenda não respondeu. Isso não significa que não haja eventos: tente novamente em instantes.
        </ErrorState>
      ) : (
        <>
          <section aria-labelledby="proximos">
            <h2 id="proximos">Próximos eventos</h2>
            {upcoming.length ? (
              <ul className="pt-list" style={{ gap: 0 }}>
                {upcoming.map((e) => <EventRow key={e.slug} ev={e} />)}
              </ul>
            ) : (
              <EmptyState title="Nenhum evento verificado por enquanto">
                {filtro === 'todos'
                  ? 'A agenda começa vazia de propósito: eventos só entram depois de aprovação da redação. Organizadores poderão sugerir eventos para moderação quando o cadastro for ativado.'
                  : 'Nenhum evento deste tipo na agenda no momento. Veja todos os eventos.'}
              </EmptyState>
            )}
          </section>
          {past.length > 0 && (
            <section aria-labelledby="passados" style={{ marginTop: 32 }}>
              <h2 id="passados">Eventos passados</h2>
              <ul className="pt-list" style={{ gap: 0 }}>
                {past.map((e) => <EventRow key={e.slug} ev={e} />)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const sp = await searchParams;
  const filtro = FILTERS.find((f) => f.id === sp.filtro)?.id ?? 'todos';
  return (
    <>
      <AdSlot slot="topo" />
      <PageHead
        title="Agenda"
        lead="Eventos do mercado. Só listamos eventos aprovados pela redação, com data e fonte verificadas."
        crumbs={[{ label: 'Agenda' }]}
      />
      <ul className="pt-chips" aria-label="Filtros">
        {FILTERS.map((f) => (
          <li key={f.id}>
            <Link className="pt-chip" href={f.id === 'todos' ? '/agenda' : `/agenda?filtro=${f.id}`} aria-current={f.id === filtro ? 'true' : undefined}>
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
      <WithSidebar>
        {/* Sem Suspense/esqueleto: sem JavaScript o esqueleto ficava no lugar da lista (decisão do PM sobre a recomendação da UI/UX). */}
        <AgendaList filtro={filtro} />
      </WithSidebar>
    </>
  );
}
