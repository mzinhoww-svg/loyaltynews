import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CampaignStatus } from '@ln/contracts';
import { createTestDb } from './testing';
import * as s from './schema';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(s.adFormats).values({
    id: 'banners--banner-topo', secao: 'Banners', nome: 'Banner topo', referenciaBrl: '3.000/mês', escopo: '1280 × 150',
    precoTipo: 'fixo', precoValorBrl: '3000', unidade: 'mes',
  });
  await t.db.insert(s.adSlots).values({ id: 'top', posicao: 'TOP', formatoId: 'banners--banner-topo', dimensaoDesktop: '1280×150', limiteCotas: 4, contratoMinimoDias: 90 });
  await t.db.insert(s.crmAccounts).values({ id: 'c1', nome: 'Anunciante Teste' });
});
afterAll(async () => {
  await t.close();
});

describe('módulo comercial (0003_commercial)', () => {
  it('formato novo nasce indisponível', async () => {
    const r = await t.client.query<{ d: string }>("select disponibilidade d from ad_formats where id = 'banners--banner-topo'");
    expect(r.rows[0]?.d).toBe('indisponivel');
  });

  it('campanha usa os 7 estados do Blueprint, iguais aos do contrato, com draft por padrão', async () => {
    const r = await t.client.query<{ v: string }>("select unnest(enum_range(null::campanha_status))::text v");
    expect(r.rows.map((x) => x.v)).toEqual([...CampaignStatus.options]);
    await t.db.insert(s.campaigns).values({ id: 'k1', nome: 'Camp', contaId: 'c1', formatoId: 'banners--banner-topo', inicio: '2026-12-01', fim: '2026-12-31' });
    const k = await t.client.query<{ status: string }>("select status from campaigns where id = 'k1'");
    expect(k.rows[0]?.status).toBe('draft');
    await expect(t.client.query("update campaigns set status = 'rascunho' where id = 'k1'")).rejects.toThrow();
  });

  it('posição reservável exige contrato mínimo em dias', async () => {
    await expect(
      t.db.insert(s.adSlots).values({ id: 'x', posicao: 'FOOTER', formatoId: 'banners--banner-topo', dimensaoDesktop: '1280×200', limiteCotas: 6 }),
    ).rejects.toThrow();
  });

  it('lead nunca tem opt-in implícito e é classe personal', async () => {
    await t.db.insert(s.crmLeads).values({ id: 'l1', nome: 'N', empresa: 'E', email: 'n@e.com', objetivo: 'o', consentimentoEm: new Date() });
    const r = await t.client.query<{ o: boolean; c: string }>("select opt_in_newsletter o, classe_de_dado c from crm_leads where id = 'l1'");
    expect(r.rows[0]).toEqual({ o: false, c: 'personal' });
  });

  it('métrica disponível exige valor, período e coleta; indisponível pode ficar vazia', async () => {
    await t.db.insert(s.commercialMetrics).values({ id: 'm1', origem: 'ga4', metrica: 'usuarios_30min', status: 'unavailable', versaoMetodologia: 'v1' });
    await expect(
      t.db.insert(s.commercialMetrics).values({ id: 'm2', origem: 'ga4', metrica: 'sessoes', status: 'available', versaoMetodologia: 'v1' }),
    ).rejects.toThrow();
  });
});

describe('integridade do ad server (0011_ad_integridade)', () => {
  it('watermark só avança (upsert com GREATEST)', async () => {
    const up = (v: number) => t.client.query(
      "INSERT INTO ad_redis_watermark (id, value) VALUES ('ln:ad:hb', $1) ON CONFLICT (id) DO UPDATE SET value = GREATEST(ad_redis_watermark.value, EXCLUDED.value), at = now()", [v]);
    await up(10); await up(7); await up(12);
    const r = await t.client.query<{ v: string }>("SELECT value::text v FROM ad_redis_watermark WHERE id = 'ln:ad:hb'");
    expect(r.rows[0]?.v).toBe('12');
  });
  it('lacuna exige from <= servedUntil <= to e contadores não negativos', async () => {
    const base = { id: 'g1', reason: 'dedupe_perdido' as const, from: new Date('2026-11-22T10:00:00Z'), servedUntil: new Date('2026-11-22T10:05:00Z'), to: new Date('2026-11-22T12:05:00Z'), detectedAt: new Date('2026-11-22T10:05:00Z') };
    await t.db.insert(s.adDeliveryGaps).values(base);
    await expect(t.db.insert(s.adDeliveryGaps).values({ ...base, id: 'g2', to: new Date('2026-11-22T09:00:00Z') })).rejects.toThrow();
    await expect(t.db.insert(s.adDeliveryGaps).values({ ...base, id: 'g3', uncountedServes: -1 })).rejects.toThrow();
  });
});
