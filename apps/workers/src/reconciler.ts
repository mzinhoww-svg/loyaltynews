import { type JobPayload, type QueueName, jobIdFor, parsePayload } from './queues.ts';

/** Linha do outbox (PostgreSQL). status: pending → enqueued → done. */
export interface OutboxRow {
  id: string;
  queue: QueueName;
  refId: string;
  idempotencyKey: string;
}

/**
 * Porta para o PostgreSQL. A implementação real (packages/db) faz claim com
 * `FOR UPDATE SKIP LOCKED` e lease; aqui só o contrato.
 */
export interface OutboxStore {
  /** Linhas pending, mais as enqueued há mais de staleMs (Redis pode ter perdido o job). */
  claimDue(limit: number, now: Date, staleMs: number): Promise<OutboxRow[]>;
  markEnqueued(id: string, now: Date): Promise<void>;
  markFailed(id: string, error: string, now: Date): Promise<void>;
}

/** Porta para a fila (BullMQ). add() é idempotente por jobId. */
export interface QueueSink {
  add(queue: QueueName, jobId: string, payload: JobPayload): Promise<void>;
}

export interface ReconcileResult {
  enqueued: number;
  failed: number;
}

export async function reconcileOutbox(
  store: OutboxStore,
  sink: QueueSink,
  opts: { limit?: number; staleMs?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const rows = await store.claimDue(opts.limit ?? 100, now, opts.staleMs ?? 60_000);
  let enqueued = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const payload = parsePayload({ refId: row.refId, idempotencyKey: row.idempotencyKey });
      await sink.add(row.queue, jobIdFor(row.queue, row.idempotencyKey), payload);
      await store.markEnqueued(row.id, now);
      enqueued++;
    } catch (e) {
      failed++;
      await store.markFailed(row.id, e instanceof Error ? e.message : String(e), now);
    }
  }
  return { enqueued, failed };
}

/** Efeito exatamente-uma-vez: a chave e o efeito entram na MESMA transação (UNIQUE em idempotency_key). */
export interface EffectStore {
  /** Retorna true se executou o efeito, false se a chave já tinha efeito (duplicata). */
  runOnce(idempotencyKey: string, effect: () => Promise<void>): Promise<boolean>;
}

export async function processJob(
  effects: EffectStore,
  raw: unknown,
  effect: (payload: JobPayload) => Promise<void>,
): Promise<'executed' | 'duplicate'> {
  const payload = parsePayload(raw);
  const ran = await effects.runOnce(payload.idempotencyKey, () => effect(payload));
  return ran ? 'executed' : 'duplicate';
}
