import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobIdFor, parsePayload, type JobPayload, type QueueName } from './queues.ts';
import { processJob, reconcileOutbox, type EffectStore, type OutboxRow, type OutboxStore, type QueueSink } from './reconciler.ts';

// Fakes em memória (só testes; o teste com PGlite + ioredis-mock vem após o scaffold).
class FakeOutbox implements OutboxStore {
  rows = new Map<string, OutboxRow & { status: 'pending' | 'enqueued' | 'done' | 'failed'; at: Date | null }>();
  seed(n: number) {
    for (let i = 0; i < n; i++)
      this.rows.set(`o${i}`, { id: `o${i}`, queue: 'coleta', refId: `ref${i}`, idempotencyKey: `k${i}`, status: 'pending', at: null });
  }
  async claimDue(limit: number, now: Date, staleMs: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'pending' || (r.status === 'enqueued' && r.at !== null && now.getTime() - r.at.getTime() > staleMs))
      .slice(0, limit);
  }
  async markEnqueued(id: string, now: Date) { const r = this.rows.get(id)!; r.status = 'enqueued'; r.at = now; }
  async markFailed(id: string) { this.rows.get(id)!.status = 'failed'; }
}

class FakeRedis implements QueueSink {
  jobs = new Map<string, JobPayload>();
  async add(_q: QueueName, jobId: string, payload: JobPayload) { if (!this.jobs.has(jobId)) this.jobs.set(jobId, payload); }
}

class FakeEffects implements EffectStore {
  seen = new Set<string>();
  count = 0;
  async runOnce(key: string, effect: () => Promise<void>) {
    if (this.seen.has(key)) return false;
    await effect();
    this.seen.add(key);
    this.count++;
    return true;
  }
}

test('payload só aceita IDs (sem conteúdo no Redis)', () => {
  assert.deepEqual(parsePayload({ refId: 'a1', idempotencyKey: 'k1' }), { refId: 'a1', idempotencyKey: 'k1' });
  assert.throws(() => parsePayload({ refId: 'a1', idempotencyKey: 'k1', corpo: 'texto da matéria' }));
  assert.throws(() => parsePayload({ refId: 'texto com espaço', idempotencyKey: 'k1' }));
  assert.throws(() => parsePayload({ refId: 'x'.repeat(200), idempotencyKey: 'k1' }));
  assert.throws(() => parsePayload(null));
  assert.equal(jobIdFor('coleta', 'k1').includes(':'), false);
});

test('ADR-002: Redis perdido no meio de 100 jobs; reconciliador conclui todos, zero perdidos, zero duplicados', async () => {
  const outbox = new FakeOutbox();
  outbox.seed(100);
  let redis = new FakeRedis();
  const effects = new FakeEffects();
  const t0 = new Date('2026-11-22T12:00:00Z');

  // 1ª passada enfileira os 100
  assert.deepEqual(await reconcileOutbox(outbox, redis, { now: t0 }), { enqueued: 100, failed: 0 });
  // worker processa só 40 e o Redis cai (perde tudo)
  const first = [...redis.jobs.values()].slice(0, 40);
  for (const p of first) {
    await processJob(effects, p, async () => {});
    outbox.rows.get(`o${p.refId.slice(3)}`)!.status = 'done';
  }
  redis = new FakeRedis();

  // dentro da janela de lease nada é reenfileirado; após staleMs, os 60 restantes voltam
  const t1 = new Date(t0.getTime() + 61_000);
  assert.deepEqual(await reconcileOutbox(outbox, redis, { now: t1, limit: 500 }), { enqueued: 60, failed: 0 });
  for (const p of redis.jobs.values()) await processJob(effects, p, async () => {});
  assert.equal(effects.count, 100);
});

test('idempotência: mesmo job 2× produz um efeito; reconciliar 2× não duplica o job', async () => {
  const effects = new FakeEffects();
  const p = { refId: 'a', idempotencyKey: 'k' };
  assert.equal(await processJob(effects, p, async () => {}), 'executed');
  assert.equal(await processJob(effects, p, async () => {}), 'duplicate');
  assert.equal(effects.count, 1);

  const outbox = new FakeOutbox();
  outbox.seed(1);
  const redis = new FakeRedis();
  await reconcileOutbox(outbox, redis, { now: new Date('2026-11-22T12:00:00Z') });
  await reconcileOutbox(outbox, redis, { now: new Date('2026-11-22T12:05:00Z'), staleMs: 1000 });
  assert.equal(redis.jobs.size, 1);
});

test('linha inválida vira failed sem derrubar as demais', async () => {
  const outbox = new FakeOutbox();
  outbox.seed(2);
  outbox.rows.get('o0')!.refId = 'inválido com espaço';
  const res = await reconcileOutbox(outbox, new FakeRedis(), { now: new Date() });
  assert.deepEqual(res, { enqueued: 1, failed: 1 });
  assert.equal(outbox.rows.get('o0')!.status, 'failed');
});
