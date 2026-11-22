import { getSource } from '../../../_lib/source';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ev = await getSource().getEvent(slug);
  if (!ev) return new Response('Evento não encontrado', { status: 404 });
  const end = ev.endsAt ?? new Date(new Date(ev.startsAt).getTime() + 60 * 60 * 1000).toISOString();
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loyalty News//Agenda//PT-BR',
    'BEGIN:VEVENT',
    `UID:${ev.slug}@loyaltynews`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(ev.startsAt)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(ev.online ? 'Online' : ev.city ?? '')}`,
    `URL:${ev.officialUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return new Response(body, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="${ev.slug}.ics"` },
  });
}
