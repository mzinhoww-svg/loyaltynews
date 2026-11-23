import { randomUUID } from 'node:crypto';
import type { LeasedTask, NewTask, Task } from './types';

// Fila com lease (pull). A implementação real é o outbox do PostgreSQL (`FOR UPDATE SKIP LOCKED`, do Backend); aqui o
// contrato e uma implementação em memória com a MESMA semântica, usada nos testes e em desenvolvimento.

export class LeaseError extends Error {
  readonly reason: 'tarefa_inexistente' | 'lease_invalida' | 'lease_expirada';
  constructor(reason: LeaseError['reason']) {
    super(`lease: ${reason}`);
    this.name = 'LeaseError';
    this.reason = reason;
  }
}

export interface ClaimRequest {
  workerId: string;
  now: Date;
  leaseMs: number;
  limit: number;
  /** Restringe a tipos (ex.: workers próprios de reserva só pegam alguns). */
  kinds?: readonly string[];
}

export interface LeaseQueue {
  /** Idempotente por `idempotencyKey`. */
  enqueue(task: NewTask, now: Date): Promise<{ created: boolean; task: Task }>;
  /** Entrega tarefas pendentes ou com lease vencido. Nenhuma tarefa é entregue a dois detentores ao mesmo tempo. */
  claim(req: ClaimRequest): Promise<LeasedTask[]>;
  heartbeat(taskId: string, leaseId: string, now: Date, leaseMs: number): Promise<{ leaseExpiresAt: string }>;
  /** Idempotente: repetir com o mesmo lease devolve `already: true`. */
  complete(taskId: string, leaseId: string, resultRef: string | undefined, now: Date): Promise<{ already: boolean; task: Task }>;
  fail(taskId: string, leaseId: string, error: string, retryable: boolean, now: Date): Promise<{ task: Task }>;
  get(taskId: string): Promise<Task | null>;
  counts(): Promise<Record<Task['status'], number>>;
}

export class InMemoryLeaseQueue implements LeaseQueue {
  private readonly tasks = new Map<string, Task>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;
  private readonly newLeaseId: () => string;

  constructor(newLeaseId: () => string = () => randomUUID()) {
    this.newLeaseId = newLeaseId;
  }

  async enqueue(task: NewTask, now: Date) {
    const existingId = this.byKey.get(task.idempotencyKey);
    if (existingId) return { created: false, task: structuredClone(this.tasks.get(existingId) as Task) };
    this.seq += 1;
    const t: Task = {
      ...task,
      id: `task-${String(this.seq).padStart(6, '0')}`,
      status: 'pending',
      attempts: 0,
      maxAttempts: task.maxAttempts ?? 5,
      createdAt: now.toISOString(),
    };
    this.tasks.set(t.id, t);
    this.byKey.set(t.idempotencyKey, t.id);
    return { created: true, task: structuredClone(t) };
  }

  private expired(t: Task, now: Date): boolean {
    return t.status === 'leased' && t.leaseExpiresAt !== undefined && Date.parse(t.leaseExpiresAt) <= now.getTime();
  }

  async claim(req: ClaimRequest): Promise<LeasedTask[]> {
    const out: LeasedTask[] = [];
    for (const t of this.tasks.values()) {
      if (out.length >= req.limit) break;
      if (req.kinds && !req.kinds.includes(t.kind)) continue;
      const claimable = t.status === 'pending' || this.expired(t, req.now);
      if (!claimable) continue;
      if (t.attempts >= t.maxAttempts) {
        t.status = 'dead';
        t.lastError = t.lastError ?? 'tentativas esgotadas';
        t.leaseId = undefined;
        continue;
      }
      t.attempts += 1;
      t.status = 'leased';
      t.leaseId = this.newLeaseId();
      t.leaseHolder = req.workerId;
      t.leaseExpiresAt = new Date(req.now.getTime() + req.leaseMs).toISOString();
      out.push({
        id: t.id, kind: t.kind, profileId: t.profileId, refId: t.refId, dataClass: t.dataClass, maxCostMicro: t.maxCostMicro,
        attempt: t.attempts, leaseId: t.leaseId, leaseExpiresAt: t.leaseExpiresAt,
      });
    }
    return out;
  }

  private holding(taskId: string, leaseId: string, now: Date): Task {
    const t = this.tasks.get(taskId);
    if (!t) throw new LeaseError('tarefa_inexistente');
    if (t.status !== 'leased' || t.leaseId !== leaseId) throw new LeaseError('lease_invalida');
    if (this.expired(t, now)) throw new LeaseError('lease_expirada');
    return t;
  }

  async heartbeat(taskId: string, leaseId: string, now: Date, leaseMs: number) {
    const t = this.holding(taskId, leaseId, now);
    t.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    return { leaseExpiresAt: t.leaseExpiresAt };
  }

  async complete(taskId: string, leaseId: string, resultRef: string | undefined, now: Date) {
    const t = this.tasks.get(taskId);
    if (!t) throw new LeaseError('tarefa_inexistente');
    if (t.status === 'completed' && t.leaseId === leaseId) return { already: true, task: structuredClone(t) };
    this.holding(taskId, leaseId, now);
    t.status = 'completed';
    t.resultRef = resultRef;
    t.leaseExpiresAt = undefined;
    return { already: false, task: structuredClone(t) };
  }

  async fail(taskId: string, leaseId: string, error: string, retryable: boolean, now: Date) {
    const t = this.holding(taskId, leaseId, now);
    t.lastError = error.slice(0, 500);
    t.leaseExpiresAt = undefined;
    if (retryable && t.attempts < t.maxAttempts) {
      t.status = 'pending';
      t.leaseId = undefined;
      t.leaseHolder = undefined;
    } else {
      t.status = retryable ? 'dead' : 'failed';
    }
    return { task: structuredClone(t) };
  }

  async get(taskId: string) {
    const t = this.tasks.get(taskId);
    return t ? structuredClone(t) : null;
  }

  async counts() {
    const c: Record<Task['status'], number> = { pending: 0, leased: 0, completed: 0, failed: 0, dead: 0 };
    for (const t of this.tasks.values()) c[t.status] += 1;
    return c;
  }
}
