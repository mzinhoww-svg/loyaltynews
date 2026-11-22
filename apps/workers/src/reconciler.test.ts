import { describe, expect, it } from 'vitest';
import { jobIdFor, parsePayload, type JobPayload, type QueueName } from './queues';
import { reconcileOutbox, type OutboxRow, type OutboxStore, type QueueSink } from './reconciler';

// Fakes em memória (só aqui). O comportamento contra o PostgreSQL está em pg-stores.test.ts.
class FakeOutbox implements OutboxStore {
  rows = new Map<string, OutboxRow & { status: 'pending' | 'enqueued' | 'done' | 'failed'; at: Date | null; error?: string }>();
  seed(n: number) {
    for (let i = 0; i < n; i++)
      this.rows.set(`o${i}`, { id: `o${i}`, queue: 'coleta', refId: `ref${i}`, idempotencyKey: `k${i}`, status: 'pending', at: null });
  }
  async claimDue(limit: number, now: Date, staleMs: number) {
    const due = [...this.rows.values()]
      .filter((r) => (r.status === 'pending' || r.status === 'enqueued') && (r.at === null || now.getTime() - r.at.getTime() > staleMs))
      .slice(0, limit);
    for (const r of due) r.at = now; // lease
    return due;
  }
  async markEnqueued(id: string, now: Date) { const r = this.rows.get(id)!; r.status = 'enqueued'; r.at = now; }
  async markRetry(id: string, error: string) { const r = this.rows.get(id)!; r.at = null; r.error = error; }
  async markFailed(id: string, error: string) { const r = this.rows.get(id)!; r.status = 'failed'; r.error = error; }
}

class FakeRedis implements QueueSink {
  jobs = new Map<string, JobPayload>();
  down = false;
  async add(_q: QueueName, jobId: string, payload: JobPayload) {
    if (this.down) throw new Error('ECONNREFUSED');
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, payload);
  }
}

describe('payload e jobId', () => {
  it('payload só aceita IDs (sem conteúdo no Redis)', () => {
    expect(parsePayload({ refId: 'a1', idempotencyKey: 'k1' })).toEqual({ refId: 'a1', idempotencyKey: 'k1' });
    expect(() => parsePayload({ refId: 'a1', idempotencyKey: 'k1', corpo: 'texto da matéria' })).toThrow();
    expect(() => parsePayload({ refId: 'texto com espaço', idempotencyKey: 'k1' })).toThrow();
    expect(() => parsePayload({ refId: 'x'.repeat(200), idempotencyKey: 'k1' })).toThrow();
    expect(() => parsePayload(null)).toThrow();
    expect(jobIdFor('coleta', 'k1').includes(':')).toBe(false);
  });
});

describe('reconciliador (lógica pura)', () => {
  it('Redis fora: nada vira failed e tudo é recuperado quando volta', async () => {
    const outbox = new FakeOutbox();
    outbox.seed(100);
    const redis = new FakeRedis();
    redis.down = true;
    expect(await reconcileOutbox(outbox, redis, { now: new Date('2026-11-22T12:00:00Z') })).toEqual({ enqueued: 0, retry: 100, failed: 0 });
    expect([...outbox.rows.values()].every((r) => r.status === 'pending')).toBe(true);
    redis.down = false;
    expect(await reconcileOutbox(outbox, redis, { now: new Date('2026-11-22T12:00:05Z') })).toEqual({ enqueued: 100, retry: 0, failed: 0 });
    expect(redis.jobs.size).toBe(100);
  });

  it('linha inválida (payload ou fila) vira failed sem derrubar as demais', async () => {
    const outbox = new FakeOutbox();
    outbox.seed(3);
    outbox.rows.get('o0')!.refId = 'inválido com espaço';
    outbox.rows.get('o1')!.queue = 'fila-que-nao-existe';
    const res = await reconcileOutbox(outbox, new FakeRedis(), { now: new Date() });
    expect(res).toEqual({ enqueued: 1, retry: 0, failed: 2 });
    expect(outbox.rows.get('o0')!.status).toBe('failed');
    expect(outbox.rows.get('o1')!.status).toBe('failed');
  });

  it('lease: duas rodadas seguidas não reenfileiram o que acabou de ser enfileirado', async () => {
    const outbox = new FakeOutbox();
    outbox.seed(5);
    const redis = new FakeRedis();
    const t0 = new Date('2026-11-22T12:00:00Z');
    expect((await reconcileOutbox(outbox, redis, { now: t0 })).enqueued).toBe(5);
    expect(await reconcileOutbox(outbox, redis, { now: new Date(t0.getTime() + 1000) })).toEqual({ enqueued: 0, retry: 0, failed: 0 });
    expect((await reconcileOutbox(outbox, redis, { now: new Date(t0.getTime() + 61_000) })).enqueued).toBe(5); // lease vencido
    expect(redis.jobs.size).toBe(5); // jobId determinístico: sem duplicata
  });
});
