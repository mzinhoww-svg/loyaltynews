/**
 * Calendário de rituais: dias úteis, feriados nacionais (versionado), fuso America/Sao_Paulo.
 * Datas locais são strings "YYYY-MM-DD"; instantes são `Date` (UTC).
 */

export const HOLIDAY_CALENDAR_VERSION = 'BR-nacional-v1';
/**
 * Anos cobertos: 2026–2027 (operação, testes R4-11) mais 2025 e 2028 como margem para buscas
 * que cruzam a virada de ano (semanal deslocado, primeiro dia útil de janeiro). Fora disso falha fechado.
 */
export const SUPPORTED_YEARS = [2025, 2026, 2027, 2028] as const;

/**
 * Feriados NACIONAIS: 01/01, Sexta-feira Santa, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11,
 * 20/11 (Consciência Negra, nacional desde a Lei 14.759/2023) e 25/12.
 * NÃO inclui pontos facultativos (Carnaval, Quarta de Cinzas, Corpus Christi) nem feriados
 * estaduais/municipais — decisão a ratificar (ver README, "Decisões em aberto").
 */
const FIXED = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function fromDateStr(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`data inválida: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
export function addDays(s: string, n: number): string {
  const d = fromDateStr(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}
/** 0=domingo … 6=sábado */
export function weekdayOf(s: string): number {
  return fromDateStr(s).getUTCDay();
}
export const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Domingo de Páscoa (algoritmo anônimo gregoriano / Meeus). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function nationalHolidays(year: number): string[] {
  const fixed = FIXED.map((md) => `${year}-${md}`);
  const goodFriday = addDays(easterSunday(year), -2);
  return [...fixed, goodFriday].sort();
}

export interface HolidayCalendar {
  readonly version: string;
  isHoliday(date: string): boolean;
}

export function createBrCalendar(extraHolidays: readonly string[] = []): HolidayCalendar {
  const set = new Set<string>(extraHolidays);
  for (const y of SUPPORTED_YEARS) nationalHolidays(y).forEach((h) => set.add(h));
  return {
    version: HOLIDAY_CALENDAR_VERSION,
    isHoliday(date: string) {
      const y = Number(date.slice(0, 4));
      if (!(SUPPORTED_YEARS as readonly number[]).includes(y) && !set.has(date))
        throw new Error(`calendário ${HOLIDAY_CALENDAR_VERSION} não cobre o ano ${y}; versionar um novo calendário`);
      return set.has(date);
    },
  };
}

export function isBusinessDay(date: string, cal: HolidayCalendar): boolean {
  const wd = weekdayOf(date);
  return wd !== 0 && wd !== 6 && !cal.isHoliday(date);
}

/** Primeiro dia útil estritamente depois de `date`. */
export function nextBusinessDay(date: string, cal: HolidayCalendar): string {
  let d = addDays(date, 1);
  while (!isBusinessDay(d, cal)) d = addDays(d, 1);
  return d;
}

/** Soma `n` dias úteis (n=0 devolve a própria data, ou o próximo útil se ela não for útil). */
export function addBusinessDays(date: string, n: number, cal: HolidayCalendar): string {
  let d = date;
  if (n === 0) return isBusinessDay(d, cal) ? d : nextBusinessDay(d, cal);
  for (let i = 0; i < n; i++) d = nextBusinessDay(d, cal);
  return d;
}

export function firstBusinessDayOfMonth(year: number, month1to12: number, cal: HolidayCalendar): string {
  let d = `${year}-${pad(month1to12)}-01`;
  while (!isBusinessDay(d, cal)) d = addDays(d, 1);
  return d;
}

// --- fuso horário -----------------------------------------------------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { date: string; minutes: number }

/** Data e minutos-do-dia locais de um instante. */
export function localPartsOf(instant: Date, tz: string): LocalParts {
  const p = Object.fromEntries(fmt(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Instante UTC de "date HH:MM" no fuso `tz` (resolve o deslocamento com Intl, sem offset fixo). */
export function localToUtc(date: string, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, m);
  let guess = wallAsUtc;
  for (let i = 0; i < 3; i++) {
    const lp = localPartsOf(new Date(guess), tz);
    const [ly, lmo, ld] = lp.date.split('-').map(Number) as [number, number, number];
    const gotWall = Date.UTC(ly, lmo - 1, ld, 0, lp.minutes);
    const diff = wallAsUtc - gotWall;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
