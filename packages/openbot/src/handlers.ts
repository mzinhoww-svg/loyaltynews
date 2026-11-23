import { apiError, type ApiError } from '@ln/contracts';
import { z } from 'zod';
import { budgetStatus, isApiLane, MONTHLY_CAP_MICRO, validateUsage, type CostLedger } from './costs';
import { evaluateHealth, type HealthStore, type OpenBotHealth } from './health';
import { LeaseError, type LeaseQueue } from './lease-queue';
import {
  awaitingEditorialGate, DP41_ACCOUNTS, PILOT_ACCOUNTS, PILOT_STAGES, redactText, STOP, type PilotControl, type PilotRow, type PilotStop,
} from './pilot';
import { verifySignature } from './signing';
import {
  ACCOUNTS, ALLOWED_DATA_CLASSES, DEFAULT_ROUTES, resultRefFor, DISPATCHABLE_KINDS, FALLBACK_ROUTE, ID_RE, NEVER_DISPATCH_KINDS, NEVER_SWITCH_KINDS,
  type Account, type LeasedTask, type Task, type UsageReport,
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
  /** Piloto de 10 matérias (trilha, parada imediata, `canDispatchNext` do AgentOps). Ausente ou `enabled:false` = sem efeito. */
  pilot?: PilotControl;
  /** Espera padrão quando todas as vias da rota bateram o limite (ou a rota é de uma só via) e o OpenBot não informa a retomada. Padrão: 30 min. */
  limitHoldMs?: number;
  /** Exige que `resultRef` do callback seja exatamente `resultRefFor(taskId, tentativa)`: o agente não aponta para resultado de outra tarefa. */
  requireDerivedResultRef?: boolean;
  /** Rotas de contas por tipo de tarefa (substitui as padrão, com as mesmas invariantes: sem repetição; redação com uma só via). */
  routes?: Record<string, readonly Account[]>;
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

export const DEFAULT_LIMIT_HOLD_MS = 30 * 60_000;

/** Rota efetiva de um tipo de tarefa: a configurada, a padrão, ou a via única `claude`. */
export function routeFor(deps: Pick<OpenBotDeps, 'routes'>, kind: string): Account[] {
  return [...(deps.routes?.[kind] ?? DEFAULT_ROUTES[kind] ?? FALLBACK_ROUTE)];
}

/** Contas permitidas pelo piloto (DP-41: claude e codex por padrão); `null` quando o piloto não está ativo (sem restrição). */
export function pilotAccounts(deps: Pick<OpenBotDeps, 'pilot'>): readonly Account[] | null {
  return deps.pilot?.enabled ? deps.pilot.allowedAccounts ?? DP41_ACCOUNTS : null;
}

/** Rota efetiva: a rota do tipo, já sem as contas que o piloto não permite. Vazia = nenhuma via permitida (nada é despachado). */
export function effectiveRoute(deps: Pick<OpenBotDeps, 'routes' | 'pilot'>, kind: string): Account[] {
  const allowed = pilotAccounts(deps);
  const r = routeFor(deps, kind);
  return allowed ? r.filter((a) => allowed.includes(a)) : r;
}

/** Problemas de uma rota (vazia = válida): não vazia, só contas conhecidas, sem repetição e, na redação, uma só via. */
export function routeProblems(kind: string, route: readonly string[]): string[] {
  const p: string[] = [];
  if (route.length === 0) p.push('rota vazia');
  if (route.some((a) => !(ACCOUNTS as readonly string[]).includes(a))) p.push('conta desconhecida na rota');
  if (new Set(route).size !== route.length) p.push('conta repetida na rota');
  if ((NEVER_SWITCH_KINDS as readonly string[]).includes(kind) && route.length !== 1) p.push(`${kind} nunca troca de via (rota de uma só conta)`);
  return p;
}

/**
 * Piloto: se está em parada imediata, ou se o `canDispatchNext` do AgentOps recusa as linhas gravadas, nada é entregue nem
 * despachado (503). A recusa do gate também PARA o piloto (fica parado até `resumePilot`). Sem piloto ativo, não faz nada.
 */
async function pilotBlock(deps: OpenBotDeps): Promise<HandlerResult<never> | null> {
  const p = deps.pilot;
  if (!p?.enabled) return null;
  const st = await p.state.get();
  if (st) return fail(503, 'PILOT_STOPPED', 'piloto em parada imediata', st.reasons);
  const gate = p.gate((await p.rows.all()).filter((r) => !awaitingEditorialGate(r)));
  if (!gate.allowed) {
    for (const r of gate.reasons) await p.state.stop(`${STOP.gate}: ${r}`, deps.now().toISOString());
    return fail(503, 'PILOT_STOPPED', 'o canDispatchNext recusou: piloto parado', gate.reasons);
  }
  return null;
}

/** Registra uma tentativa de violação (ex.: despachar publicação) como linha da planilha e para o piloto. */
async function pilotViolation(deps: OpenBotDeps, reason: string, info: { kind: string; refId: string }): Promise<void> {
  const p = deps.pilot;
  if (!p?.enabled) return;
  const at = deps.now().toISOString();
  const n = (await p.rows.all()).filter((r) => r.task_id.startsWith('violation-')).length + 1;
  const row: PilotRow = {
    task_id: `violation-${n}`, kind: info.kind, article_id: info.refId, source_id: 'nao_informada', stage: 'rights_seo_qa', account: 'deterministic',
    declared_model: null, prompt_version: null, started_at: at, ended_at: at, attempt: 1, outcome: 'failed', packet_chars: null,
    tokens_measured: false, published_attempt: reason === STOP.publish, tarifada_api_call: reason === STOP.api, secret_in_log: reason === STOP.secret,
    tool_outside_contract: reason === STOP.tool, notes: reason,
  };
  await p.rows.upsert(row);
  await p.state.stop(reason, at);
}

// ---------- pull ----------

const PullSchema = z.object({
  workerId: z.string().regex(ID_RE),
  limit: z.number().int().min(1).max(10).optional(),
  kinds: z.array(z.enum(DISPATCHABLE_KINDS)).max(DISPATCHABLE_KINDS.length).optional(),
  /** A via (conta) do agente que puxa. Obrigatória no piloto: cada via só recebe as tarefas cuja via atual é a dela. */
  account: z.enum(ACCOUNTS).optional(),
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
  if (deps.pilot?.enabled && !p.data.account) return fail(400, 'VALIDATION_ERROR', 'no piloto o pull informa a via (account)', ['account']);
  const allowedPull = pilotAccounts(deps);
  if (allowedPull && p.data.account && !(allowedPull as readonly string[]).includes(p.data.account)) {
    // um agente configurado fora da DP-41 é violação de configuração: grava a linha e PARA o piloto (fica parado até `resumePilot`)
    await pilotViolation(deps, STOP.route, { kind: 'pull', refId: `conta-${p.data.account}` });
    return fail(422, 'ACCOUNT_OUT_OF_ROUTE', `via fora do piloto (DP-41): só ${allowedPull.join(' e ')}; o piloto foi parado`, p.data.account);
  }
  const blocked = await pilotBlock(deps);
  if (blocked) return blocked;
  await deps.health.markPull(p.data.workerId, now);
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const tasks = await deps.queue.claim({ workerId: p.data.workerId, now, leaseMs, limit: p.data.limit ?? 1, kinds: p.data.kinds, account: p.data.account });
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
  const blocked = await pilotBlock(deps);
  if (blocked) return blocked;
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
  /** Espera antes de a tarefa voltar a ser puxável (falha retentável). */
  retryAfterSeconds: z.number().int().min(0).max(86_400).optional(),
  usage: z.unknown().optional(),
  trace: z.object({
    stage: z.enum(PILOT_STAGES),
    account: z.enum(PILOT_ACCOUNTS),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    /** Tamanho do pacote em caracteres: substituto de tokens (o OpenBot não os expõe). */
    packetChars: z.number().int().min(0).optional(),
    /** A conta bateu o limite: a tarefa espera a janela voltar (sem fallback para API nem outra conta). */
    limit: z.object({
      message: z.string().max(300),
      at: z.iso.datetime({ offset: true }),
      /** Retomada INFORMADA pelo OpenBot, se houver. */
      resumeAt: z.iso.datetime({ offset: true }).optional(),
    }).strict().optional(),
    reviewedDraftTaskId: z.string().regex(ID_RE).optional(),
    promptVersion: z.string().max(64).optional(),
    sourceId: z.string().regex(ID_RE).optional(),
    outputValid: z.boolean().optional(),
    toolOutsideContract: z.boolean().optional(),
    notes: z.string().max(300).optional(),
  }).strict().optional(),
});

export interface CallbackResult {
  duplicate: boolean;
  task?: Pick<Task, 'id' | 'status' | 'attempts'>;
  costRecorded: boolean;
  overrun: boolean;
  budget: { status: 'ok' | 'alerta' | 'estourado'; remainingMicro: number };
  /** `true` quando o orçamento estourou: o gateway bloqueia novas chamadas de modelo. */
  pauseModelCalls: boolean;
  /** Motivos de parada imediata do piloto, se o piloto está parado. */
  pilotStopped?: string[];
  /** Após um limite: a próxima via que vai puxar a tarefa (`null` = espera a janela; a rota recomeça pela via preferida). */
  nextAccount?: Account | null;
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
  const pilotOn = deps.pilot?.enabled === true;
  // No piloto toda execução precisa da trilha (é ela que vira a linha da planilha).
  if (pilotOn && !cb.trace) return fail(422, 'TRACE_REQUIRED', 'no piloto toda execução informa a trilha (stage, account, horários)');
  if (cb.trace && usage?.account && usage.account !== cb.trace.account) {
    return fail(422, 'TRACE_MISMATCH', 'a conta da trilha difere da conta do custo');
  }

  const before = await deps.queue.get(cb.taskId);
  if (!before) return fail(404, 'LEASE_ERROR', 'tarefa inexistente', 'tarefa_inexistente');

  // A via que executou tem de ser a atribuída na entrega. Executar por outra conta (ex.: redação em outra via) fura a rota.
  const assigned = before.route[before.routeIndex];
  if (cb.trace && cb.trace.account !== assigned) {
    if (pilotOn) await pilotViolation(deps, STOP.route, { kind: before.kind, refId: before.refId });
    return fail(422, 'ACCOUNT_OUT_OF_ROUTE', 'a execução usou uma via diferente da atribuída pela rota', { assigned });
  }

  // O resultado apontado tem de ser o desta tarefa e desta tentativa (quando exigido). Callback recusado não consome o callbackId.
  if (deps.requireDerivedResultRef && cb.outcome === 'completed' && cb.resultRef !== resultRefFor(before.id, before.attempts)) {
    return fail(422, 'RESULT_REF_MISMATCH', 'resultRef deve ser o derivado da tarefa e da tentativa', { expected: resultRefFor(before.id, before.attempts) });
  }

  // Replay: mesma resposta, nenhum efeito. Só chega aqui um callback válido, assinado e com tarefa existente; callback
  // recusado por validação não consome o `callbackId` e pode ser reenviado corrigido.
  if (!(await deps.callbacks.firstSeen(cb.callbackId, now))) {
    const b = budgetStatus(await deps.ledger.totalMicro(), cap);
    return ok({ duplicate: true, costRecorded: false, overrun: false, budget: b, pauseModelCalls: b.status === 'estourado' });
  }

  // Texto livre vindo do OpenBot: e-mail e segredo são mascarados; segredo no piloto = parada imediata.
  const errText = redactText(cb.error ?? 'falha sem mensagem');
  const limitText = cb.trace?.limit ? redactText(cb.trace.limit.message) : null;
  const notesText = cb.trace?.notes ? redactText(cb.trace.notes) : null;
  const secretFound = errText.secretFound || limitText?.secretFound === true || notesText?.secretFound === true;

  // Limite da conta: espera a janela voltar (a retomada informada ou a espera padrão) e NUNCA troca de conta nem cai em API.
  const limited = cb.outcome === 'failed' && cb.trace?.limit !== undefined;
  let retryAfterMs: number | undefined;
  if (limited && cb.trace?.limit) {
    const resume = cb.trace.limit.resumeAt ? Date.parse(cb.trace.limit.resumeAt) - now.getTime() : Number.NaN;
    retryAfterMs = Number.isFinite(resume) && resume > 0 ? resume : (deps.limitHoldMs ?? DEFAULT_LIMIT_HOLD_MS);
  } else if (cb.retryAfterSeconds) {
    retryAfterMs = cb.retryAfterSeconds * 1000;
  }
  const retryable = limited ? true : (cb.retryable ?? true);

  let task: Task;
  try {
    if (cb.outcome === 'completed') {
      task = (await deps.queue.complete(cb.taskId, cb.leaseId, cb.resultRef, now)).task;
    } else {
      const limitInfo = limited && assigned ? { account: assigned, switchRoute: !(NEVER_SWITCH_KINDS as readonly string[]).includes(before.kind) } : undefined;
      task = (await deps.queue.fail(cb.taskId, cb.leaseId, errText.text, retryable, now, retryAfterMs, limitInfo)).task;
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
  if (pilotOn && deps.pilot && cb.trace) {
    const pilot = deps.pilot;
    const stopAt = now.toISOString();
    const tarifada = usage !== undefined && (isApiLane(usage) || usage.costMicro > 0);
    const outcome: PilotRow['outcome'] = cb.outcome === 'completed' ? 'completed' : limited ? 'pending_limit' : retryable ? 'retryable' : 'failed';
    const row: PilotRow = {
      task_id: task.id, kind: task.kind, article_id: task.refId, source_id: cb.trace.sourceId ?? 'nao_informada', stage: cb.trace.stage,
      account: cb.trace.account, declared_model: usage?.model ?? null, prompt_version: cb.trace.promptVersion ?? null,
      started_at: cb.trace.startedAt, ended_at: cb.trace.endedAt, attempt: task.attempts,
      ...(cb.trace.reviewedDraftTaskId ? { reviewed_draft_task_id: cb.trace.reviewedDraftTaskId } : {}),
      outcome,
      ...(cb.trace.limit ? { limit_message: limitText?.text ?? '', limit_at: cb.trace.limit.at } : {}),
      packet_chars: cb.trace.packetChars ?? null,
      ...(cb.trace.outputValid !== undefined ? { output_valid: cb.trace.outputValid } : {}),
      tokens_measured: false,
      published_attempt: false,
      tarifada_api_call: tarifada,
      secret_in_log: secretFound,
      tool_outside_contract: cb.trace.toolOutsideContract === true,
      ...(notesText ? { notes: notesText.text } : {}),
    };
    await pilot.rows.upsert(row);
    // A conta voltou a aceitar: a primeira execução concluída depois de um limite marca a retomada observada.
    if (cb.outcome === 'completed') {
      for (const r of await pilot.rows.all()) {
        if (r.account === cb.trace.account && r.outcome === 'pending_limit' && r.limit_at && !r.account_resumed_at && Date.parse(r.ended_at) <= Date.parse(cb.trace.startedAt)) {
          await pilot.rows.patch(r.task_id, r.attempt, { account_resumed_at: cb.trace.startedAt });
        }
      }
    }
    if (tarifada) await pilot.state.stop(STOP.api, stopAt);
    if (secretFound) await pilot.state.stop(STOP.secret, stopAt);
    if (cb.trace.toolOutsideContract === true) await pilot.state.stop(STOP.tool, stopAt);
  }
  const b = budgetStatus(await deps.ledger.totalMicro(), cap);
  const stopped = pilotOn && deps.pilot ? await deps.pilot.state.get() : null;
  return ok({
    duplicate: false,
    task: { id: task.id, status: task.status, attempts: task.attempts },
    costRecorded,
    overrun,
    budget: b,
    pauseModelCalls: b.status === 'estourado',
    ...(stopped ? { pilotStopped: stopped.reasons } : {}),
    ...(limited ? { nextAccount: task.routeIndex === 0 && task.route.length > 0 && task.availableAt ? null : (task.route[task.routeIndex] ?? null) } : {}),
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
  /** Só RESTRINGE a rota padrão do tipo (subconjunto, na mesma ordem); nunca a amplia. Ex.: tirar uma via por independência. */
  route: z.array(z.enum(ACCOUNTS)).min(1).optional(),
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
    await pilotViolation(deps, STOP.publish, { kind: d.kind, refId: d.refId }); // tentativa de publicar = parada imediata do piloto
    return fail(422, 'KIND_FORBIDDEN', 'esta tarefa nunca vai ao OpenBot (publicação é só do publisher_social)', d.kind);
  }
  if (!(DISPATCHABLE_KINDS as readonly string[]).includes(d.kind)) return fail(422, 'KIND_UNKNOWN', 'tipo de tarefa desconhecido', d.kind);
  const blocked = await pilotBlock(deps);
  if (blocked) return blocked;
  if (!(ALLOWED_DATA_CLASSES as readonly string[]).includes(d.dataClass)) {
    return fail(422, 'DATA_CLASS_BLOCKED', 'classe de dado não liberada para o OpenBot', d.dataClass);
  }
  const full = routeFor(deps, d.kind);
  const allowedAcc = pilotAccounts(deps);
  const route = d.route ?? effectiveRoute(deps, d.kind);
  const rp = routeProblems(d.kind, route);
  if (allowedAcc) {
    if (route.some((a) => !(allowedAcc as readonly string[]).includes(a))) rp.push(`via fora do piloto (DP-41): só ${allowedAcc.join(' e ')}`);
    if (!d.route && route.length === 0) rp.push('nenhuma via permitida no piloto para este tipo de tarefa');
  }
  if (d.route) {
    let i = 0;
    for (const a of full) if (i < d.route.length && d.route[i] === a) i += 1;
    if (i !== d.route.length) rp.push('a rota só pode restringir a rota padrão (subconjunto, na mesma ordem)');
  }
  if (rp.length) return fail(422, 'ROUTE_INVALID', 'rota de contas inválida para o tipo de tarefa', rp);
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
      route,
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
  /** Estado do piloto (só quando configurado). */
  pilot?: { enabled: boolean; stopped: PilotStop | null; rows: number };
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
    ...(deps.pilot ? { pilot: { enabled: deps.pilot.enabled, stopped: await deps.pilot.state.get(), rows: (await deps.pilot.rows.all()).length } } : {}),
  });
}

export const PILOT_PERMISSIONS = { admin: 'openbot:pilot_admin' } as const;

/**
 * Retoma o piloto depois de uma parada imediata. Só com permissão de administrador do piloto e se o `canDispatchNext` do
 * AgentOps voltou a aceitar as linhas (a linha que causou a parada precisa ter sido corrigida/justificada no registro).
 */
export async function resumePilot(deps: OpenBotDeps, caller: Caller): Promise<HandlerResult<{ resumed: boolean }>> {
  if (!caller.permissions.includes(PILOT_PERMISSIONS.admin)) return fail(403, 'FORBIDDEN', 'sem permissão openbot:pilot_admin');
  const p = deps.pilot;
  if (!p?.enabled) return fail(409, 'PILOT_OFF', 'piloto não está ativo');
  const gate = p.gate(await p.rows.all());
  if (!gate.allowed) return fail(409, 'PILOT_STILL_INVALID', 'o canDispatchNext ainda recusa as linhas', gate.reasons);
  await p.state.clear();
  return ok({ resumed: true });
}
