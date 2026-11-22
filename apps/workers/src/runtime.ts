// BullMQ sobre Redis (ADR-002): adaptador de fila, workers por fila e laço do reconciliador.
// Não sobe sozinho: index.ts liga tudo a partir do ambiente. O BullMQ NÃO roda sobre ioredis-mock
// (scripts Lua), então este arquivo só é exercitado com Redis real; a lógica testável fica em
// reconciler.ts e pg-stores.ts.
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Db } from '@ln/auth';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type JobPayload, type QueueName } from './queues';
import { PgEffectStore, PgOutboxStore } from './pg-stores';
import { processJob, reconcileOutbox, type QueueSink, type ReconcileResult } from './reconciler';

export class BullQueueSink implements QueueSink {
  private readonly queues = new Map<QueueName, Queue>();
  constructor(private readonly connection: ConnectionOptions) {}

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  /** O jobId determinístico faz o BullMQ ignorar um add repetido (idempotente). */
  async add(queue: QueueName, jobId: string, payload: JobPayload): Promise<void> {
    await this.queue(queue).add(queue, payload, { ...DEFAULT_JOB_OPTIONS, jobId });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

/** Efeito de uma fila: roda dentro da transação do effect_ledger (lançar desfaz tudo e o job é repetido). */
export type JobHandler = (payload: JobPayload, tx: Db) => Promise<void>;
export type Handlers = Partial<Record<QueueName, JobHandler>>;

/**
 * Um Worker por fila COM handler registrado. Fila sem handler não tem worker: os jobs ficam esperando
 * (honesto; nada é "processado" por um handler vazio). Handlers são registrados pelas frentes donas de cada fila.
 */
export function startWorkers(opts: { connection: ConnectionOptions; db: Db; handlers: Handlers; concurrency?: number }) {
  const effects = new PgEffectStore(opts.db);
  const workers: Worker[] = [];
  for (const name of QUEUE_NAMES) {
    const handler = opts.handlers[name];
    if (!handler) continue;
    workers.push(
      new Worker(name, async (job) => void (await processJob(effects, name, job.data, handler)), {
        connection: opts.connection,
        concurrency: opts.concurrency ?? 4,
      }),
    );
  }
  return { workers, close: () => Promise.all(workers.map((w) => w.close())) };
}

/** Reconciliador periódico: recria no Redis o que o outbox ainda deve (perda do Redis não perde trabalho). */
export function startReconciler(opts: {
  db: Db;
  sink: QueueSink;
  intervalMs?: number;
  staleMs?: number;
  onResult?: (r: ReconcileResult) => void;
  onError?: (e: unknown) => void;
}) {
  const store = new PgOutboxStore(opts.db);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reconcileOutbox(store, opts.sink, { staleMs: opts.staleMs });
      if (r.enqueued || r.retry || r.failed) opts.onResult?.(r);
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 5_000);
  return { tick, stop: () => clearInterval(timer) };
}
