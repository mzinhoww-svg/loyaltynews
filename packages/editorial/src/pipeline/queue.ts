import type { JobSpec, Stage, StageOutcome } from './jobs.ts';
import { STAGES, queueName } from './jobs.ts';
import type { PublishedInfo, StageDeps } from './stages.ts';
import { runStage } from './stages.ts';

/** Porta de fila. Duas implementações: em memória (testes/dev) e BullMQ (produção, Redis na Vertra). */
export interface JobQueue {
  enqueue(spec: JobSpec): Promise<void>;
}

export interface BullQueueLike { add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown> }
export interface BullWorkerLike { close(): Promise<void> }
export interface BullmqLike {
  Queue: new (name: string, opts: { connection: unknown }) => BullQueueLike;
  Worker: new (name: string, processor: (job: { id?: string; data: unknown }) => Promise<unknown>, opts: { connection: unknown; concurrency?: number }) => BullWorkerLike;
}

/** Opções de job: jobId = idempotência (BullMQ ignora duplicata com o mesmo id), 3 tentativas, backoff exponencial. */
export function jobOptions(spec: JobSpec): Record<string, unknown> {
  return { jobId: spec.jobId, attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: { age: 86_400 }, removeOnFail: false };
}

export interface PipelineHooks {
  onBlocked?(o: Extract<StageOutcome, { kind: 'blocked' }>): void | Promise<void>;
  onDone?(o: Extract<StageOutcome, { kind: 'done' }>): void | Promise<void>;
  /** URL pública resolvida após publicação (WF03). Necessária para o estágio social_pack. */
  publishedFor?(articleId: string): PublishedInfo | undefined;
}

/** Processador comum a ambas as filas: executa o estágio e enfileira o próximo (ou reporta bloqueio/conclusão). */
export function makeProcessor(deps: StageDeps, queue: JobQueue, hooks: PipelineHooks = {}) {
  return async (spec: JobSpec): Promise<StageOutcome> => {
    const out = await runStage(deps, spec, hooks.publishedFor?.(spec.data.articleId));
    if (out.kind === 'next') await queue.enqueue(out.next);
    else if (out.kind === 'blocked') await hooks.onBlocked?.(out);
    else await hooks.onDone?.(out);
    return out;
  };
}

/** Fila em memória: ordem FIFO, idempotência por jobId. Sem Redis, sem rede. */
export class InMemoryQueue implements JobQueue {
  readonly seen = new Set<string>();
  private readonly pending: JobSpec[] = [];
  readonly processed: Array<{ spec: JobSpec; outcome: StageOutcome }> = [];
  async enqueue(spec: JobSpec): Promise<void> {
    if (this.seen.has(spec.jobId)) return;
    this.seen.add(spec.jobId);
    this.pending.push(spec);
  }
  async drain(processor: (s: JobSpec) => Promise<StageOutcome>, limit = 100): Promise<void> {
    let n = 0;
    while (this.pending.length) {
      if (++n > limit) throw new Error('drain: limite de jobs excedido');
      const spec = this.pending.shift()!;
      this.processed.push({ spec, outcome: await processor(spec) });
    }
  }
}

/** Adaptador BullMQ: injeta o módulo `bullmq` (import dinâmico no ponto de composição), sem dependência dura. */
export function createBullmqPipeline(bullmq: BullmqLike, connection: unknown, deps: StageDeps, hooks: PipelineHooks = {}) {
  const queues = new Map<Stage, BullQueueLike>();
  for (const s of STAGES) queues.set(s, new bullmq.Queue(queueName(s), { connection }));
  const queue: JobQueue = {
    async enqueue(spec) { await queues.get(spec.stage)!.add(spec.stage, spec, jobOptions(spec)); },
  };
  const process = makeProcessor(deps, queue, hooks);
  const workers = STAGES.map((s) => new bullmq.Worker(queueName(s), async (job) => {
    const out = await process(job.data as JobSpec);
    if (out.kind === 'blocked') return { blocked: out.blocked }; // bloqueio é resultado, não falha: não reexecuta
    return { kind: out.kind };
  }, { connection, concurrency: 2 }));
  return { queue, workers, close: async () => { await Promise.all(workers.map((w) => w.close())); } };
}
