import { apiError, type ApiError } from '@ln/contracts';
import { z } from 'zod';
import { budgetStatus, MONTHLY_CAP_MICRO, validateUsage, type CostLedger } from './costs';
import { evaluateHealth, type HealthStore, type OpenBotHealth } from './health';
import { LeaseError, type LeaseQueue } from './lease-queue';
import { verifySignature } from './signing';
import {
  ALLOWED_DATA_CLASSES, DISPATCHABLE_KINDS, ID_RE, NEVER_DISPATCH_KINDS, type LeasedTask, type Task, type UsageReport,
} from './types';

// Handlers PUROS do adaptador OpenBot (ADR-003): recebem dependências e a requisição crua (corpo + cabeçalhos) e devolvem
// {status, body}. O OpenBot é quem chama (pull, heartbeat, callback), sempre assinado; o LN nunca abre conexão para o OpenBot.
// Nenhum segredo é lido aqui: `deps.secrets()` entrega os segredos (atual e anterior) vindos do cofre.

export interface CallbackStore {
  /** `true` na primeira vez que vê o `callbackId`; `false` em repetição (replay). */
  firstSeen(callbackId: string, now: Date): Promise<boolean>;
}

export class InMemoryCallbackStore implements CallbackStore {
  private readonly seen = new Set<string>();
  async firstSeen(callbackId: string): Promise<boolean> {
    if (this.seen.has(callbackId)) return false;
    this.seen.add(callbackId);
    return true;
  }
}

export interface OpenBotFlags {
  /** Despacho de tarefas ao OpenBot. Desligado por padrão. (Proposta: `openbotDispatch` em @ln/contracts/flags.) */
  dispatchEnabled: boolean;
  /** Kill switch global: nada é entregue nem despachado. */
  kill: boolean;
}

export const DEFAULT_OPENBOT_FLAGS: Readonly<OpenBotFlags> = Object.freeze({ dispatchEnabled: false, kill: false });

export interface OpenBotDeps {
  queue: LeaseQueue;
  ledger: CostLedger;
  health: HealthStore;
  callbacks: CallbackStore;
  /** Segredos aceitos (atual primeiro; anteriores para rotação). Lidos do cofre pelo chamador; nunca gravados. */
  secrets: () => readonly string[];
  flags: () => OpenBotFlags;
  now: () => Date;
  leaseMs?: number;
  /** Teto mensal em micro-USD. Padrão: US$ 50. */
  capMicro?: number;
}

export interface SignedRequest {
  /** Corpo CRU, exatamente como foi assinado. */
  body: string;
  signature: string | undefined;
  timestampMs: number | undefined;
}

export interface HandlerResult<T> {
  status: number;
  body: T | ApiError;
}

const ok = <T>(body: T, status = 200): HandlerResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string, details?: unknown): HandlerResult<never> => ({
  status,
  body: apiError(code, message, details),
});

export const DEFAULT_LEASE_MS = 120_000;

/** Autentica a chamada do OpenBot e devolve o JSON do corpo. Qualquer falha é 401/400 sem efeito. */
function authenticate(deps: OpenBotDeps, req: SignedRequest): { ok: true; json: unknown } | { ok: false; res: HandlerResult<never> } {
  const v = verifySignature({
    secrets: deps.secrets(),
    header: req.signature,
    timestampMs: req.timestampMs,
    body: req.body,
    now: deps.now(),
  });
  if (!v.ok) return { ok: false, res: fail(401, 'UNAUTHORIZED', `assinatura recusada: ${v.reason}`) };
  try {
    return { ok: true, json: JSON.parse(req.body) };
  } catch {
    return { ok: false, res: fail(400, 'VALIDATION_ERROR', 'corpo não é JSON') };
  }
}

const killed = (deps: OpenBotDeps): boolean => deps.flags().kill === true;
const issues = (e: z.ZodError): string[] => e.issues.map((i) => i.path.join('.') || '(raiz)');

// ---------- pull ----------

const PullSchema = z.object({
  workerId: z.string().regex(ID_RE),
  limit: z.number().int().min(1).max(10).optional(),
  kinds: z.array(z.enum(DISPATCHABLE_KINDS)).max(DISPATCHABLE_KINDS.length).optional(),
});

export interface PullResult {
  tasks: LeasedTask[];
  leaseMs: number;
  serverTime: string;
}

/** O OpenBot puxa tarefas com lease. Só IDs e limites: nunca conteúdo editorial. */
export async function handlePull(deps: OpenBotDeps, req: SignedRequest): Promise<HandlerResult<PullResult>> {
  const auth = authenticate(deps, req);
  if (!auth.ok) return auth.res;
  const p = PullSchema.safeParse(auth.json);
  if (!p.success) return fail(400, 'VALIDATION_ERROR', 'pull inválido', issues(p.error));
  const now = deps.now();
  if (killed(deps)) return fail(503, 'KILL_SWITCH', 'kill switch ativo: nenhuma tarefa é entregue');
  await deps.health.markPull(p.data.workerId, now);
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const tasks = await deps.queue.claim({ workerId: p.data.workerId, now, leaseMs, limit: p.data.limit ?? 1, kinds: p.data.kinds });
  return ok({ tasks, leaseMs, serverTime: now.toISOString() });
}

