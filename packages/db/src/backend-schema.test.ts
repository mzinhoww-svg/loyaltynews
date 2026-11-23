import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testing';
import * as s from './schema';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
  await t.db.insert(s.editorias).values({ slug: 'pontos', nome: 'Pontos & Milhas' });
  await t.db.insert(s.articles).values({ id: 'a1', slug: 'a1', titulo: 'T', editoria: 'pontos', corpo: 'C' });
});
afterAll(async () => {
  await t.close();
});

const sha = 'a'.repeat(64);

describe('outbox e ledger de efeitos (ADR-002)', () => {
  it('chave de idempotência do outbox é única', async () => {
    await t.db.insert(s.outbox).values({ id: 'o1', queue: 'coleta', refId: 'r1', idempotencyKey: 'k1' });
    await expect(t.db.insert(s.outbox).values({ id: 'o2', queue: 'coleta', refId: 'r1', idempotencyKey: 'k1' })).rejects.toThrow();
    const [row] = await t.db.select().from(s.outbox).where(eq(s.outbox.id, 'o1'));
    expect(row?.status).toBe('pending');
  });

  it('effect_ledger: segunda gravação com a mesma chave não vira segundo efeito', async () => {
    await t.db.insert(s.effectLedger).values({ idempotencyKey: 'e1', effect: 'x' });
    await t.db.insert(s.effectLedger).values({ idempotencyKey: 'e1', effect: 'x' }).onConflictDoNothing();
    expect(await t.db.$count(s.effectLedger)).toBe(1);
  });

  it('effect_ledger é append-only', async () => {
    await expect(t.db.update(s.effectLedger).set({ effect: 'y' }).where(eq(s.effectLedger.idempotencyKey, 'e1'))).rejects.toThrow();
    await expect(t.db.delete(s.effectLedger)).rejects.toThrow();
  });
});

describe('orçamento (DP-04)', () => {
  // taskClass é obrigatória desde a 0020 (sem padrão silencioso, gap L4b).
  const base = { taskId: 't1', taskClass: 'essential', route: 'economy', provider: 'anthropic', model: 'm', maxEstimatedMicrousd: 1000 };

  it('reserva recusa provedor desconhecido, mês inválido, valor negativo e conciliação sem custo real', async () => {
    await expect(t.db.insert(s.budgetReservations).values({ id: 'b0', idempotencyKey: 'bk0', monthKey: '2026-11', ...base, provider: 'xpto' })).rejects.toThrow();
    await expect(t.db.insert(s.budgetReservations).values({ id: 'b0', idempotencyKey: 'bk0', monthKey: '2026-13', ...base })).rejects.toThrow();
    await expect(t.db.insert(s.budgetReservations).values({ id: 'b0', idempotencyKey: 'bk0', monthKey: '2026-11', ...base, maxEstimatedMicrousd: -1 })).rejects.toThrow();
    await expect(t.db.insert(s.budgetReservations).values({ id: 'b0', idempotencyKey: 'bk0', monthKey: '2026-11', ...base, state: 'conciliada' })).rejects.toThrow();
  });

  it('ledger: soma do mês, idempotência e append-only', async () => {
    await t.db.insert(s.budgetReservations).values({ id: 'b1', idempotencyKey: 'bk1', monthKey: '2026-11', ...base });
    await t.db.insert(s.budgetLedger).values([
      { id: 'l1', monthKey: '2026-11', reservationId: 'b1', kind: 'reserva', deltaMicrousd: 1000, idempotencyKey: 'lk1' },
      { id: 'l2', monthKey: '2026-11', reservationId: 'b1', kind: 'conciliacao', deltaMicrousd: -300, idempotencyKey: 'lk2' },
    ]);
    const [tot] = await t.db
      .select({ v: sql<number>`coalesce(sum(${s.budgetLedger.deltaMicrousd}), 0)::int` })
      .from(s.budgetLedger)
      .where(eq(s.budgetLedger.monthKey, '2026-11'));
    expect(tot?.v).toBe(700);
    await expect(
      t.db.insert(s.budgetLedger).values({ id: 'l3', monthKey: '2026-11', reservationId: 'b1', kind: 'reserva', deltaMicrousd: 1000, idempotencyKey: 'lk1' }),
    ).rejects.toThrow();
    await expect(t.db.update(s.budgetLedger).set({ deltaMicrousd: 1 }).where(eq(s.budgetLedger.id, 'l1'))).rejects.toThrow(/append-only|Failed query/);
    await expect(t.db.delete(s.budgetLedger).where(eq(s.budgetLedger.id, 'l1'))).rejects.toThrow();
    expect(await t.db.$count(s.budgetLedger)).toBe(2);
  });
});

describe('auditoria e recibos imutáveis', () => {
  it('audit_log não aceita UPDATE nem DELETE', async () => {
    await t.db.insert(s.auditLog).values({ id: 'au1', action: 'x', resource: 'materias' });
    await expect(t.db.update(s.auditLog).set({ action: 'y' })).rejects.toThrow();
    await expect(t.db.delete(s.auditLog)).rejects.toThrow();
  });

  it('recibo: um por versão, hash válido, imutável', async () => {
    const r = { articleId: 'a1', versao: 1, conteudoSha256: sha, checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: 'u1', identidadePublicacao: 'u1' };
    await t.db.insert(s.publicationReceipts).values({ id: 'rc1', ...r });
    await expect(t.db.insert(s.publicationReceipts).values({ id: 'rc2', ...r })).rejects.toThrow();
    await expect(t.db.insert(s.publicationReceipts).values({ id: 'rc3', ...r, versao: 2, conteudoSha256: 'zz' })).rejects.toThrow();
    await expect(t.db.update(s.publicationReceipts).set({ aprovador: 'u2' })).rejects.toThrow();
  });
});

describe('auth', () => {
  it('e-mail único; sessão some em cascata ao remover o usuário', async () => {
    const now = new Date();
    await t.db.insert(s.user).values({ id: 'u1', name: 'A', email: 'a@x.test' });
    await expect(t.db.insert(s.user).values({ id: 'u2', name: 'B', email: 'a@x.test' })).rejects.toThrow();
    await t.db.insert(s.session).values({ id: 's1', token: 'tk', userId: 'u1', expiresAt: new Date(now.getTime() + 1000) });
    await t.db.delete(s.user).where(eq(s.user.id, 'u1'));
    expect(await t.db.$count(s.session)).toBe(0);
  });

  it('mídia e agenda: checks do banco', async () => {
    await expect(t.db.insert(s.media).values({ id: 'm1', tipo: 'gif', direitos: {}, sha256: sha })).rejects.toThrow();
    await t.db.insert(s.media).values({ id: 'm1', tipo: 'imagem', direitos: {}, sha256: sha });
    await expect(
      t.db.insert(s.agendaEvents).values({ id: 'e1', titulo: 'E', inicio: '2026-12-02', fim: '2026-12-01', local: 'SP', fonteUrl: 'https://example.org' }),
    ).rejects.toThrow();
  });
});
