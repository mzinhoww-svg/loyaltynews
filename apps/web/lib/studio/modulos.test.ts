import { describe, expect, it } from 'vitest';
import { eventoVigente, hojeSP } from './datas';

describe('datas', () => {
  it('hoje em São Paulo respeita o fuso', () => {
    expect(hojeSP(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
  });
  it('evento encerrado sai da lista de vigentes', () => {
    expect(eventoVigente('2026-11-22', '2026-11-22')).toBe(true);
    expect(eventoVigente('2026-11-21', '2026-11-22')).toBe(false);
  });
});