// ---------- heartbeat ----------

const HeartbeatSchema = z.object({ taskId: z.string().regex(ID_RE), leaseId: z.string().regex(ID_RE) });

function leaseFailure(e: unknown): HandlerResult<never> | null {
  if (e instanceof LeaseError) return fail(e.reason === 'tarefa_inexistente' ? 404 : 409, 'LEASE_ERROR', e.message, e.reason);
  return null;
}

export async function handleHeartbeat(deps: OpenBotDeps, req: SignedRequest): Promise<HandlerResult<{ leaseExpiresAt: string }>> {
  const auth = authenticate(deps, req);
  if (!auth.ok) return auth.res;
  const p = HeartbeatSchema.safeParse(auth.json);
  if (!p.success) return fail(400, 'VALIDATION_ERROR', 'heartbeat inválido', issues(p.error));
  if (killed(deps)) return fail(503, 'KILL_SWITCH', 'kill switch ativo');
  try {
    return ok(await deps.queue.heartbeat(p.data.taskId, p.data.leaseId, deps.now(), deps.leaseMs ?? DEFAULT_LEASE_MS));
  } catch (e) {
    const f = leaseFailure(e);
    if (f) return f;
    throw e;
  }
}

// ---------- callback assinado e idempotente ----------

const CallbackSchema = z.object({
  callbackId: z.string().regex(ID_RE),
  taskId: z.string().regex(ID_RE),
  leaseId: z.string().regex(ID_RE),
  outcome: z.enum(['completed', 'failed']),
  /** Referência (id) do resultado gravado pela API do LN. Nunca o conteúdo. */
  resultRef: z.string().regex(ID_RE).optional(),
  error: z.string().max(500).optional(),
  retryable: z.boolean().optional(),
  usage: z.unknown().optional(),
});

export interface CallbackResult {
  duplicate: boolean;
  task?: Pick<Task, 'id' | 'status' | 'attempts'>;
  costRecorded: boolean;
  overrun: boolean;
  budget: { status: 'ok' | 'alerta' | 'estourado'; remainingMicro: number };
  /** `true` quando o orçamento estourou: o gateway bloqueia novas chamadas de modelo. */
  pauseModelCalls: boolean;
}

export async function handleCallback(deps: OpenBotDeps, req: SignedRequest): Promise<HandlerResult<CallbackResult>> {
  const auth = authenticate(deps, req);
  if (!auth.ok) return auth.res;
  const p = CallbackSchema.safeParse(auth.json);
  if (!p.success) return fail(400, 'VALIDATION_ERROR', 'callback inválido', issues(p.error));
  const cb = p.data;
  const now = deps.now();
  const cap = deps.capMicro ?? MONTHLY_CAP_MICRO;

  // Valida o custo ANTES de qualquer efeito: custo desconhecido ou fora do formato recusa o callback inteiro.
  let usage: UsageReport | undefined;
  if (cb.usage !== undefined) {
    const v = validateUsage(cb.usage);
    if (!v.ok) return fail(422, 'USAGE_INVALID', 'relato de custo recusado', v.problems);
    usage = cb.usage as UsageReport;
    if (usage.taskId !== cb.taskId || usage.leaseId !== cb.leaseId) {
      return fail(422, 'USAGE_MISMATCH', 'o custo é de outra tarefa ou de outro lease');
    }
  }

  const before = await deps.queue.get(cb.taskId);
  if (!before) return fail(404, 'LEASE_ERROR', 'tarefa inexistente', 'tarefa_inexistente');

  // Replay: mesma resposta, nenhum efeito. Só chega aqui um callback válido, assinado e com tarefa existente; callback
  // recusado por validação não consome o `callbackId` e pode ser reenviado corrigido.
  if (!(await deps.callbacks.firstSeen(cb.callbackId, now))) {
    const b = budgetStatus(await deps.ledger.totalMicro(), cap);
    return ok({ duplicate: true, costRecorded: false, overrun: false, budget: b, pauseModelCalls: b.status === 'estourado' });
  }

  let task: Task;
  try {
    if (cb.outcome === 'completed') {
      task = (await deps.queue.complete(cb.taskId, cb.leaseId, cb.resultRef, now)).task;
    } else {
      task = (await deps.queue.fail(cb.taskId, cb.leaseId, cb.error ?? 'falha sem mensagem', cb.retryable ?? true, now)).task;
    }
  } catch (e) {
    const f = leaseFailure(e);
    if (f) return f;
    throw e;
  }

  let costRecorded = false;
  let overrun = false;
  if (usage) {
    const r = await deps.ledger.record(usage, before.maxCostMicro, now);
    costRecorded = r.recorded;
    overrun = r.entry.overrun;
  }
  const b = budgetStatus(await deps.ledger.totalMicro(), cap);
  return ok({
    duplicate: false,
    task: { id: task.id, status: task.status, attempts: task.attempts },
    costRecorded,
    overrun,
    budget: b,
    pauseModelCalls: b.status === 'estourado',
  });
}

