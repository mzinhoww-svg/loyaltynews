import { describe, expect, it } from 'vitest';
import {
  addBusinessDays, createBrCalendar, easterSunday, firstBusinessDayOfMonth, isBusinessDay, localPartsOf, localToUtc, nationalHolidays, nextBusinessDay, weekdayOf,
} from './calendar';
import { loadRegistries } from './config';
import { occurrencesOn } from './scheduler';

const cal = createBrCalendar();
const { meetings } = loadRegistries();

describe('calendário BR 2026–2027', () => {
  it('Páscoa e Sexta-feira Santa corretas', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(nationalHolidays(2026)).toContain('2026-04-03');
    expect(nationalHolidays(2027)).toContain('2027-03-26');
  });

  it('inclui 20/11 (Consciência Negra) e não inclui Carnaval/Corpus Christi', () => {
    expect(cal.isHoliday('2026-11-20')).toBe(true);
    expect(cal.isHoliday('2027-11-20')).toBe(true);
    expect(cal.isHoliday('2026-02-17')).toBe(false); // terça de Carnaval (ponto facultativo)
    expect(cal.isHoliday('2026-06-04')).toBe(false); // Corpus Christi (ponto facultativo)
    expect(nationalHolidays(2026)).toHaveLength(10);
  });

  it('falha fechado fora dos anos versionados', () => {
    expect(() => cal.isHoliday('2029-01-03')).toThrow(/não cobre/);
  });

  it('dias úteis e primeiro dia útil do mês', () => {
    expect(isBusinessDay('2026-11-21', cal)).toBe(false); // sábado
    expect(nextBusinessDay('2026-11-19', cal)).toBe('2026-11-23'); // pula 20/11 e o fim de semana
    expect(firstBusinessDayOfMonth(2026, 12, cal)).toBe('2026-12-01');
    expect(firstBusinessDayOfMonth(2026, 5, cal)).toBe('2026-05-04'); // 01/05 é sexta feriado
    expect(firstBusinessDayOfMonth(2027, 1, cal)).toBe('2027-01-04'); // 01/01 sexta feriado + fim de semana
    expect(addBusinessDays('2026-11-19', 1, cal)).toBe('2026-11-23');
    expect(addBusinessDays('2026-11-19', 0, cal)).toBe('2026-11-19');
    expect(addBusinessDays('2026-11-20', 0, cal)).toBe('2026-11-23');
  });

  it('fuso: 06:00 em São Paulo = 09:00Z e vice-versa', () => {
    const t = localToUtc('2026-11-23', '06:00', 'America/Sao_Paulo');
    expect(t.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect(localPartsOf(t, 'America/Sao_Paulo')).toEqual({ date: '2026-11-23', minutes: 360 });
    // 02:30Z ainda é o dia anterior em São Paulo
    expect(localPartsOf(new Date('2026-11-23T02:30:00Z'), 'America/Sao_Paulo').date).toBe('2026-11-22');
  });
});

describe('ocorrências de rituais (R4-11: calendário 2026–2027)', () => {
  const ids = (date: string) => occurrencesOn(meetings, date, cal).map((o) => o.meeting.id);

  it('segunda comum: 18 dailies + W-pautas + W-cross; X-incident nunca é agendado', () => {
    const list = ids('2026-11-23');
    expect(list.filter((i) => i.startsWith('D-'))).toHaveLength(18);
    expect(list).toEqual(expect.arrayContaining(['W-pautas', 'W-cross']));
    expect(list).not.toContain('X-incident');
  });

  it('nenhum ritual agendado em feriado nacional ou fim de semana (2026–2027)', () => {
    for (const y of [2026, 2027]) {
      for (const h of nationalHolidays(y)) expect(ids(h), h).toEqual([]);
    }
    for (const d of ['2026-11-21', '2026-11-22']) expect(ids(d)).toEqual([]);
  });

  it('semanal que cai em feriado vai para o próximo dia útil (segunda feriado -> terça)', () => {
    expect(weekdayOf('2027-11-15')).toBe(1);
    expect(ids('2027-11-15')).toEqual([]);
    expect(ids('2027-11-16')).toEqual(expect.arrayContaining(['W-pautas', 'W-cross']));
  });

  it('sexta feriado: W-performance e W-finops migram para segunda', () => {
    expect(ids('2026-11-20')).toEqual([]);
    expect(ids('2026-11-23')).toEqual(expect.arrayContaining(['W-performance', 'W-finops']));
    expect(ids('2026-11-27')).toEqual(expect.arrayContaining(['W-performance', 'W-finops']));
    // e só uma vez na semana seguinte (não duplica)
    expect(ids('2026-11-24').filter((i) => i === 'W-performance')).toHaveLength(0);
  });

  it('mensais só no primeiro dia útil', () => {
    expect(ids('2026-12-01')).toEqual(expect.arrayContaining(['M-board', 'M-model', 'M-commercial']));
    expect(ids('2026-12-02')).not.toContain('M-board');
    expect(ids('2027-01-04')).toEqual(expect.arrayContaining(['M-board']));
    expect(ids('2027-01-05')).not.toContain('M-board');
  });

  it('horários do ADR-014 em UTC (São Paulo UTC-3)', () => {
    const t = (id: string) => occurrencesOn(meetings, '2026-11-23', cal).find((o) => o.meeting.id === id)!.scheduledFor.toISOString().slice(11, 16);
    expect(t('D-mercado')).toBe('09:00');
    expect(t('D-intelligence')).toBe('09:10');
    expect(t('D-editorial')).toBe('09:20');
    expect(t('D-creative')).toBe('09:40');
    expect(t('D-growth')).toBe('09:45');
    expect(t('D-trust')).toBe('10:15');
    expect(t('D-sync')).toBe('10:25');
    expect(t('D-technology')).toBe('11:15');
    expect(t('D-commercial')).toBe('11:30');
  });
});
