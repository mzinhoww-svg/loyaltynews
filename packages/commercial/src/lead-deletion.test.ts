// Exclusão de lead e retenção do descartado: o efeito é observado no banco; a trilha não guarda PII.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import {
  LEAD_AUDIT_SALT_ENV, deleteLeadById, leadAuditSalt, leadRefHash, retainDiscardedLeads,
} from './lead-deletion';

const SALT = 'sal-de-teste-com-32-caracteres-ok';
const NOW = new Date('2026-12-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(async () => { await t.close(); });

let seq = 0;
async function lead(over: { status?: 'novo' | 'descartado' | 'convertido'; descartadoEm?: Date | null; criadoEm?: Date } = {}) {
  const id = `lead-${++seq}`;
  await db.insert(schema.crmLeads).values({
    id, nome: `Pessoa ${seq}`, empresa: 'Empresa Exemplo', email: `pessoa${seq}@example.invalid`,
    objetivo: 'awareness', consentimentoEm: new Date('2026-01-01T00:00:00Z'), status: over.status ?? 'novo', criadoEm: over.criadoEm ?? new Date('2026-01-01T00:00:00Z'),
    descartadoEm: over.descartadoEm ?? null,
  });
  return id;
}

const count = (id: string) => db.$count(schema.crmLeads, eq(schema.crmLeads.id, id));
const trail = () => db.select().from(schema.commercialLeadDeletions);

describe('sal e hash da trilha', () => {
  it('sem sal ou com sal curto não há exclusão', () => {
    expect(() => leadAuditSalt({})).toThrow(/LN_LEAD_AUDIT_SALT/);
    expect(() => leadAuditSalt({ [LEAD_AUDIT_SALT_ENV]: 'curto' })).toThrow(/menos de 16/);
    expect(leadAuditSalt({ [LEAD_AUDIT_SALT_ENV]: SALT })).toBe(SALT);
  });

  it('hash é HMAC-SHA256 hex, determinístico e não é o id; outro sal muda o hash', () => {
    const h = leadRefHash('lead-123', SALT);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('lead-123');
    expect(leadRefHash('lead-123', SALT)).toBe(h);
    expect(leadRefHash('lead-123', `${SALT}-outro`)).not.toBe(h);
  });
});

describe('exclusão de um lead (rota)', () => {
  it('apaga a linha, solta a oportunidade e grava só o hash na trilha', async () => {
    const id = await lead();
    await db.insert(schema.crmAccounts).values({ id: 'acc-x', nome: 'Conta X' });
    await db.insert(schema.crmOpportunities).values({ id: 'opp-x', contaId: 'acc-x', leadId: id, titulo: 'Oportunidade' });
    const r = await deleteLeadById(db, id, { at: NOW, actorId: 'user-1', actorRole: 'comercial', origin: 'studio' }, SALT);
    expect(r).toEqual({ refHash: leadRefHash(id, SALT) });
    expect(await count(id)).toBe(0);
    const [opp] = await db.select().from(schema.crmOpportunities).where(eq(schema.crmOpportunities.id, 'opp-x'));
    expect(opp?.leadId).toBeNull(); // a oportunidade é da conta; a conta e a oportunidade ficam
    const [row] = await trail();
    expect(row).toMatchObject({ leadRefHash: leadRefHash(id, SALT), actorId: 'user-1', actorRole: 'comercial', origin: 'studio' });
    expect(JSON.stringify(row)).not.toContain(id);
    expect(JSON.stringify(row)).not.toContain('@example.invalid');
    expect(JSON.stringify(row)).not.toContain('Pessoa');
  });

  it('lead inexistente devolve null e não grava trilha', async () => {
    const antes = (await trail()).length;
    expect(await deleteLeadById(db, 'nao-existe', { at: NOW, actorId: 'u', actorRole: 'admin', origin: 'studio' }, SALT)).toBeNull();
    expect((await trail()).length).toBe(antes);
  });
});

describe('retenção do descartado (30 dias por padrão)', () => {
  beforeEach(async () => {
    await db.delete(schema.commercialLeadDeletions);
    await db.delete(schema.crmOpportunities);
    await db.delete(schema.crmLeads);
  });
  it('apaga só o descartado há MAIS de 30 dias; a fronteira e os demais estados ficam', async () => {
    const velho = await lead({ status: 'descartado', descartadoEm: daysAgo(31) });
    const fronteira = await lead({ status: 'descartado', descartadoEm: daysAgo(30) });
    const recente = await lead({ status: 'descartado', descartadoEm: daysAgo(29) });
    const semData = await lead({ status: 'descartado', descartadoEm: null });
    const naoDescartado = await lead({ status: 'novo', descartadoEm: daysAgo(90) });

    const r = await retainDiscardedLeads(db, { now: NOW, days: 30, salt: SALT });
    expect(r.deleted).toBe(1);
    expect(r.cutoff).toBe(daysAgo(30).toISOString());
    expect(await count(velho)).toBe(0);
    for (const id of [fronteira, recente, semData, naoDescartado]) expect(await count(id)).toBe(1);

    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leadRefHash: leadRefHash(velho, SALT), actorId: null, actorRole: 'sistema', origin: 'retencao' });
    expect(JSON.stringify(rows[0])).not.toContain(velho);
  });

  it('é idempotente: a segunda rodada não apaga nem audita de novo', async () => {
    const antes = (await trail()).length;
    expect((await retainDiscardedLeads(db, { now: NOW, days: 30, salt: SALT })).deleted).toBe(0);
    expect((await trail()).length).toBe(antes);
  });

  it('N configurável: 7 dias apaga o descartado há 8 e mantém o de 6', async () => {
    const oito = await lead({ status: 'descartado', descartadoEm: daysAgo(8) });
    const seis = await lead({ status: 'descartado', descartadoEm: daysAgo(6) });
    expect((await retainDiscardedLeads(db, { now: NOW, days: 7, salt: SALT })).deleted).toBe(1);
    expect(await count(oito)).toBe(0);
    expect(await count(seis)).toBe(1);
  });

  it('lead criado há 2 anos e descartado agora não sai na primeira rodada: o relógio é o descarte, não a criação', async () => {
    const id = await lead({ status: 'descartado', descartadoEm: NOW, criadoEm: daysAgo(730) });
    expect((await retainDiscardedLeads(db, { now: NOW, days: 30, salt: SALT })).deleted).toBe(0);
    expect(await count(id)).toBe(1);
    const depois = new Date(NOW.getTime() + 31 * 86_400_000);
    expect((await retainDiscardedLeads(db, { now: depois, days: 30, salt: SALT })).deleted).toBe(1);
    expect(await count(id)).toBe(0);
  });

  it('recusa dias inválidos (não usa default silencioso na rotina)', async () => {
    await expect(retainDiscardedLeads(db, { now: NOW, days: 0, salt: SALT })).rejects.toThrow(/dias de retenção/);
  });

  it('a trilha inteira não guarda id, nome, e-mail nem empresa', async () => {
    const texto = JSON.stringify(await db.select().from(schema.commercialLeadDeletions).where(and(eq(schema.commercialLeadDeletions.origin, 'retencao'))));
    expect(texto).not.toMatch(/lead-\d/);
    expect(texto).not.toContain('@example.invalid');
    expect(texto).not.toContain('Empresa Exemplo');
  });
});

