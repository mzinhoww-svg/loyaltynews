// Stores do adaptador OpenBot (ADR-003) sobre o PostgreSQL: a verdade da fila, do dedupe de callback, dos custos e da saúde.
// Implementam as interfaces de @ln/openbot (LeaseQueue, CostLedger, HealthStore, CallbackStore) com a MESMA semântica das versões em memória,
// mas com trava de linha: `claim` usa `FOR UPDATE SKIP LOCKED` (duas conexões nunca recebem a mesma tarefa), lease/heartbeat/complete/fail
// travam a linha da tarefa e o `callbackId` e o `executionId` são chaves primárias (a primeira inserção vence, em qualquer processo).
// Só ids e limites: nenhum conteúdo editorial. Nenhum segredo passa por aqui.
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { monthKey } from '@ln/modelops';
import {
  LeaseError,
  type CallbackStore, type ClaimRequest, type CostEntry, type CostLedger, type HealthStore, type LeaseQueue, type LeasedTask, type NewTask, type Task, type UsageReport,
} from '@ln/openbot';

type TaskRow = typeof schema.openbotTasks.$inferSelect;
const iso = (d: Date | null): string | undefined => (d ? d.toISOString() : undefined);

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    kind: r.kind as Task['kind'],
    profileId: r.profileId,
    refId: r.refId,
    idempotencyKey: r.idempotencyKey,
    dataClass: r.dataClass as Task['dataClass'],
    maxCostMicro: r.maxCostMicro,
    maxAttempts: r.maxAttempts,
    status: r.status as Task['status'],
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    ...(r.leaseId ? { leaseId: r.leaseId } : {}),
    ...(r.leaseHolder ? { leaseHolder: r.leaseHolder } : {}),
    ...(r.leaseExpiresAt ? { leaseExpiresAt: iso(r.leaseExpiresAt)! } : {}),
    ...(r.resultRef ? { resultRef: r.resultRef } : {}),
    ...(r.lastError ? { lastError: r.lastError } : {}),
  };
}

export class PgLeaseQueue implements LeaseQueue {
  constructor(private readonly db: Db, private readonly newId: () => string = () => crypto.randomUUID()) {}

  async enqueue(task: NewTask, now: Date) {
    const ins = await this.db
      .insert(schema.openbotTasks)
      .values({
        id: `task-${this.newId()}`,
        kind: task.kind,
        profileId: task.profileId,
        refId: task.refId,
        idempotencyKey: task.idempotencyKey,
        dataClass: task.dataClass,
        maxCostMicro: task.maxCostMicro,
        maxAttempts: task.maxAttempts ?? 5,
        createdAt: now,
      })
      .onConflictDoNothing({ target: schema.openbotTasks.idempotencyKey })
      .returning();
    if (ins[0]) return { created: true, task: toTask(ins[0]) };
    const [existing] = await this.db.select().from(schema.openbotTasks).where(eq(schema.openbotTasks.idempotencyKey, task.idempotencyKey));
    return { created: false, task: toTask(existing!) };
  }

