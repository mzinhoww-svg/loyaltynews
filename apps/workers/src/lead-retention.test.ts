// Retenção do lead descartado no worker: roda a rotina e observa o banco; sem sal não apaga.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { retentionDays, startLeadRetention } from './lead-retention';

const SALT = 'sal-de-teste-da-retencao-32-caracteres';
let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(async () => { await t.close(); });

const NOW = new Date('2026-12-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let seq = 0;
async function lead(descartadoEm: Date | null) {
  const id = `ret-${++seq}`;
  await db.insert(schema.crmLeads).values({
    id, nome: `Pessoa ${seq}`, empresa: 'Empresa Exemplo', email: `ret${seq}@example.invalid`,
    objetivo: 'awareness', consentimentoEm: new Date('2026-01-01T00:00:00Z'), status: 'descartado', descartadoEm,
  });
  return id;
}
const existe = (id: string) => db.$count(schema.crmLeads, eq(schema.crmLeads.id, id));

describe('dias de retenção por ambiente', () => {
  it('padrão 30; inteiro >= 1 configurável; inválido volta ao padrão', () => {
    expect(retentionDays({})).toBe(30);
    expect(retentionDays({ LN_LEAD_RETENTION_DAYS: '7' })).toBe(7);
    expect(retentionDays({ LN_LEAD_RETENTION_DAYS: '0' })).toBe(30);
    expect(retentionDays({ LN_LEAD_RETENTION_DAYS: '-3' })).toBe(30);
    expect(retentionDays({ LN_LEAD_RETENTION_DAYS: 'abc' })).toBe(30);
  });
});

describe('rotina de retenção', () => {
  beforeEach(async () => {
    await db.delete(schema.commercialLeadDeletions);
    await db.delete(schema.crmLeads);
  });
  it('sem LN_LEAD_AUDIT_SALT não liga e não apaga nada (falha fechada, um aviso)', async () => {
    const id = await lead(daysAgo(90));
    const linhas: string[] = [];
    const r = startLeadRetention({ db, env: {}, now: () => NOW, log: (l) => linhas.push(l), intervalMs: 1_000_000, runOnStart: false });
    expect(r).toBeNull();
    expect(linhas.join('\n')).toMatch(/LN_LEAD_AUDIT_SALT ausente/);
    expect(await existe(id)).toBe(1);
  });

  it('apaga só o descartado há mais de N dias e loga contagem, sem PII', async () => {
    const velho = await lead(daysAgo(31));
    const recente = await lead(daysAgo(29));
    const linhas: string[] = [];
    const r = startLeadRetention({ db, env: { LN_LEAD_AUDIT_SALT: SALT }, now: () => NOW, log: (l) => linhas.push(l), intervalMs: 1_000_000, runOnStart: false });
    expect(r).not.toBeNull();
    const out = await r!.run();
    expect(out?.deleted).toBe(1);
    expect(await existe(velho)).toBe(0);
    expect(await existe(recente)).toBe(1);
    expect(linhas.join('\n')).toMatch(/\[lead-retention\] descartados há mais de 30 dias: 1 apagado\(s\)/);
    expect(linhas.join('\n')).not.toContain('@example.invalid');
    expect(linhas.join('\n')).not.toContain(velho);
    const [row] = await db.select().from(schema.commercialLeadDeletions);
    expect(row).toMatchObject({ actorRole: 'sistema', origin: 'retencao' });
    expect(JSON.stringify(row)).not.toContain(velho);
    r!.stop();
  });

  it('N por env: 7 dias apaga o de 8 e mantém o de 6', async () => {
    const oito = await lead(daysAgo(8));
    const seis = await lead(daysAgo(6));
    const r = startLeadRetention({ db, env: { LN_LEAD_AUDIT_SALT: SALT, LN_LEAD_RETENTION_DAYS: '7' }, now: () => NOW, log: () => undefined, intervalMs: 1_000_000, runOnStart: false });
    expect(r?.days).toBe(7);
    expect((await r!.run())?.deleted).toBe(1);
    expect(await existe(oito)).toBe(0);
    expect(await existe(seis)).toBe(1);
    r!.stop();
  });
});

