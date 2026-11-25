// openbot_pilot_resolutions é append-only: UPDATE e DELETE recusados pelo trigger, INSERT novo continua.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';

let t: Awaited<ReturnType<typeof createTestDb>>;
const AGORA = new Date('2026-11-25T12:00:00Z');

beforeAll(async () => {
  t = await createTestDb();
  for (const attempt of [1, 2]) {
    await t.db.insert(schema.openbotPilotRows).values({
      taskId: 'task-append', attempt, stage: 'revisao', account: 'conta', outcome: 'completed', startedAt: AGORA, row: {}, updatedAt: AGORA,
    });
  }
  await t.db.insert(schema.openbotPilotResolutions).values({
    taskId: 'task-append', attempt: 1, resolvidoPor: 'user-1', resolvidoEm: AGORA,
    motivo: 'config_invalid no passo 2', acaoTomada: 'config corrigida',
  });
  await t.db.insert(schema.auditLog).values({ id: 'aud-append', at: AGORA, action: 'teste.append', resource: 'teste' });
  await t.db.insert(schema.effectLedger).values({ idempotencyKey: 'efeito-append', effect: 'teste', refId: 'r-1', at: AGORA });
});
afterAll(async () => { await t.close(); });

const resolucao = () => t.db.select().from(schema.openbotPilotResolutions).where(and(
  eq(schema.openbotPilotResolutions.taskId, 'task-append'), eq(schema.openbotPilotResolutions.attempt, 1),
));
const codigo = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const recusa = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e; } };
const ehRecusaAppendOnly = (e: unknown) => codigo(e) === '23000' || /append-only/.test(String(e));

describe('openbot_pilot_resolutions append-only', () => {
  it('UPDATE é recusado (23000) e não altera o motivo nem quem tratou', async () => {
    expect(ehRecusaAppendOnly(await recusa(t.db.update(schema.openbotPilotResolutions).set({ motivo: 'outro motivo qualquer' }).where(and(
      eq(schema.openbotPilotResolutions.taskId, 'task-append'), eq(schema.openbotPilotResolutions.attempt, 1),
    ))))).toBe(true);
    const [row] = await resolucao();
    expect(row).toMatchObject({ motivo: 'config_invalid no passo 2', resolvidoPor: 'user-1' });
  });

  it('DELETE é recusado (23000) e a linha continua', async () => {
    expect(ehRecusaAppendOnly(await recusa(t.db.delete(schema.openbotPilotResolutions).where(and(
      eq(schema.openbotPilotResolutions.taskId, 'task-append'), eq(schema.openbotPilotResolutions.attempt, 1),
    ))))).toBe(true);
    expect(await resolucao()).toHaveLength(1);
  });

  it('INSERT correto continua funcionando (outra resolução, outro attempt)', async () => {
    await t.db.insert(schema.openbotPilotResolutions).values({
      taskId: 'task-append', attempt: 2, resolvidoPor: 'user-2', resolvidoEm: AGORA,
      motivo: 'segunda tratativa da linha', acaoTomada: 'publicado de novo',
    });
    const rows = await t.db.select().from(schema.openbotPilotResolutions).where(eq(schema.openbotPilotResolutions.taskId, 'task-append'));
    expect(rows).toHaveLength(2);
  });
});

describe('TRUNCATE também é recusado nas cinco append-only', () => {
  const TABELAS = ['openbot_pilot_resolutions', 'budget_ledger', 'effect_ledger', 'audit_log', 'publication_receipts'];

  it('TRUNCATE recusado (23000) nas cinco; as linhas existentes ficam intactas', async () => {
    for (const tabela of TABELAS) {
      const e = await recusa(t.client.exec(`TRUNCATE ${tabela} CASCADE`));
      expect(ehRecusaAppendOnly(e), e === null ? `${tabela} SEM ERRO` : `${tabela} ${String((e as { code?: string }).code)} ${String((e as { message?: string }).message).slice(0, 120)}`).toBe(true);
      expect(codigo(e), tabela).toBe('23000');
      expect(String((e as { message?: string }).message), tabela).toContain(tabela);
    }
    expect(await t.db.$count(schema.openbotPilotResolutions)).toBe(2); // insert do último teste + o original
    expect(await t.db.$count(schema.auditLog, eq(schema.auditLog.id, 'aud-append'))).toBe(1);
    expect(await t.db.$count(schema.effectLedger, eq(schema.effectLedger.idempotencyKey, 'efeito-append'))).toBe(1);
  });

  it('cada tabela tem o trigger de TRUNCATE (e o de linha continua)', async () => {
    const r = await t.client.query<{ tgname: string }>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`);
    const nomes = r.rows.map((x) => x.tgname);
    for (const tabela of TABELAS) expect(nomes, tabela).toContain(`${tabela}_no_truncate`);
    for (const tabela of TABELAS) expect(nomes, tabela).toContain(`${tabela}_append_only`);
  });

  it('UPDATE e DELETE seguem recusados também em audit_log e effect_ledger', async () => {
    expect(ehRecusaAppendOnly(await recusa(t.db.update(schema.auditLog).set({ action: 'reescrito' }).where(eq(schema.auditLog.id, 'aud-append'))))).toBe(true);
    expect(ehRecusaAppendOnly(await recusa(t.db.delete(schema.auditLog).where(eq(schema.auditLog.id, 'aud-append'))))).toBe(true);
    expect(ehRecusaAppendOnly(await recusa(t.db.update(schema.effectLedger).set({ effect: 'outro' }).where(eq(schema.effectLedger.idempotencyKey, 'efeito-append'))))).toBe(true);
    expect(ehRecusaAppendOnly(await recusa(t.db.delete(schema.effectLedger).where(eq(schema.effectLedger.idempotencyKey, 'efeito-append'))))).toBe(true);
    expect(await t.db.$count(schema.auditLog, eq(schema.auditLog.id, 'aud-append'))).toBe(1);
    expect(await t.db.$count(schema.effectLedger, eq(schema.effectLedger.idempotencyKey, 'efeito-append'))).toBe(1);
  });
});