  async claim(req: ClaimRequest): Promise<LeasedTask[]> {
    const t = schema.openbotTasks;
    return this.db.transaction(async (tx) => {
      const claimable = and(
        or(eq(t.status, 'pending'), and(eq(t.status, 'leased'), lte(t.leaseExpiresAt, req.now))),
        req.kinds && req.kinds.length > 0 ? inArray(t.kind, [...req.kinds]) : undefined,
      );
      // 1) esgotadas viram 'dead' (nunca são entregues de novo)
      const exausted = await tx
        .select({ id: t.id })
        .from(t)
        .where(and(claimable, sql`${t.attempts} >= ${t.maxAttempts}`))
        .for('update', { skipLocked: true });
      if (exausted.length > 0) {
        await tx.update(t).set({ status: 'dead', leaseId: null, leaseHolder: null, leaseExpiresAt: null, lastError: sql`coalesce(${t.lastError}, 'tentativas esgotadas')` }).where(inArray(t.id, exausted.map((r) => r.id)));
      }
      // 2) as demais, na ordem de chegada, travadas sem esperar ninguém (SKIP LOCKED)
      const rows = await tx
        .select()
        .from(t)
        .where(and(claimable, sql`${t.attempts} < ${t.maxAttempts}`))
        .orderBy(asc(t.seq))
        .limit(req.limit)
        .for('update', { skipLocked: true });
      const out: LeasedTask[] = [];
      for (const r of rows) {
        const leaseId = crypto.randomUUID();
        const expires = new Date(req.now.getTime() + req.leaseMs);
        await tx.update(t).set({ attempts: r.attempts + 1, status: 'leased', leaseId, leaseHolder: req.workerId, leaseExpiresAt: expires }).where(eq(t.id, r.id));
        out.push({
          id: r.id, kind: r.kind as LeasedTask['kind'], profileId: r.profileId, refId: r.refId, dataClass: r.dataClass as LeasedTask['dataClass'],
          maxCostMicro: r.maxCostMicro, attempt: r.attempts + 1, leaseId, leaseExpiresAt: expires.toISOString(),
        });
      }
      return out;
    });
  }

  /** Trava a linha e confere que o lease é do chamador e está vivo. */
  private async lockHolding(tx: Db, taskId: string, leaseId: string, now: Date): Promise<TaskRow> {
    const [r] = await tx.select().from(schema.openbotTasks).where(eq(schema.openbotTasks.id, taskId)).for('update');
    if (!r) throw new LeaseError('tarefa_inexistente');
    if (r.status !== 'leased' || r.leaseId !== leaseId) throw new LeaseError('lease_invalida');
    if (r.leaseExpiresAt && r.leaseExpiresAt.getTime() <= now.getTime()) throw new LeaseError('lease_expirada');
    return r;
  }

  async heartbeat(taskId: string, leaseId: string, now: Date, leaseMs: number) {
    return this.db.transaction(async (tx) => {
      await this.lockHolding(tx as unknown as Db, taskId, leaseId, now);
      const expires = new Date(now.getTime() + leaseMs);
      await tx.update(schema.openbotTasks).set({ leaseExpiresAt: expires }).where(eq(schema.openbotTasks.id, taskId));
      return { leaseExpiresAt: expires.toISOString() };
    });
  }

  async complete(taskId: string, leaseId: string, resultRef: string | undefined, now: Date) {
    return this.db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      const [cur] = await t.select().from(schema.openbotTasks).where(eq(schema.openbotTasks.id, taskId)).for('update');
      if (!cur) throw new LeaseError('tarefa_inexistente');
      if (cur.status === 'completed' && cur.leaseId === leaseId) return { already: true, task: toTask(cur) };
      await this.lockHolding(t, taskId, leaseId, now);
      const [u] = await t.update(schema.openbotTasks).set({ status: 'completed', resultRef: resultRef ?? null, leaseExpiresAt: null }).where(eq(schema.openbotTasks.id, taskId)).returning();
      return { already: false, task: toTask(u!) };
    });
  }

  async fail(taskId: string, leaseId: string, error: string, retryable: boolean, now: Date) {
    return this.db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      const r = await this.lockHolding(t, taskId, leaseId, now);
      const lastError = error.slice(0, 500);
      const again = retryable && r.attempts < r.maxAttempts;
      const [u] = await t
        .update(schema.openbotTasks)
        .set(
          again
            ? { status: 'pending', leaseId: null, leaseHolder: null, leaseExpiresAt: null, lastError }
            : { status: retryable ? 'dead' : 'failed', leaseExpiresAt: null, lastError },
        )
        .where(eq(schema.openbotTasks.id, taskId))
        .returning();
      return { task: toTask(u!) };
    });
  }

  async get(taskId: string) {
    const [r] = await this.db.select().from(schema.openbotTasks).where(eq(schema.openbotTasks.id, taskId));
    return r ? toTask(r) : null;
  }

  async counts() {
    const c: Record<Task['status'], number> = { pending: 0, leased: 0, completed: 0, failed: 0, dead: 0 };
    const rows = await this.db.select({ status: schema.openbotTasks.status, n: sql<number>`count(*)::int` }).from(schema.openbotTasks).groupBy(schema.openbotTasks.status);
    for (const r of rows) c[r.status as Task['status']] = r.n;
    return c;
  }
}

