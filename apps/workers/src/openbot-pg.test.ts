import { describe, expect, it } from 'vitest';
import type { Db } from '@ln/auth';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { InMemoryLeaseQueue, type NewTask } from '@ln/openbot';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue } from './openbot-pg';

const NOW = new Date('2026-11-23T12:00:00Z');
const task = (n: number, over: Partial<NewTask> = {}): NewTask => ({
  kind: 'editorial_draft', profileId: 'writer_pontos', refId: `art-${n}`, idempotencyKey: `idem-${n}`, dataClass: 'public', maxCostMicro: 1_000_000, ...over,
});
const usage = (id: string, over: Record<string, unknown> = {}) => ({
  executionId: `exec-${id}`, taskId: id, leaseId: 'l1', model: 'm', generationIds: ['g1'], promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 1000, ...over,
});

describe('stores do OpenBot no PostgreSQL', () => {
  it('mesma semântica da fila em memória: ordem de chegada, limite, kinds, lease, esgotamento e idempotência (execução paralela dos dois)', async () => {
    const t = await createTestDb();
    try {
      let n = 0;
      const pg = new PgLeaseQueue(t.db as unknown as Db, () => `x${++n}`);
      const mem = new InMemoryLeaseQueue();
      for (const q of [pg, mem]) {
        await q.enqueue(task(1), NOW);
        await q.enqueue(task(2, { kind: 'fact_check', maxAttempts: 1 }), NOW);
        await q.enqueue(task(3), NOW);
        expect((await q.enqueue(task(1), NOW)).created).toBe(false);
      }
      const run = async (q: PgLeaseQueue | InMemoryLeaseQueue) => {
        const out: unknown[] = [];
        const a = await q.claim({ workerId: 'w1', now: NOW, leaseMs: 1000, limit: 2, kinds: ['editorial_draft'] });
        out.push(a.map((x) => [x.refId, x.attempt]));
        const later = new Date(NOW.getTime() + 5000); // lease vencido: volta; a de maxAttempts=1 depois de 1 tentativa vira 'dead'
        const f = await q.claim({ workerId: 'w2', now: NOW, leaseMs: 1000, limit: 5, kinds: ['fact_check'] });
        out.push(f.map((x) => [x.refId, x.attempt]));
        const b = await q.claim({ workerId: 'w3', now: later, leaseMs: 1000, limit: 5 });
        out.push(b.map((x) => [x.refId, x.attempt]));
        out.push(await q.counts());
        return out;
      };
      expect(await run(pg)).toEqual(await run(mem));
    } finally {
      await t.close();
    }
  });

  it('custos: dedupe por executionId, estouro do teto da tarefa e soma só do mês corrente', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const q = new PgLeaseQueue(db);
      const a = (await q.enqueue(task(1, { maxCostMicro: 500 }), NOW)).task;
      const b = (await q.enqueue(task(2), NOW)).task;
      const ledger = new PgCostLedger(db, () => NOW);
      expect((await ledger.record(usage(a.id) as never, a.maxCostMicro, NOW))).toMatchObject({ recorded: true, entry: { overrun: true, costMicro: 1000 } });
      expect((await ledger.record(usage(a.id, { costMicro: 9999 }) as never, a.maxCostMicro, NOW))).toMatchObject({ recorded: false, entry: { costMicro: 1000 } });
      await ledger.record(usage(b.id, { costMicro: 2000 }) as never, b.maxCostMicro, new Date('2026-10-15T12:00:00Z')); // mês anterior
      expect(await ledger.totalMicro()).toBe(1000);
      expect((await ledger.entries()).map((e) => e.executionId)).toEqual([`exec-${a.id}`]);
    } finally {
      await t.close();
    }
  });

  it('callbackId: só o primeiro vê como novo; saúde: último pull sobrescreve a linha única', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const cb = new PgCallbackStore(db);
      expect([await cb.firstSeen('c1', NOW), await cb.firstSeen('c1', NOW), await cb.firstSeen('c2', NOW)]).toEqual([true, false, true]);
      const h = new PgHealthStore(db);
      expect(await h.last()).toBeNull();
      await h.markPull('w1', NOW);
      await h.markPull('w2', new Date(NOW.getTime() + 1000));
      expect(await h.last()).toEqual({ workerId: 'w2', at: '2026-11-23T12:00:01.000Z' });
    } finally {
      await t.close();
    }
  });

  // Só no PostgreSQL REAL (LN_TEST_PG_URL): conexões simultâneas de verdade disputando as mesmas linhas.
  it.skipIf(!isRealTestDb())('FOR UPDATE SKIP LOCKED: 6 pulls simultâneos sobre 30 tarefas entregam cada tarefa a UM só detentor', async () => {
    const t = await createTestDb();
    try {
      const q = new PgLeaseQueue(t.db as unknown as Db);
      for (let i = 1; i <= 30; i++) await q.enqueue(task(i), NOW);
      const claims = await Promise.all(Array.from({ length: 6 }, (_, w) => q.claim({ workerId: `w${w}`, now: NOW, leaseMs: 60_000, limit: 10 })));
      const ids = claims.flat().map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length); // nenhuma tarefa entregue duas vezes na rodada simultânea
      // SKIP LOCKED pula linha travada por outro, então a rodada pode deixar sobra: uma rodada sequencial recolhe o resto, sem repetir ninguém
      const sobra = await q.claim({ workerId: 'w-final', now: NOW, leaseMs: 60_000, limit: 30 });
      const todos = [...ids, ...sobra.map((x) => x.id)];
      expect(new Set(todos).size).toBe(30);
      expect(todos).toHaveLength(30);
      expect((await q.counts()).leased).toBe(30);
    } finally {
      await t.close();
    }
  }, 30_000);
});
