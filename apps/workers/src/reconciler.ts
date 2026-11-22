import { type JobPayload, type QueueName, isQueueName, jobIdFor, parsePayload } from './queues';

/** Linha do outbox (PostgreSQL). status: pending → enqueued → done (ou failed). */
export interface OutboxRow {
  id: string;
  /** Texto do banco; o reconciliador valida contra as filas conhecidas. */
  queue: string;
  refId: string;
  idempotencyKey: string;
}

/**
 * Porta para o PostgreSQL. A implementação real (pg-stores.ts) faz o claim com `FOR UPDATE SKIP LOCKED`
 * e marca um lease (enqueued_at = agora) na mesma transação, para dois reconciliadores não pegarem a mesma linha.
 */
export interface OutboxStore {
  /** Linhas devidas: pending, ou enqueued há mais de staleMs (o Redis pode ter perdido o job). Já reserva o lease. */
  claimDue(limit: number, now: Date, staleMs: number): Promise<OutboxRow[]>;
  markEnqueued(id: string, now: Date): Promise<void>;
  /** Falha transitória (ex.: Redis fora): mantém a linha devida para a próxima rodada; só vira failed após muitas tentativas. */
  markRetry(id: string, error: string, now: Date): Promise<void>;
  /** Falha permanente (payload ou fila inválidos): failed, sem nova tentativa. */
  markFailed(id: string, error: string, now: Date): Promise<void>;
}

/** Porta para a fila (BullMQ). add() é idempotente por jobId. */
export interface QueueSink {
  add(queue: QueueName, jobId: string, payload: JobPayload): Promise<void>;
}

export interface ReconcileResult {
  enqueued: number;
  retry: number;
  failed: number;
}

export async function reconcileOutbox(
  store: OutboxStore,
  sink: QueueSink,
  opts: { limit?: number; staleMs?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const rows = await store.claimDue(opts.limit ?? 100, now, opts.staleMs ?? 60_000);
  const out: ReconcileResult = { enqueued: 0, retry: 0, failed: 0 };
  for (const row of rows) {
    let payload: JobPayload;
    try {
      if (!isQueueName(row.queue)) throw new Error(`fila desconhecida: ${row.queue}`);
      payload = parsePayload({ refId: row.refId, idempotencyKey: row.idempotencyKey });
    } catch (e) {
      out.failed++;
      await store.markFailed(row.id, e instanceof Error ? e.message : String(e), now);
      continue;
    }
    try {
      await sink.add(row.queue as QueueName, jobIdFor(row.queue as QueueName, row.idempotencyKey), payload);
      await store.markEnqueued(row.id, now);
      out.enqueued++;
    } catch (e) {
      out.retry++;
      await store.markRetry(row.id, e instanceof Error ? e.message : String(e), now);
    }
  }
  return out;
}

/** Efeito exatamente-uma-vez: a chave e o efeito entram na MESMA transação (UNIQUE em idempotency_key). */
export interface EffectStore<Tx = unknown> {
  /** Executa o efeito se a chave é nova; false se já havia efeito (duplicata). O efeito recebe a transação. */
  runOnce(idempotencyKey: string, meta: { effect: string; refId: string }, effect: (tx: Tx) => Promise<void>): Promise<boolean>;
}

export async function processJob<Tx>(
  effects: EffectStore<Tx>,
  queue: QueueName,
  raw: unknown,
  effect: (payload: JobPayload, tx: Tx) => Promise<void>,
): Promise<'executed' | 'duplicate'> {
  const payload = parsePayload(raw);
  const ran = await effects.runOnce(payload.idempotencyKey, { effect: queue, refId: payload.refId }, (tx) => effect(payload, tx));
  return ran ? 'executed' : 'duplicate';
}
