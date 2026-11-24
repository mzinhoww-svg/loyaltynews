import { getSource } from '../../../_lib/source';

// Dinâmica e explícita: evento em no-store até haver purge automático (política de cache do portal; um revalidate/ISR sobrescreveria o cabeçalho).
export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = (d: string) => d.replace(/-/g, '');
/** Dia seguinte (DTEND de evento de dia inteiro é exclusivo). */
const nextDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, '');
};
/** Nome de arquivo seguro: o id do evento vem da URL. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'evento';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const { event: ev, unavailable } = await getSource().getEvent(slug);
  if (!ev) {
    // API fora do ar não é "evento inexistente", mas a rota .ics não tem corpo para estado de erro: 503 curto, sem detalhe.
    return new Response(unavailable ? 'Agenda indisponível no momento' : 'Evento não encontrado', {
      status: unavailable ? 503 : 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...(unavailable ? { 'retry-after': '60' } : {}) },
    });
  }
  const when = ev.dateOnly
    ? [`DTSTART;VALUE=DATE:${day(ev.startsAt)}`, `DTEND;VALUE=DATE:${nextDay(ev.endsAt ?? ev.startsAt)}`]
    : [
        `DTSTART:${utc(ev.startsAt)}`,
        `DTEND:${utc(ev.endsAt ?? new Date(new Date(ev.startsAt).getTime() + 60 * 60 * 1000).toISOString())}`,
      ];
  const where = ev.online === true ? 'Online' : ev.city ?? ev.place ?? '';
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loyalty News//Agenda//PT-BR',
    'BEGIN:VEVENT',
    `UID:${safe(ev.slug)}@loyaltynews`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    ...when,
    `SUMMARY:${esc(ev.title)}`,
    ...(where ? [`LOCATION:${esc(where)}`] : []),
    ...(ev.officialUrl ? [`URL:${ev.officialUrl}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return new Response(body, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="${safe(ev.slug)}.ics"` },
  });
}
