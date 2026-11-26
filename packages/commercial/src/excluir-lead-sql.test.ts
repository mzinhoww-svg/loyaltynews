// O SQL de exclusão manual (procedimento do titular) é executado de verdade no banco de teste com as migrações. Dados MOCK.
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';

const comandos = (id: string) => readFileSync(new URL('../scripts/excluir-lead.sql', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => !l.startsWith('--')).join('\n').replaceAll(":'lead'", `'${id}'`).split(';').map((c) => c.trim()).filter(Boolean);

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });

describe('excluir-lead.sql', () => {
  it('apaga só o lead pedido, mantém conta e oportunidade sem o vínculo', async () => {
    const db = t.db;
    const lead = (id: string) => ({ id, nome: `Pessoa ${id}`, empresa: 'Empresa Exemplo', email: `${id}@example.invalid`, objetivo: 'MOCK', consentimentoEm: new Date('2030-01-01T00:00:00Z') });
    await db.insert(schema.crmLeads).values([lead('lead-alvo'), lead('lead-outro')]);
    await db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Conta MOCK' });
    await db.insert(schema.crmOpportunities).values({ id: 'opp-1', contaId: 'acc-1', leadId: 'lead-alvo', titulo: 'Oportunidade MOCK' });
    const lista = comandos('lead-alvo');
    expect(lista[0]).toBe('BEGIN');
    expect(lista.at(-1)).toBe('COMMIT');
    for (const c of lista) await db.execute(sql.raw(c));
    expect(await db.$count(schema.crmLeads, eq(schema.crmLeads.id, 'lead-alvo'))).toBe(0);
    expect(await db.$count(schema.crmLeads, eq(schema.crmLeads.id, 'lead-outro'))).toBe(1);
    const [opp] = await db.select().from(schema.crmOpportunities);
    expect(opp).toMatchObject({ id: 'opp-1', contaId: 'acc-1', leadId: null });
    expect(await db.$count(schema.crmAccounts)).toBe(1);
  });
});
