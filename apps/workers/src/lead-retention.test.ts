import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { DESCARTADO_DIAS, NAO_CONVERTIDO_MESES, purgeLeads, startLeadRetention } from './lead-retention';

// Retenção do lead (DP-55): não convertido 12 meses após o último contato; descartado 30 dias após o descarte; convertido nunca.
const NOW = new Date('2026-11-25T12:00:00Z');
const dias = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let t: Awaited<ReturnType<typeof createTestDb>>;
const db = () => t.db as unknown as Db;
beforeEach(async () => { t = await createTestDb(); }, 120_000);
afterEach(async () => t.close());

const lead = (id: string, over: Record<string, unknown> = {}) => ({
  id, nome: `Pessoa ${id}`, empresa: 'Empresa X', email: `${id}@exemplo-real.com`, objetivo: 'proposta', consentimentoEm: dias(400), ...over,
});
type Status = 'novo' | 'qualificado' | 'descartado' | 'convertido';
/** Grava o lead e fixa as datas depois (o gatilho pôs "agora" na inserção). */
async function put(id: string, o: { status?: Status; contaId?: string | null; contatoHa?: number; descartadoHa?: number | null }) {
  await t.db.insert(schema.crmLeads).values(lead(id, { status: o.status ?? 'novo', contaId: o.contaId ?? null }) as never);
  await t.client.query('UPDATE crm_leads SET ultimo_contato_em = $2, descartado_em = $3 WHERE id = $1', [id, dias(o.contatoHa ?? 0), o.descartadoHa == null ? null : dias(o.descartadoHa)]);
}
// 12 meses antes de 25/11/2026 = 25/11/2025 (365 dias): ±1 dia de folga nos testes
const MES12_DENTRO = 364;
const MES12_FORA = 367;
const ids = async () => (await t.client.query<{ id: string }>('SELECT id FROM crm_leads ORDER BY id')).rows.map((r) => r.id);

describe('retenção do lead: limites', () => {
  it('não convertido: 12 meses menos 1 dia fica; mais 1 dia sai', async () => {
    await put('dentro', { contatoHa: MES12_DENTRO });
    await put('fora', { contatoHa: MES12_FORA });
    const r = await purgeLeads(db(), NOW);
    expect(r).toMatchObject({ naoConvertidos: 1, descartados: 0 });
    expect(await ids()).toEqual(['dentro']);
    expect(NAO_CONVERTIDO_MESES).toBe(12);
  });

  it('descartado: 30 dias menos 1 dia fica; mais 1 dia sai (mesmo com contato recente)', async () => {
    await put('desc-dentro', { status: 'descartado', descartadoHa: DESCARTADO_DIAS - 1 });
    await put('desc-fora', { status: 'descartado', descartadoHa: DESCARTADO_DIAS + 1 });
    const r = await purgeLeads(db(), NOW);
    expect(r).toMatchObject({ naoConvertidos: 0, descartados: 1 });
    expect(await ids()).toEqual(['desc-dentro']);
  });

  it('lead recente e lead com contato novo não saem', async () => {
    await put('novo', {});
    await put('qualificado', { status: 'qualificado', contatoHa: 200 });
    expect(await purgeLeads(db(), NOW)).toMatchObject({ naoConvertidos: 0, descartados: 0 });
    expect(await ids()).toEqual(['novo', 'qualificado']);
  });
});

describe('retenção do lead: convertido nunca', () => {
  it('com conta (conta_id) ou status convertido NÃO é apagado, mesmo velho e mesmo descartado; a conta fica', async () => {
    await t.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Conta Real' });
    await put('com-conta-velho', { contaId: 'acc-1', contatoHa: 900 });
    await put('com-conta-descartado', { status: 'descartado', contaId: 'acc-1', descartadoHa: 200 });
    await put('convertido-sem-conta', { status: 'convertido', contatoHa: 900 });
    await put('velho-sem-conta', { contatoHa: 900 });
    const r = await purgeLeads(db(), NOW);
    expect(r).toMatchObject({ naoConvertidos: 1, descartados: 0 });
    expect(await ids()).toEqual(['com-conta-descartado', 'com-conta-velho', 'convertido-sem-conta']);
    expect(await t.db.select().from(schema.crmAccounts)).toHaveLength(1);
  });
});

