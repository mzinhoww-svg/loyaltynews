import { describe, expect, it } from 'vitest';
import { createCommercialState } from '@ln/commercial';
import { rowsOf } from './repo';

const NOW = '2026-12-05T12:00:00-03:00';
const nova = (positionIds: string[]) => {
  const s = createCommercialState();
  const c = s.campaigns.create({ name: 'M', accountId: 'acc-1', formatId: 'banners--banner-rodape', positionIds, startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
  return { s, c };
};

describe('gravação de campanha com várias posições (PROVISÓRIO até existir campaign_positions)', () => {
  it('uma posição: grava slot_id = a posição, como sempre', () => {
    const { s, c } = nova(['FOOTER']);
    expect(rowsOf(s).campaigns.find((x) => x.id === c.id)).toMatchObject({ slotId: 'FOOTER' });
  });
  it('sem posição: slot_id nulo', () => {
    const { s, c } = nova([]);
    expect(rowsOf(s).campaigns.find((x) => x.id === c.id)).toMatchObject({ slotId: null });
  });
  it('mais de uma posição: RECUSA com erro claro (nada é gravado), em vez de perder posições em silêncio', () => {
    const { s, c } = nova(['FOOTER', 'SIDEBAR_1']);
    expect(() => rowsOf(s)).toThrow(new RegExp(`${c.id}.*2 posições.*campaign_positions`));
  });
});
