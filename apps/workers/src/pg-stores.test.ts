// ADR-002 contra PostgreSQL de verdade (PGlite): outbox, lease, perda do Redis, idempotência e atomicidade do efeito.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import type { JobPayload, QueueName } from './queues';
import { enqueueOutbox, MAX_ATTEMPTS, PgEffectStore, PgOutboxStore } from './pg-stores';
import { processJob, reconcileOutbox, type QueueSink } from './reconciler';

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(async () => {
  await t.close();
});

class FakeRedis implements QueueSink {
  jobs = new Map<string, { queue: QueueName; payload: JobPayload }>();
  down = false;
  async add(queue: QueueName, jobId: string, payload: JobPayload) {
    if (this.down) throw new Error('ECONNREFUSED');
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, { queue, payload });
  }
  wipe() { this.jobs.clear(); }
}

const clear = async () => {
  await t.client.exec('TRUNCATE outbox; ALTER TABLE effect_ledger DISABLE TRIGGER effect_ledger_append_only; TRUNCATE effect_ledger; ALTER TABLE effect_ledger ENABLE TRIGGER effect_ledger_append_only;');
};

describe('enqueueOutbox', () => {
  it('grava na mesma transação do efeito de negócio: se a transação desfaz, o outbox também', async () => {
    await clear();
    await expect(
      db.transaction(async (tx) => {
        await enqueueOutbox(tx as unknown as Db, { queue: 'coleta', refId: 'r1', idempotencyKey: 'k1' });
        throw new Error('efeito de negócio falhou');
      }),
    ).rejects.toThrow();
    expect(await db.$count(schema.outbox)).toBe(0);
    await db.transaction(async (tx) => {
      expect(await enqueueOutbox(tx as unknown as Db, { queue: 'coleta', refId: 'r1', idempotencyKey: 'k1' })).toEqual({ created: true });
      expect(await enqueueOutbox(tx as unknown as Db, { queue: 'coleta', refId: 'r1', idempotencyKey: 'k1' })).toEqual({ created: false });
    });
    expect(await db.$count(schema.outbox)).toBe(1);
    await expect(enqueueOutbox(db, { queue: 'inventada', refId: 'r', idempotencyKey: 'k' })).rejects.toThrow(/fila desconhecida/);
  });
});

describe('ADR-002: 100 jobs, Redis derrubado no meio', () => {
  it('após religar, o reconciliador conclui todos: zero perdidos e zero efeitos duplicados (outbox e ledger)', async () => {
    await clear();
    for (let i = 0; i < 100; i++) await enqueueOutbox(db, { queue: 'coleta', refId: `ref${i}`, idempotencyKey: `job${i}` });
    const store = new PgOutboxStore(db);
    const effects = new PgEffectStore(db);
    let redis = new FakeRedis();
    const t0 = new Date('2026-11-22T12:00:00Z');
    let applied = 0;
    const effect = async () => { applied++; };

    // Redis fora no começo: nada se perde, nada vira failed
    redis.down = true;
    expect(await reconcileOutbox(store, redis, { now: t0, limit: 500 })).toEqual({ enqueued: 0, retry: 100, failed: 0 });
    redis.down = false;
    expect(await reconcileOutbox(store, redis, { now: new Date(t0.getTime() + 1000), limit: 500 })).toEqual({ enqueued: 100, retry: 0, failed: 0 });

    // o worker processa 40 e o Redis cai (perde os 60 restantes)
    const jobs = [...redis.jobs.values()];
    for (const j of jobs.slice(0, 40)) expect(await processJob(effects, j.queue, j.payload, effect)).toBe('executed');
    redis = new FakeRedis();

    // dentro do lease nada é reenfileirado; vencido o lease, só os 60 não concluídos voltam
    expect((await reconcileOutbox(store, redis, { now: new Date(t0.getTime() + 2000), limit: 500 })).enqueued).toBe(0);
    expect((await reconcileOutbox(store, redis, { now: new Date(t0.getTime() + 70_000), limit: 500 })).enqueued).toBe(60);

    // e reenviar tudo 2× (inclusive jobs já concluídos) não duplica efeito
    for (const j of [...redis.jobs.values(), ...jobs.slice(0, 40), ...redis.jobs.values()]) await processJob(effects, j.queue, j.payload, effect);
    expect(applied).toBe(100);
    expect(await db.$count(schema.effectLedger)).toBe(100);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'done'))).toBe(100);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'failed'))).toBe(0);
  });

  it('dois reconciliadores simultâneos não pegam as mesmas linhas (lease + SKIP LOCKED)', async () => {
    await clear();
    for (let i = 0; i < 30; i++) await enqueueOutbox(db, { queue: 'social', refId: `r${i}`, idempotencyKey: `s${i}` });
    const store = new PgOutboxStore(db);
    const now = new Date('2026-11-22T13:00:00Z');
    const [a, b] = await Promise.all([store.claimDue(30, now, 60_000), store.claimDue(30, now, 60_000)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(30);
  });
});

describe('efeito exatamente-uma-vez', () => {
  it('efeito que lança desfaz o ledger (o job pode ser repetido); reenvio produz um efeito só', async () => {
    await clear();
    await enqueueOutbox(db, { queue: 'redacao', refId: 'a1', idempotencyKey: 'ef1' });
    const effects = new PgEffectStore(db);
    const payload = { refId: 'a1', idempotencyKey: 'ef1' };
    await expect(processJob(effects, 'redacao', payload, async () => { throw new Error('falhou no meio'); })).rejects.toThrow();
    expect(await db.$count(schema.effectLedger)).toBe(0);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'done'))).toBe(0);
    let n = 0;
    const ok = async (_p: JobPayload, tx: Db) => {
      n++;
      await tx.insert(schema.auditLog).values({ id: `au-${n}`, action: 'efeito', resource: 'teste' }); // efeito no mesmo tx
    };
    expect(await processJob(effects, 'redacao', payload, ok)).toBe('executed');
    expect(await processJob(effects, 'redacao', payload, ok)).toBe('duplicate');
    expect(n).toBe(1);
    expect(await db.$count(schema.auditLog, eq(schema.auditLog.resource, 'teste'))).toBe(1);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'done'))).toBe(1);
  });
});

describe('falhas do reconciliador', () => {
  it('linha com fila inválida vira failed; falha transitória repetida chega a failed só após MAX_ATTEMPTS', async () => {
    await clear();
    await db.insert(schema.outbox).values({ id: 'x1', queue: 'nao-existe', refId: 'r', idempotencyKey: 'bad1' });
    await enqueueOutbox(db, { queue: 'metricas', refId: 'r', idempotencyKey: 'flaky' });
    const store = new PgOutboxStore(db);
    const redis = new FakeRedis();
    redis.down = true;
    let now = new Date('2026-11-22T14:00:00Z');
    expect(await reconcileOutbox(store, redis, { now })).toEqual({ enqueued: 0, retry: 1, failed: 1 });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      now = new Date(now.getTime() + 1000);
      await reconcileOutbox(store, redis, { now });
    }
    const [flaky] = await db.select().from(schema.outbox).where(eq(schema.outbox.idempotencyKey, 'flaky'));
    expect(flaky?.status).toBe('failed');
    expect(flaky?.attempts).toBe(MAX_ATTEMPTS);
    expect(flaky?.lastError).toMatch(/ECONNREFUSED/);
  });
});
