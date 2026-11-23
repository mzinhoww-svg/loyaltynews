const TZ = 'America/Sao_Paulo';

export function formatDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts }).format(new Date(iso));
}
export function formatDateTime(iso: string): string {
  return formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function monthAbbrev(iso: string): string {
  return formatDate(iso, { month: 'short' }).replace('.', '').toUpperCase();
}
export function dayOf(iso: string): string {
  return formatDate(iso, { day: '2-digit' });
}
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
