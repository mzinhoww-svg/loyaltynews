import { describe, expect, it } from 'vitest';
import { createCommercialState } from '@ln/commercial';
import { rowsOf } from './repo';

const NOW = '2026-12-05T12:00:00-03:00';
const nova = (positionIds: string[]) => {
  const s = createCommercialState();
  const c = s.campaigns.create({ name: 'M', accountId: 'acc-1', formatId: 'banners--banner-rodape', positionIds, startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
  return { s, c };
};

// Gravação de campanha com várias posições: campaigns.slot_id = a primeira; todas, em ordem, em campaign_positions.
describe('linhas de campanha com várias posições', () => {
  it('uma posição: slot_id = a posição e uma linha de posição (ordem 0)', () => {
    const { s, c } = nova(['FOOTER']);
    const r = rowsOf(s);
    expect(r.campaigns.find((x) => x.id === c.id)).toMatchObject({ slotId: 'FOOTER' });
    expect(r.campaignPositions.filter((p) => p.campanhaId === c.id)).toEqual([{ id: `${c.id}#FOOTER`, campanhaId: c.id, slotId: 'FOOTER', ordem: 0 }]);
  });
  it('sem posição: slot_id nulo e nenhuma linha de posição', () => {
    const { s, c } = nova([]);
    const r = rowsOf(s);
    expect(r.campaigns.find((x) => x.id === c.id)).toMatchObject({ slotId: null });
    expect(r.campaignPositions.filter((p) => p.campanhaId === c.id)).toEqual([]);
  });
  it('mais de uma posição: TODAS gravadas, na ordem do domínio (nada se perde); slot_id = a primeira', () => {
    const { s, c } = nova(['FOOTER', 'SIDEBAR_1', 'SIDEBAR_2']);
    const r = rowsOf(s);
    expect(r.campaigns.find((x) => x.id === c.id)).toMatchObject({ slotId: 'FOOTER' });
    expect(r.campaignPositions.filter((p) => p.campanhaId === c.id).map((p) => [p.slotId, p.ordem])).toEqual([['FOOTER', 0], ['SIDEBAR_1', 1], ['SIDEBAR_2', 2]]);
  });
});