/** Dedupe de callback: `INSERT ... ON CONFLICT DO NOTHING`; só quem inseriu vê o id pela primeira vez (atômico entre processos). */
export class PgCallbackStore implements CallbackStore {
  constructor(private readonly db: Db) {}
  async firstSeen(callbackId: string, now: Date): Promise<boolean> {
    const r = await this.db.insert(schema.openbotCallbacks).values({ callbackId, seenAt: now }).onConflictDoNothing().returning({ id: schema.openbotCallbacks.callbackId });
    return r.length > 0;
  }
}

/** Custos relatados, deduplicados por `executionId`. O teto mensal olha o mês (America/Sao_Paulo) do relógio injetado. */
export class PgCostLedger implements CostLedger {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  private toEntry(r: typeof schema.openbotCostEntries.$inferSelect): CostEntry {
    return {
      executionId: r.executionId, taskId: r.taskId, leaseId: r.leaseId, model: r.model, generationIds: r.generationIds as string[],
      promptTokens: r.promptTokens, completionTokens: r.completionTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens,
      costMicro: r.costMicro, recordedAt: r.recordedAt.toISOString(), overrun: r.overrun,
    };
  }

  async record(report: UsageReport, maxCostMicro: number, now: Date) {
    const ins = await this.db
      .insert(schema.openbotCostEntries)
      .values({
        executionId: report.executionId, taskId: report.taskId, leaseId: report.leaseId, model: report.model, generationIds: report.generationIds,
        promptTokens: report.promptTokens, completionTokens: report.completionTokens, cacheReadTokens: report.cacheReadTokens, cacheWriteTokens: report.cacheWriteTokens,
        costMicro: report.costMicro, overrun: report.costMicro > maxCostMicro, monthKey: monthKey(now), recordedAt: now,
      })
      .onConflictDoNothing({ target: schema.openbotCostEntries.executionId })
      .returning();
    if (ins[0]) return { recorded: true, entry: this.toEntry(ins[0]) };
    const [prior] = await this.db.select().from(schema.openbotCostEntries).where(eq(schema.openbotCostEntries.executionId, report.executionId));
    return { recorded: false, entry: this.toEntry(prior!) };
  }

  async entries() {
    return (await this.db.select().from(schema.openbotCostEntries).where(eq(schema.openbotCostEntries.monthKey, monthKey(this.clock()))).orderBy(asc(schema.openbotCostEntries.recordedAt))).map((r) => this.toEntry(r));
  }

  async totalMicro() {
    const [r] = await this.db
      .select({ s: sql<number>`coalesce(sum(${schema.openbotCostEntries.costMicro}), 0)::bigint` })
      .from(schema.openbotCostEntries)
      .where(eq(schema.openbotCostEntries.monthKey, monthKey(this.clock())));
    return Number(r?.s ?? 0);
  }
}

/** Último pull recebido (linha única). */
export class PgHealthStore implements HealthStore {
  constructor(private readonly db: Db) {}
  async markPull(workerId: string, now: Date) {
    await this.db
      .insert(schema.openbotHealth)
      .values({ id: 'pull', workerId, at: now })
      .onConflictDoUpdate({ target: schema.openbotHealth.id, set: { workerId, at: now } });
  }
  async last() {
    const [r] = await this.db.select().from(schema.openbotHealth).where(eq(schema.openbotHealth.id, 'pull'));
    return r ? { workerId: r.workerId, at: r.at.toISOString() } : null;
  }
}
