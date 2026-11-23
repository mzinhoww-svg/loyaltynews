import { formatDate, formatDateTime } from './format';
import type { EventItem } from './types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Data `YYYY-MM-DD` → instante ao meio-dia de Brasília (evita virar o dia no fuso); ISO com hora fica como está. */
export const noon = (d: string): string => (DATE_ONLY.test(d) ? `${d}T12:00:00-03:00` : d);

/** Fim do evento: para datas sem hora, o fim do último dia (Brasília). */
function endInstant(ev: EventItem): string {
  const end = ev.endsAt ?? ev.startsAt;
  return DATE_ONLY.test(end) ? `${end}T23:59:59-03:00` : end;
}

/** Evento "próximo": com hora, começa daqui para a frente; só com datas, ainda não terminou (evento de hoje conta). */
export function isUpcoming(ev: EventItem, now: Date): boolean {
  return ev.dateOnly ? new Date(endInstant(ev)) >= now : new Date(ev.startsAt) >= now;
}

const DAY = { day: '2-digit', month: 'short', year: 'numeric' } as const;

/** Quando: dia (ou intervalo) para eventos só com data; data e hora com fuso para os demais. Nunca inventa horário. */
export function eventWhen(ev: EventItem): string {
  if (!ev.dateOnly) return `${formatDateTime(ev.startsAt)}${ev.timezone ? ` (${ev.timezone})` : ''}`;
  const a = formatDate(noon(ev.startsAt), DAY);
  const b = ev.endsAt ? formatDate(noon(ev.endsAt), DAY) : a;
  return a === b ? a : `${a} a ${b}`;
}

/** Onde: só o que a fonte informa. */
export function eventWhere(ev: EventItem): string {
  if (ev.online === true) return 'Online';
  return ev.city ?? ev.place ?? 'Local a confirmar';
}
