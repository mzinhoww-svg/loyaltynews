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

// Cada caso começa num banco NOVO (createTestDb clona o modelo já migrado, em PGlite e em PostgreSQL real).
// Não se limpa com TRUNCATE: desde a 0037 o effect_ledger é append-only também por gatilho de STATEMENT
// (effect_ledger_no_truncate), e o teste não desliga gatilho nenhum: roda contra o banco como ele é em produção.
const clear = async () => {
  await t.close();
  t = await createTestDb();
  db = t.db as unknown as Db;
};

describe('enqueueOutbox', () => {
  it('grava na mesma transação do efeito de negócio: se a transação desfaz, o outbox também', async () => {
    await clear();
    await expect(
      db.transaction(async (tx) => {
        await enqueueOutbox(tx as unknown as Db, { queue: 'entidades', refId: 'r1', idempotencyKey: 'k1' });
        throw new Error('efeito de negócio falhou');
      }),
    ).rejects.toThrow();
    expect(await db.$count(schema.outbox)).toBe(0);
    await db.transaction(async (tx) => {
      expect(await enqueueOutbox(tx as unknown as Db, { queue: 'entidades', refId: 'r1', idempotencyKey: 'k1' })).toEqual({ created: true });
      expect(await enqueueOutbox(tx as unknown as Db, { queue: 'entidades', refId: 'r1', idempotencyKey: 'k1' })).toEqual({ created: false });
    });
    expect(await db.$count(schema.outbox)).toBe(1);
    await expect(enqueueOutbox(db, { queue: 'inventada', refId: 'r', idempotencyKey: 'k' })).rejects.toThrow(/fila desconhecida/);
  });

  it('fila desligada recusa o enfileiramento (a transação de negócio desfaz) e não grava linha', async () => {
    await clear();
    for (const queue of ['checagem', 'coleta', 'redacao', 'social', 'metricas', 'reunioes']) {
      await expect(enqueueOutbox(db, { queue, refId: 'a1', idempotencyKey: `off-${queue}` })).rejects.toThrow(/desligada/);
    }
    expect(await db.$count(schema.outbox)).toBe(0);
    // a fila ligada continua aceitando (controle positivo)
    await expect(enqueueOutbox(db, { queue: 'entidades', refId: 'a1', idempotencyKey: 'on-1' })).resolves.toEqual({ created: true });
  });
});

describe('ADR-002: 100 jobs, Redis derrubado no meio', () => {
  it('após religar, o reconciliador conclui todos: zero perdidos e zero efeitos duplicados (outbox e ledger)', async () => {
    await clear();
    for (let i = 0; i < 100; i++) await enqueueOutbox(db, { queue: 'entidades', refId: `ref${i}`, idempotencyKey: `job${i}` });
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
    for (let i = 0; i < 30; i++) await enqueueOutbox(db, { queue: 'entidades', refId: `r${i}`, idempotencyKey: `s${i}` });
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
    await enqueueOutbox(db, { queue: 'entidades', refId: 'a1', idempotencyKey: 'ef1' });
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.idempotencyKey, 'ef1'));
    const effects = new PgEffectStore(db);
    const payload = { refId: 'a1', idempotencyKey: row!.id }; // a chave do job é o id da linha do outbox
    await expect(processJob(effects, 'entidades', payload, async () => { throw new Error('falhou no meio'); })).rejects.toThrow();
    expect(await db.$count(schema.effectLedger)).toBe(0);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'done'))).toBe(0);
    let n = 0;
    const ok = async (_p: JobPayload, tx: Db) => {
      n++;
      await tx.insert(schema.auditLog).values({ id: `au-${n}`, action: 'efeito', resource: 'teste' }); // efeito no mesmo tx
    };
    expect(await processJob(effects, 'entidades', payload, ok)).toBe('executed');
    expect(await processJob(effects, 'entidades', payload, ok)).toBe('duplicate');
    expect(n).toBe(1);
    expect(await db.$count(schema.auditLog, eq(schema.auditLog.resource, 'teste'))).toBe(1);
    expect(await db.$count(schema.outbox, eq(schema.outbox.status, 'done'))).toBe(1);
  });
});

describe('outbox de outros módulos (publicação editorial)', () => {
  it('fila com alias e chave com ":" viram job válido (chave do job = id da linha); fila desconhecida vira failed', async () => {
    await clear();
    const key = `article.published:art-1:${'b'.repeat(64)}`; // formato do Editorial: ':' e 64 hex
    await enqueueOutbox(db, { queue: 'intelligence-ingest', refId: 'art-1', idempotencyKey: key });
    await db.insert(schema.outbox).values({ id: 'x-bad', queue: 'inventada', refId: 'r', idempotencyKey: 'bad-q' });
    const redis = new FakeRedis();
    const res = await reconcileOutbox(new PgOutboxStore(db), redis, { now: new Date('2026-11-22T15:00:00Z') });
    expect(res).toEqual({ enqueued: 1, retry: 0, failed: 1 });
    const [job] = [...redis.jobs.entries()];
    expect(job![1].queue).toBe('entidades');
    expect(job![0]).toMatch(/^entidades__[0-9a-f-]{36}$/);
    expect(job![1].payload.refId).toBe('art-1');
    expect(JSON.stringify(job)).not.toContain('article.published'); // a chave livre do produtor não vai ao Redis
    const effects = new PgEffectStore(db);
    expect(await processJob(effects, 'entidades', job![1].payload, async () => {})).toBe('executed');
    const [done] = await db.select().from(schema.outbox).where(eq(schema.outbox.idempotencyKey, key));
    expect(done?.status).toBe('done');
  });
});

describe('falhas do reconciliador', () => {
  it('linha com fila inválida vira failed; falha transitória repetida chega a failed só após MAX_ATTEMPTS', async () => {
    await clear();
    await db.insert(schema.outbox).values({ id: 'x1', queue: 'nao-existe', refId: 'r', idempotencyKey: 'bad1' });
    await enqueueOutbox(db, { queue: 'entidades', refId: 'r', idempotencyKey: 'flaky' });
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