describe('retenção do lead: cascata e auditoria', () => {
  it('oportunidade ligada ao lead apagado: o vínculo é desfeito, a oportunidade e a conta ficam (conta_id é obrigatório na oportunidade)', async () => {
    await t.db.insert(schema.crmAccounts).values({ id: 'acc-2', nome: 'Conta B' });
    await put('velho', { contatoHa: 500 });
    await t.db.insert(schema.crmOpportunities).values({ id: 'op-1', contaId: 'acc-2', leadId: 'velho', titulo: 'Proposta' } as never);
    // o gatilho da oportunidade renovou o contato do lead: refaz o cenário "velho"
    await t.client.query('UPDATE crm_leads SET ultimo_contato_em = $1 WHERE id = $2', [dias(500), 'velho']);
    const r = await purgeLeads(db(), NOW);
    expect(r).toEqual({ naoConvertidos: 1, descartados: 0, vinculosDesfeitos: 1 });
    expect(await ids()).toEqual([]);
    const [op] = await t.db.select().from(schema.crmOpportunities);
    expect(op).toMatchObject({ id: 'op-1', contaId: 'acc-2', leadId: null });
    expect(await t.db.select().from(schema.crmAccounts)).toHaveLength(1);
  });

  it('audita só contagens (nada de nome, e-mail, empresa ou id); sem nada a apagar não audita; idempotente', async () => {
    // ids que NÃO são hexadecimais: o JSON da linha de auditoria tem um UUID aleatório e 'a1'/'a2' apareceriam nele por acaso
    await put('lead-zulu', { contatoHa: 500 });
    await put('lead-yankee', { status: 'descartado', descartadoHa: 40 });
    const conta = async () => (await t.client.query<{ n: number }>("SELECT count(*)::int n FROM audit_log WHERE action = 'crm.leads_retencao'")).rows[0]!.n;
    const antes = await conta();
    const r = await purgeLeads(db(), NOW);
    expect(r).toEqual({ naoConvertidos: 1, descartados: 1, vinculosDesfeitos: 0 });
    const trilha = (await t.client.query<{ j: string; detalhe: unknown }>("SELECT row_to_json(a)::text j, detalhe FROM audit_log a WHERE action = 'crm.leads_retencao'")).rows;
    expect(trilha).toHaveLength(antes + 1);
    expect(trilha[0]!.detalhe).toEqual({ naoConvertidos: 1, descartados: 1, vinculosDesfeitos: 0 });
    for (const proibido of ['lead-zulu', 'lead-yankee', 'exemplo-real', 'Pessoa', 'Empresa X']) expect(trilha[0]!.j, proibido).not.toContain(proibido);
    expect(await purgeLeads(db(), NOW)).toEqual({ naoConvertidos: 0, descartados: 0, vinculosDesfeitos: 0 });
    expect(await conta()).toBe(antes + 1);
  });
});

