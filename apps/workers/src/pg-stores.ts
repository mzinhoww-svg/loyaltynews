// Implementações PostgreSQL das portas do reconciliador (ADR-002): o banco é a verdade; o Redis só leva IDs.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { QUEUE_DECISIONS, QueueDisabledError, isQueueEnabled, resolveQueue } from './queues';
import type { EffectStore, OutboxRow, OutboxStore } from './reconciler';

export const MAX_ATTEMPTS = 20;

/** Grava o evento no outbox na MESMA transação do efeito de negócio (passe o `tx`). Idempotente pela chave. */
export async function enqueueOutbox(
  tx: Db,
  e: { queue: string; refId: string; idempotencyKey: string },
): Promise<{ created: boolean }> {
  const queue = resolveQueue(e.queue);
  if (!queue) throw new Error(`fila desconhecida: ${e.queue}`);
  // Fila desligada não aceita job: o produtor falha agora (a transação de negócio desfaz) em vez de
  // gravar trabalho que nenhum worker vai consumir.
  if (!isQueueEnabled(queue)) throw new QueueDisabledError(queue, QUEUE_DECISIONS[queue].why);
  const rows = await tx
    .insert(schema.outbox)
    .values({ id: randomUUID(), queue: e.queue, refId: e.refId, idempotencyKey: e.idempotencyKey })
    .onConflictDoNothing({ target: schema.outbox.idempotencyKey })
    .returning({ id: schema.outbox.id });
  return { created: rows.length > 0 };
}

export class PgOutboxStore implements OutboxStore {
  constructor(private readonly db: Db) {}

  async claimDue(limit: number, now: Date, staleMs: number): Promise<OutboxRow[]> {
    const staleBefore = new Date(now.getTime() - staleMs);
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(schema.outbox)
        .where(
          and(
            inArray(schema.outbox.status, ['pending', 'enqueued']),
            or(isNull(schema.outbox.enqueuedAt), lt(schema.outbox.enqueuedAt, staleBefore)),
          ),
        )
        .orderBy(schema.outbox.createdAt, schema.outbox.id)
        .limit(limit)
        .for('update', { skipLocked: true });
      if (!due.length) return [];
      await tx
        .update(schema.outbox)
        .set({ enqueuedAt: now, attempts: sql`${schema.outbox.attempts} + 1`, updatedAt: now }) // lease
        .where(inArray(schema.outbox.id, due.map((r) => r.id)));
      return due.map((r) => ({ id: r.id, queue: r.queue, refId: r.refId, idempotencyKey: r.idempotencyKey }));
    });
  }

  async markEnqueued(id: string, now: Date): Promise<void> {
    await this.db
      .update(schema.outbox)
      .set({ status: 'enqueued', enqueuedAt: now, lastError: null, updatedAt: now })
      .where(and(eq(schema.outbox.id, id), inArray(schema.outbox.status, ['pending', 'enqueued'])));
  }

  async markRetry(id: string, error: string, now: Date): Promise<void> {
    await this.db
      .update(schema.outbox)
      .set({
        enqueuedAt: null, // devida de novo na próxima rodada
        lastError: error.slice(0, 500),
        updatedAt: now,
        status: sql`CASE WHEN ${schema.outbox.attempts} >= ${MAX_ATTEMPTS} THEN 'failed'::outbox_status ELSE ${schema.outbox.status} END`,
      })
      .where(and(eq(schema.outbox.id, id), inArray(schema.outbox.status, ['pending', 'enqueued'])));
  }

  async markFailed(id: string, error: string, now: Date): Promise<void> {
    await this.db
      .update(schema.outbox)
      .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: now })
      .where(eq(schema.outbox.id, id));
  }
}

/** effect_ledger + efeito + outbox 'done' numa só transação: exatamente um efeito por chave. */
export class PgEffectStore implements EffectStore<Db> {
  constructor(private readonly db: Db) {}

  async runOnce(key: string, meta: { effect: string; refId: string }, effect: (tx: Db) => Promise<void>): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(schema.effectLedger)
        .values({ idempotencyKey: key, effect: meta.effect, refId: meta.refId })
        .onConflictDoNothing({ target: schema.effectLedger.idempotencyKey })
        .returning({ k: schema.effectLedger.idempotencyKey });
      if (!claimed.length) return false; // outro job (ou reenvio) já produziu o efeito
      await effect(tx as unknown as Db); // se lançar, a transação inteira desfaz, inclusive a linha do ledger
      await tx
        .update(schema.outbox)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(schema.outbox.id, key)); // a chave do job é o id da linha do outbox
      return true;
    });
  }
}
