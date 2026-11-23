// Stores do adaptador OpenBot (ADR-003) sobre o PostgreSQL: a verdade da fila, do dedupe de callback, dos custos, da saúde, da trilha e do estado do piloto
// e do armazém de conteúdo (TaskIo). Implementam as interfaces de @ln/openbot com a MESMA semântica das versões em memória, mas com trava de linha:
// `claim` usa `FOR UPDATE SKIP LOCKED` (duas conexões nunca recebem a mesma tarefa), lease/heartbeat/complete/fail travam a linha da tarefa, e `callbackId`
// e `executionId` são chaves primárias (a primeira inserção vence, em qualquer processo). A fila leva só ids e limites; o conteúdo vive em `openbot_io`.
// Nenhum segredo passa por aqui.
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { monthKey } from '@ln/modelops';
import {
  FALLBACK_ROUTE, InputConflict, LeaseError,
  type Account, type CallbackStore, type ClaimRequest, type CostEntry, type CostLedger, type HealthStore, type LeaseQueue, type LeasedTask,
  type NewTask, type PilotRow, type PilotRowStore, type PilotStateStore, type PilotStop, type Task, type TaskInputMeta, type TaskIo, type UsageReport,
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
    route: r.route as Account[],
    routeIndex: r.routeIndex,
    limitHits: r.limitHits,
    accountsLimited: r.accountsLimited as Task['accountsLimited'],
    ...(r.leaseId ? { leaseId: r.leaseId } : {}),
    ...(r.leaseHolder ? { leaseHolder: r.leaseHolder } : {}),
    ...(r.leaseExpiresAt ? { leaseExpiresAt: iso(r.leaseExpiresAt)! } : {}),
    ...(r.availableAt ? { availableAt: iso(r.availableAt)! } : {}),
    ...(r.resultRef ? { resultRef: r.resultRef } : {}),
    ...(r.lastError ? { lastError: r.lastError } : {}),
  };
}

export class PgLeaseQueue implements LeaseQueue {
  constructor(private readonly db: Db, private readonly newId: () => string = () => crypto.randomUUID()) {}

  async enqueue(task: NewTask, now: Date) {
    const route = task.route && task.route.length > 0 ? [...task.route] : [...FALLBACK_ROUTE];
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
        route,
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
        or(and(eq(t.status, 'pending'), or(isNull(t.availableAt), lte(t.availableAt, req.now))), and(eq(t.status, 'leased'), lte(t.leaseExpiresAt, req.now))),
        req.kinds && req.kinds.length > 0 ? inArray(t.kind, [...req.kinds]) : undefined,
        // só a via atual da rota recebe a tarefa
        req.account ? sql`(${t.route} ->> ${t.routeIndex}) = ${req.account}` : undefined,
      );
      // 1) esgotadas (tentativas sem contar limite de conta) viram 'dead' e nunca são entregues de novo
      const exausted = await tx.select({ id: t.id }).from(t).where(and(claimable, sql`${t.attempts} - ${t.limitHits} >= ${t.maxAttempts}`)).for('update', { skipLocked: true });
      if (exausted.length > 0) {
        await tx.update(t).set({ status: 'dead', leaseId: null, leaseHolder: null, leaseExpiresAt: null, lastError: sql`coalesce(${t.lastError}, 'tentativas esgotadas')` }).where(inArray(t.id, exausted.map((r) => r.id)));
      }
      // 2) as demais, na ordem de chegada, travadas sem esperar ninguém (SKIP LOCKED)
      const rows = await tx
        .select()
        .from(t)
        .where(and(claimable, sql`${t.attempts} - ${t.limitHits} < ${t.maxAttempts}`))
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
          maxCostMicro: r.maxCostMicro, attempt: r.attempts + 1, leaseId, leaseExpiresAt: expires.toISOString(), account: (r.route as Account[])[r.routeIndex] as Account,
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