// ---------- disparo (lado LN) ----------

export interface Caller {
  id: string;
  permissions: readonly string[];
}

export const OPENBOT_PERMISSIONS = { dispatch: 'openbot:dispatch', read: 'openbot:read' } as const;

const DispatchSchema = z.object({
  kind: z.string(),
  profileId: z.string().regex(ID_RE),
  refId: z.string().regex(ID_RE),
  idempotencyKey: z.string().regex(ID_RE),
  dataClass: z.string(),
  maxCostMicro: z.number().int().min(1),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});

/** Enfileira uma tarefa para o OpenBot puxar. Publicação nunca vai ao OpenBot; classe de dado restrita é recusada. */
export async function dispatchTask(deps: OpenBotDeps, caller: Caller, raw: unknown): Promise<HandlerResult<{ created: boolean; task: Task }>> {
  if (!caller.permissions.includes(OPENBOT_PERMISSIONS.dispatch)) return fail(403, 'FORBIDDEN', 'sem permissão openbot:dispatch');
  const p = DispatchSchema.safeParse(raw);
  if (!p.success) return fail(400, 'VALIDATION_ERROR', 'despacho inválido', issues(p.error));
  const d = p.data;
  const flags = deps.flags();
  if (flags.kill) return fail(503, 'KILL_SWITCH', 'kill switch ativo');
  if (!flags.dispatchEnabled) return fail(409, 'DISPATCH_OFF', 'despacho ao OpenBot está desligado (flag)');
  if ((NEVER_DISPATCH_KINDS as readonly string[]).includes(d.kind)) {
    return fail(422, 'KIND_FORBIDDEN', 'esta tarefa nunca vai ao OpenBot (publicação é só do publisher_social)', d.kind);
  }
  if (!(DISPATCHABLE_KINDS as readonly string[]).includes(d.kind)) return fail(422, 'KIND_UNKNOWN', 'tipo de tarefa desconhecido', d.kind);
  if (!(ALLOWED_DATA_CLASSES as readonly string[]).includes(d.dataClass)) {
    return fail(422, 'DATA_CLASS_BLOCKED', 'classe de dado não liberada para o OpenBot', d.dataClass);
  }
  const cap = deps.capMicro ?? MONTHLY_CAP_MICRO;
  if (d.maxCostMicro > cap) return fail(422, 'COST_CAP_EXCEEDS_BUDGET', 'teto da tarefa maior que o teto mensal');
  const b = budgetStatus(await deps.ledger.totalMicro(), cap);
  if (b.status === 'estourado' || b.remainingMicro < d.maxCostMicro) {
    return fail(409, 'BUDGET_EXHAUSTED', 'sem saldo para esta tarefa', { remainingMicro: b.remainingMicro });
  }
  const r = await deps.queue.enqueue(
    {
      kind: d.kind as (typeof DISPATCHABLE_KINDS)[number],
      profileId: d.profileId,
      refId: d.refId,
      idempotencyKey: d.idempotencyKey,
      dataClass: d.dataClass as (typeof ALLOWED_DATA_CLASSES)[number],
      maxCostMicro: d.maxCostMicro,
      maxAttempts: d.maxAttempts,
    },
    deps.now(),
  );
  return ok(r, r.created ? 201 : 200);
}

// ---------- estado ----------

export interface OpenBotStatus {
  health: OpenBotHealth;
  queue: Record<Task['status'], number>;
  cost: { totalMicro: number; capMicro: number; status: 'ok' | 'alerta' | 'estourado'; remainingMicro: number; executions: number };
  flags: OpenBotFlags;
}

export async function getOpenBotStatus(deps: OpenBotDeps, caller: Caller): Promise<HandlerResult<OpenBotStatus>> {
  if (!caller.permissions.includes(OPENBOT_PERMISSIONS.read)) return fail(403, 'FORBIDDEN', 'sem permissão openbot:read');
  const cap = deps.capMicro ?? MONTHLY_CAP_MICRO;
  const total = await deps.ledger.totalMicro();
  const b = budgetStatus(total, cap);
  return ok({
    health: await evaluateHealth(deps.health, deps.now()),
    queue: await deps.queue.counts(),
    cost: { totalMicro: total, capMicro: cap, status: b.status, remainingMicro: b.remainingMicro, executions: (await deps.ledger.entries()).length },
    flags: deps.flags(),
  });
}
