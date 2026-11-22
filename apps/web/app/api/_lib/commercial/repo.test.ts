import { describe, expect, it } from 'vitest';
import { AdServer, CampaignBook, Crm, InventoryBook } from '@ln/commercial';
import { ads, camp, crmSeq, inv, maxSeq } from './internals';
import { rowsOf } from './repo';
import { createCommercialState } from '@ln/commercial';

describe('acesso isolado aos campos internos do domínio comercial', () => {
  it('as classes atuais expõem os campos esperados', () => {
    expect(() => inv(new InventoryBook())).not.toThrow();
    expect(() => camp(new CampaignBook())).not.toThrow();
    expect(() => crmSeq(new Crm())).not.toThrow();
    expect(() => ads(new AdServer())).not.toThrow();
  });
  it('se o domínio mudar o formato, falha alto em vez de corromper', () => {
    expect(() => inv({} as InventoryBook)).toThrow(/@ln\/commercial mudou/);
    expect(() => camp({ items: new Map() } as unknown as CampaignBook)).toThrow(/seq/);
  });
  it('maxSeq ignora ids fora do formato prefixo-N', () => {
    expect(maxSeq(['lead-3', 'acc-12', 'opp-7', 'estranho', 'x-y'])).toBe(12);
    expect(maxSeq([])).toBe(0);
  });
  it('estado vazio não gera linha alguma', () => {
    const r = rowsOf(createCommercialState());
    for (const rows of Object.values(r)) expect(rows).toEqual([]);
  });
});