  async fail(taskId: string, leaseId: string, error: string, retryable: boolean, now: Date, retryAfterMs?: number, limit?: { account: Account; switchRoute: boolean }) {
    return this.db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      const r = await this.lockHolding(t, taskId, leaseId, now);
      const lastError = error.slice(0, 500);
      const wait = retryAfterMs && retryAfterMs > 0 ? new Date(now.getTime() + retryAfterMs) : null;
      let set: Partial<typeof schema.openbotTasks.$inferInsert>;
      if (limit) {
        // Limite da conta: não é falha da tarefa. Passa à próxima via (se a rota permite e há próxima); na última via, ou sem troca permitida
        // (redação), espera a janela e recomeça pela via preferida.
        const route = r.route as Account[];
        const next = limit.switchRoute && r.routeIndex + 1 < route.length;
        set = {
          lastError, leaseExpiresAt: null, status: 'pending', leaseId: null, leaseHolder: null, limitHits: r.limitHits + 1,
          accountsLimited: [...(r.accountsLimited as Task['accountsLimited']), { account: limit.account, at: now.toISOString() }],
          routeIndex: next ? r.routeIndex + 1 : 0,
          availableAt: next ? null : wait,
        };
      } else if (retryable && r.attempts - r.limitHits < r.maxAttempts) {
        set = { lastError, leaseExpiresAt: null, status: 'pending', leaseId: null, leaseHolder: null, availableAt: wait };
      } else {
        set = { lastError, leaseExpiresAt: null, status: retryable ? 'dead' : 'failed' };
      }
      const [u] = await t.update(schema.openbotTasks).set(set).where(eq(schema.openbotTasks.id, taskId)).returning();
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

type CostRow = typeof schema.openbotCostEntries.$inferSelect;

/** Custos relatados, deduplicados por `executionId`. O teto mensal olha o mês (America/Sao_Paulo) do relógio injetado. */
export class PgCostLedger implements CostLedger {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  private toEntry(r: CostRow): CostEntry {
    return {
      executionId: r.executionId, taskId: r.taskId, leaseId: r.leaseId, model: r.model, lane: r.lane as CostEntry['lane'], costMicro: r.costMicro,
      recordedAt: r.recordedAt.toISOString(), overrun: r.overrun,
      ...(r.account ? { account: r.account as Account } : {}),
      ...(r.generationIds ? { generationIds: r.generationIds as string[] } : {}),
      ...(r.promptTokens !== null ? { promptTokens: r.promptTokens } : {}),
      ...(r.completionTokens !== null ? { completionTokens: r.completionTokens } : {}),
      ...(r.cacheReadTokens !== null ? { cacheReadTokens: r.cacheReadTokens } : {}),
      ...(r.cacheWriteTokens !== null ? { cacheWriteTokens: r.cacheWriteTokens } : {}),
    };
  }

  async record(report: UsageReport, maxCostMicro: number, now: Date) {
    const ins = await this.db
      .insert(schema.openbotCostEntries)
      .values({
        executionId: report.executionId, taskId: report.taskId, leaseId: report.leaseId, lane: report.lane ?? 'api', account: report.account ?? null, model: report.model,
        generationIds: report.generationIds ?? null,
        promptTokens: report.promptTokens ?? null, completionTokens: report.completionTokens ?? null,
        cacheReadTokens: report.cacheReadTokens ?? null, cacheWriteTokens: report.cacheWriteTokens ?? null,
        costMicro: report.costMicro, overrun: report.costMicro > maxCostMicro, monthKey: monthKey(now), recordedAt: now,
      })
      .onConflictDoNothing({ target: schema.openbotCostEntries.executionId })
      .returning();
    if (ins[0]) return { recorded: true, entry: this.toEntry(ins[0]) };
    const [prior] = await this.db.select().from(schema.openbotCostEntries).where(eq(schema.openbotCostEntries.executionId, report.executionId));
    return { recorded: false, entry: this.toEntry(prior!) };
  }

  async entries() {
    return (await this.db.select().from(schema.openbotCostEntries).where(eq(schema.openbotCostEntries.monthKey, monthKey(this.clock()))).orderBy(asc(schema.openbotCostEntries.recordedAt), asc(schema.openbotCostEntries.executionId))).map((r) => this.toEntry(r));
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

/** Trilha do piloto: uma linha por (task_id, attempt). `patch` é leitura-e-gravação sob trava de linha. */
export class PgPilotRowStore implements PilotRowStore {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async upsert(row: PilotRow) {
    const values = { taskId: row.task_id, attempt: row.attempt, stage: row.stage, account: row.account, outcome: row.outcome, startedAt: new Date(row.started_at), row, updatedAt: this.clock() };
    await this.db
      .insert(schema.openbotPilotRows)
      .values(values)
      .onConflictDoUpdate({ target: [schema.openbotPilotRows.taskId, schema.openbotPilotRows.attempt], set: { stage: values.stage, account: values.account, outcome: values.outcome, startedAt: values.startedAt, row: values.row, updatedAt: values.updatedAt } });
  }

  async patch(taskId: string, attempt: number, fields: Partial<PilotRow>) {
    return this.db.transaction(async (tx) => {
      const t = schema.openbotPilotRows;
      const [cur] = await tx.select().from(t).where(and(eq(t.taskId, taskId), eq(t.attempt, attempt))).for('update');
      if (!cur) return false;
      const merged = { ...(cur.row as PilotRow), ...fields, task_id: taskId, attempt } as PilotRow;
      await tx.update(t).set({ row: merged, stage: merged.stage, account: merged.account, outcome: merged.outcome, startedAt: new Date(merged.started_at), updatedAt: this.clock() }).where(and(eq(t.taskId, taskId), eq(t.attempt, attempt)));
      return true;
    });
  }

  async all() {
    const t = schema.openbotPilotRows;
    return (await this.db.select({ row: t.row }).from(t).orderBy(asc(t.startedAt), asc(t.taskId), asc(t.attempt))).map((r) => r.row as PilotRow);
  }
}

/** Estado do piloto: existe a linha `pilot` = PARADA IMEDIATA (motivos acumulados, instante do primeiro); sem linha = liberado. */
export class PgPilotStateStore implements PilotStateStore {
  constructor(private readonly db: Db) {}

  async get(): Promise<PilotStop | null> {
    const [r] = await this.db.select().from(schema.openbotPilotState).where(eq(schema.openbotPilotState.id, 'pilot'));
    return r ? { reasons: r.reasons as string[], at: r.stoppedAt.toISOString() } : null;
  }

  async stop(reason: string, at: string) {
    await this.db.transaction(async (tx) => {
      const t = schema.openbotPilotState;
      const [cur] = await tx.select().from(t).where(eq(t.id, 'pilot')).for('update');
      if (!cur) {
        await tx.insert(t).values({ id: 'pilot', reasons: [reason], stoppedAt: new Date(at) }).onConflictDoNothing();
        // outra transação pode ter inserido no mesmo instante: então soma o motivo
        const [now] = await tx.select().from(t).where(eq(t.id, 'pilot')).for('update');
        if (now && !(now.reasons as string[]).includes(reason)) await tx.update(t).set({ reasons: [...(now.reasons as string[]), reason] }).where(eq(t.id, 'pilot'));
        return;
      }
      const reasons = cur.reasons as string[];
      if (!reasons.includes(reason)) await tx.update(t).set({ reasons: [...reasons, reason] }).where(eq(t.id, 'pilot'));
    });
  }

  async clear() {
    await this.db.delete(schema.openbotPilotState).where(eq(schema.openbotPilotState.id, 'pilot'));
  }
}

export const MAX_INPUT_BYTES = 512 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;
export const MAX_IO_BYTES = MAX_RESULT_BYTES; // (compatibilidade: teto do resultado)
export class IoTooLargeError extends Error {
  constructor(max: number) {
    super(`conteúdo acima de ${max / 1024} KB`);
    this.name = 'IoTooLargeError';
  }
}
/** Já existe resultado desta tentativa com conteúdo DIFERENTE (a primeira gravação vence). */
export class ResultConflict extends Error {
  constructor(resultRef: string) {
    super(`resultado ${resultRef} já gravado com outro conteúdo`);
    this.name = 'ResultConflict';
  }
}
const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
/** Igualdade de conteúdo como o jsonb do PostgreSQL a vê (ordem das chaves não importa). */
const jsonbEquals = async (db: Db, ref: string, v: unknown): Promise<boolean> => {
  const r = (await db.execute(sql`SELECT (content = ${JSON.stringify(v ?? null)}::jsonb) AS same FROM openbot_io WHERE ref = ${ref}`)) as unknown as { rows: { same: boolean }[] };
  return r.rows[0]?.same === true;
};

/**
 * Armazém do conteúdo (TaskIo): a Fábrica grava a ENTRADA por `refId` (`putInput`, idempotente) e lê o RESULTADO por `resultRef` (`getResult`); o agente do OpenBot
 * lê a entrada e grava o resultado só pelas rotas autenticadas e presas ao lease (`getInputFor`, `putResultFor`). Entrada até 512 KB; resultado até 256 KB.
 */
export class PgTaskIo implements TaskIo {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  /** Mesmo `refId` e mesmo conteúdo = nada a fazer; conteúdo DIFERENTE = `InputConflict` (a entrada de uma tarefa em andamento não muda). */
  async putInput(refId: string, input: unknown, meta: TaskInputMeta): Promise<void> {
    if (bytes(input) > MAX_INPUT_BYTES) throw new IoTooLargeError(MAX_INPUT_BYTES);
    const t = schema.openbotIo;
    const ins = await this.db
      .insert(t)
      .values({ ref: refId, direction: 'input', content: input ?? null, taskClass: meta.taskClass, promptVersion: meta.promptVersion, meta: meta.reviewedDraftTaskId || meta.articleId ? { ...(meta.reviewedDraftTaskId ? { reviewedDraftTaskId: meta.reviewedDraftTaskId } : {}), ...(meta.articleId ? { articleId: meta.articleId } : {}) } : null, createdAt: this.clock() })
      .onConflictDoNothing()
      .returning({ ref: t.ref });
    if (ins.length > 0) return;
    const [cur] = await this.db.select({ direction: t.direction }).from(t).where(eq(t.ref, refId));
    if (cur?.direction !== 'input' || !(await jsonbEquals(this.db, refId, input))) throw new InputConflict(refId);
  }

  async getResult(resultRef: string): Promise<unknown | null> {
    const t = schema.openbotIo;
    const [r] = await this.db.select().from(t).where(and(eq(t.ref, resultRef), eq(t.direction, 'result')));
    return r ? r.content : null;
  }

  /** Para a rota do agente: a entrada de `refId` com a classe, a versão do prompt e os metadados. */
  async getInputFor(refId: string): Promise<{ input: unknown; taskClass: string | null; promptVersion: string | null; meta: { reviewedDraftTaskId?: string; articleId?: string } | null } | null> {
    const t = schema.openbotIo;
    const [r] = await this.db.select().from(t).where(and(eq(t.ref, refId), eq(t.direction, 'input')));
    return r ? { input: r.content, taskClass: r.taskClass, promptVersion: r.promptVersion, meta: (r.meta as { reviewedDraftTaskId?: string; articleId?: string } | null) ?? null } : null;
  }

  /** Para a rota do agente: PRIMEIRA gravação vence. Repetir o mesmo conteúdo devolve `false` (nada a fazer); conteúdo diferente = `ResultConflict`. */
  async putResultFor(resultRef: string, taskId: string, result: unknown): Promise<boolean> {
    if (bytes(result) > MAX_RESULT_BYTES) throw new IoTooLargeError(MAX_RESULT_BYTES);
    const t = schema.openbotIo;
    const ins = await this.db.insert(t).values({ ref: resultRef, direction: 'result', content: result ?? null, taskId, createdAt: this.clock() }).onConflictDoNothing().returning({ ref: t.ref });
    if (ins.length > 0) return true;
    const [cur] = await this.db.select({ direction: t.direction }).from(t).where(eq(t.ref, resultRef));
    if (cur?.direction !== 'result' || !(await jsonbEquals(this.db, resultRef, result))) throw new ResultConflict(resultRef);
    return false;
  }
}

/** Resolução de uma violação do piloto por um admin (0028, decisão PM-2026-11-23-D). */
export interface PilotResolution {
  task_id: string;
  attempt: number;
  resolvido_por: string;
  resolvido_em: string;
  motivo: string;
  acao_tomada: string;
}

function toResolution(r: typeof schema.openbotPilotResolutions.$inferSelect): PilotResolution {
  return { task_id: r.taskId, attempt: r.attempt, resolvido_por: r.resolvidoPor, resolvido_em: r.resolvidoEm.toISOString(), motivo: r.motivo, acao_tomada: r.acaoTomada };
}

/**
 * Violações do piloto TRATADAS por um admin: liberam o despacho e a retomada (o portão `canDispatchNext` e `resumePilot` ignoram a linha), mas a linha da planilha NUNCA é
 * apagada nem editada e a violação continua contando no critério de 0 violações da avaliação final. Uma resolução por (tarefa, tentativa); a primeira vence.
 */
export class PgPilotResolutionStore {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  /** 'created' = gravada agora; 'exists' = já estava resolvida (devolve a original); 'no_row' = não há linha do piloto com esse (tarefa, tentativa). */
  async resolve(taskId: string, attempt: number, by: string, motivo: string, acao: string): Promise<{ result: 'created' | 'exists' | 'no_row'; resolution?: PilotResolution }> {
    const rows = schema.openbotPilotRows;
    const [row] = await this.db.select({ taskId: rows.taskId }).from(rows).where(and(eq(rows.taskId, taskId), eq(rows.attempt, attempt)));
    if (!row) return { result: 'no_row' };
    const t = schema.openbotPilotResolutions;
    const ins = await this.db.insert(t).values({ taskId, attempt, resolvidoPor: by, resolvidoEm: this.clock(), motivo: motivo.trim(), acaoTomada: acao.trim() }).onConflictDoNothing().returning();
    const cur = ins[0] ?? (await this.db.select().from(t).where(and(eq(t.taskId, taskId), eq(t.attempt, attempt))))[0]!;
    return { result: ins[0] ? 'created' : 'exists', resolution: toResolution(cur) };
  }

  async all(): Promise<PilotResolution[]> {
    const t = schema.openbotPilotResolutions;
    return (await this.db.select().from(t).orderBy(asc(t.resolvidoEm), asc(t.taskId), asc(t.attempt))).map(toResolution);
  }

  /** Chaves `task_id#attempt` (a forma de `pilotRowKey` de @ln/openbot) para o portão de despacho. */
  async keys(): Promise<ReadonlySet<string>> {
    return new Set((await this.all()).map((r) => `${r.task_id}#${r.attempt}`));
  }
}