describe('gatilhos da migração 0031 (datas mantidas pelo banco)', () => {
  it('captura grava ultimo_contato_em; descartar grava descartado_em; reabrir limpa; regravar igual não renova o contato', async () => {
    await t.db.insert(schema.crmLeads).values(lead('g1') as never);
    const get = async () => (await t.client.query<{ c: Date; d: Date | null }>("SELECT ultimo_contato_em c, descartado_em d FROM crm_leads WHERE id = 'g1'")).rows[0]!;
    const g0 = await get();
    expect(g0.d).toBeNull();
    expect(Math.abs(Date.now() - g0.c.getTime())).toBeLessThan(60_000);
    await t.client.query("UPDATE crm_leads SET ultimo_contato_em = now() - interval '100 days' WHERE id = 'g1'");
    const antigo = (await get()).c;
    await t.client.query("UPDATE crm_leads SET nome = nome WHERE id = 'g1'"); // mesmos valores
    expect((await get()).c.getTime()).toBe(antigo.getTime());
    await t.client.query("UPDATE crm_leads SET status = 'descartado' WHERE id = 'g1'");
    const g1 = await get();
    expect(g1.d).not.toBeNull();
    expect(g1.c.getTime()).toBeGreaterThan(antigo.getTime()); // mudança de status é interação
    await t.client.query("UPDATE crm_leads SET status = 'qualificado' WHERE id = 'g1'");
    expect((await get()).d).toBeNull();
  });

  it('criar ou mexer na oportunidade ligada ao lead renova o último contato do lead', async () => {
    await t.db.insert(schema.crmAccounts).values({ id: 'acc-3', nome: 'Conta C' });
    await put('g2', { contatoHa: 300 });
    await t.db.insert(schema.crmOpportunities).values({ id: 'op-g2', contaId: 'acc-3', leadId: 'g2', titulo: 'x' } as never);
    const c1 = (await t.client.query<{ c: Date }>("SELECT ultimo_contato_em c FROM crm_leads WHERE id = 'g2'")).rows[0]!.c;
    expect(Math.abs(Date.now() - c1.getTime())).toBeLessThan(60_000);
    await t.client.query("UPDATE crm_leads SET ultimo_contato_em = now() - interval '300 days' WHERE id = 'g2'");
    await t.client.query("UPDATE crm_opportunities SET estagio = 'qualificado' WHERE id = 'op-g2'");
    const c2 = (await t.client.query<{ c: Date }>("SELECT ultimo_contato_em c FROM crm_leads WHERE id = 'g2'")).rows[0]!.c;
    expect(Math.abs(Date.now() - c2.getTime())).toBeLessThan(60_000);
  });
});

describe('gatilho da oportunidade: guarda de no-op (QA 1, R4)', () => {
  it('regravar a oportunidade com os MESMOS valores não renova o contato do lead (retry/sincronização não adia a exclusão); mudar de verdade renova', async () => {
    await t.db.insert(schema.crmAccounts).values({ id: 'acc-4', nome: 'Conta D' });
    await put('g3', { contatoHa: 300 });
    await t.db.insert(schema.crmOpportunities).values({ id: 'op-g3', contaId: 'acc-4', leadId: 'g3', titulo: 'x' } as never);
    const velho = "now() - interval '300 days'";
    await t.client.query(`UPDATE crm_leads SET ultimo_contato_em = ${velho} WHERE id = 'g3'`);
    const get = async () => (await t.client.query<{ c: Date }>("SELECT ultimo_contato_em c FROM crm_leads WHERE id = 'g3'")).rows[0]!.c.getTime();
    const antes = await get();
    await t.client.query("UPDATE crm_opportunities SET titulo = titulo WHERE id = 'op-g3'"); // mesmos valores
    await t.client.query("UPDATE crm_opportunities SET estagio = estagio, lead_id = lead_id WHERE id = 'op-g3'");
    expect(await get()).toBe(antes);
    await t.client.query("UPDATE crm_opportunities SET titulo = 'y' WHERE id = 'op-g3'"); // mudança real
    expect(await get()).toBeGreaterThan(antes);
  });
});

describe('job', () => {
  it('startLeadRetention roda na subida, reporta erro sem derrubar e para', async () => {
    await put('j1', { contatoHa: 500 });
    const out: number[] = [];
    const w = startLeadRetention({ db: db(), intervalMs: 3_600_000, now: () => NOW, onResult: (r) => out.push(r.naoConvertidos) });
    await new Promise((r) => setTimeout(r, 1500));
    expect(out[0]).toBe(1);
    w.stop();
    const erros: unknown[] = [];
    const w2 = startLeadRetention({ db: { transaction: () => Promise.reject(new Error('pg fora')) } as unknown as Db, intervalMs: 3_600_000, onError: (e) => erros.push(e) });
    await new Promise((r) => setTimeout(r, 300));
    w2.stop();
    expect(erros).toHaveLength(1);
  });
});
