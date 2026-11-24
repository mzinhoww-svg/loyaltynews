// Rotas do adaptador OpenBot (ADR-003): `POST /api/openbot/pull|heartbeat|callback` (cola `createOpenBotRoutes` de @ln/openbot) e, para o AGENTE,
// `POST /api/openbot/io/input|result` (armazém do conteúdo, TaskIo). Quem chama é o OpenBot (só conexão de SAÍDA dele), sem sessão: a autenticação é a
// assinatura HMAC-SHA256 do corpo CRU (`x-ln-signature: v1=<hex>`, `x-ln-timestamp: <ms>`), janela de ±5 min, segredo atual e anterior (rotação) do
// cofre via ambiente (`OPENBOT_HMAC_SECRET`, `OPENBOT_HMAC_SECRET_PREVIOUS`); sem segredo, tudo é 401.
// A lógica é dos handlers PUROS de @ln/openbot (Frente 09); aqui só há a ligação: fila/custos/saúde/dedupe/trilha/estado do piloto/conteúdo no PostgreSQL
// (`@ln/workers/openbot-pg`: `FOR UPDATE SKIP LOCKED`), flag, parada e piloto.
//  - Flag `openbotDispatch` (desligada por padrão): desligada, `pull` não entrega tarefa (423 DISPATCH_OFF); heartbeat, callback e io seguem para fechar o que já estava em curso.
//  - Parada (kill switch): a parada GLOBAL ou da rota `openbot` do ledger canônico (`budget_kill_switch`) bloqueia pull, heartbeat e io (423 KILL_SWITCH).
//    O callback segue aceito durante a parada (handler da Frente 09): fecha a tarefa e REGISTRA o custo já gasto; perder esse registro esconderia gasto.
//  - Piloto (trilha, parada imediata, `canDispatchNext` do AgentOps): só com `APP_ENV=staging` E `LN_OPENBOT_PILOT=1`. O gate vem de `@ln/agents` quando existir;
//    sem ele, FALHA FECHADO (o piloto não despacha) com o motivo explícito.
//  - io/input: só quem tem o lease VIVO daquela tarefa lê a entrada. io/result: só quem tem o lease vivo grava o resultado, sob `res-<taskId>-a<tentativa>`. Teto 256 KB.
//  - Corpo até 64 KB nas rotas de controle. Nunca loga corpo, cabeçalhos, IP nem segredo.
import { apiError } from '@ln/contracts';
import {
  createOpenBotRoutes, ID_RE, LOCKED, openbotFlagsFrom, PILOT_PERMISSIONS, resultRefFor, resumePilot, verifySignature, toSignedRequest,
  type HandlerResult, type OpenBotDeps, type PilotControl, type PilotGate, type PilotVerdictStreak,
} from '@ln/openbot';
import { IoTooLargeError, MAX_RESULT_BYTES, PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotResolutionStore, PgPilotRowStore, PgPilotStateStore, PgTaskIo, ResultConflict } from '@ln/workers/openbot-pg';
import { z } from 'zod';
import { HttpError, json, type RouteCtx, type RouteFn } from './http';
import { killFlags } from './orcamento';

const MAX_BODY = 64 * 1024;
export const OPENBOT_KILL_ROUTE = 'openbot';

export function openbotSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [env.OPENBOT_HMAC_SECRET, env.OPENBOT_HMAC_SECRET_PREVIOUS].filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** O piloto só existe em staging, por decisão registrada (LN_OPENBOT_PILOT=1). Qualquer outra combinação = desligado. */
export const pilotEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.APP_ENV === 'staging' && env.LN_OPENBOT_PILOT === '1';

const closedGate: PilotGate = () => ({ allowed: false, reasons: ['canDispatchNext do AgentOps indisponível neste build (@ln/agents sem o piloto): o piloto não despacha'] });
const closedStreak: PilotVerdictStreak = () => ['verdictStreakReasons do AgentOps indisponível neste build (@ln/agents sem o critério 3 do PM): o piloto não despacha'];

/**
 * `canDispatchNext` e `verdictStreakReasons` de @ln/agents (AgentOps) quando o pacote os exporta; sem eles, o gate recusa tudo (falha fechada). O segundo é o critério 3 de parada
 * do PM (2 falhas seguidas do patch do veredito): sem ele o piloto também não despacha.
 */
async function loadGate(): Promise<{ gate: PilotGate; verdictStreak: PilotVerdictStreak }> {
  try {
    const mod = (await import('@ln/agents')) as unknown as Record<string, unknown>;
    // cada exportação é lida à parte: um módulo (ou mock estrito) sem uma delas não pode derrubar a outra
    const pick = (name: string): unknown => {
      try {
        return mod[name];
      } catch {
        return undefined;
      }
    };
    const gate = pick('canDispatchNext');
    const streak = pick('verdictStreakReasons');
    return {
      gate: typeof gate === 'function' ? (gate as PilotGate) : closedGate,
      verdictStreak: typeof streak === 'function' ? (streak as PilotVerdictStreak) : closedStreak,
    };
  } catch {
    return { gate: closedGate, verdictStreak: closedStreak };
  }
}

/** Dependências dos handlers sobre o PostgreSQL desta requisição. A parada é lida antes (os handlers a recebem pronta). */
export async function openbotDeps(c: RouteCtx, env: Record<string, string | undefined> = process.env): Promise<OpenBotDeps> {
  const k = await killFlags(c.deps.db);
  const kill = k.killGlobal || k.killedRoutes.includes(OPENBOT_KILL_ROUTE);
  const db = c.deps.db;
  const flags = openbotFlagsFrom({ overrides: { openbotDispatch: c.deps.flags.openbotDispatch === true }, kill });
  const kit = pilotEnabled(env) ? await loadGate() : null;
  const pilot: PilotControl | undefined = kit
    ? { enabled: true, rows: new PgPilotRowStore(db, c.deps.now), state: new PgPilotStateStore(db), gate: kit.gate, verdictStreak: kit.verdictStreak, resolved: () => new PgPilotResolutionStore(db, c.deps.now).keys() }
    : undefined;
  return {
    queue: new PgLeaseQueue(db),
    ledger: new PgCostLedger(db, c.deps.now),
    health: new PgHealthStore(db),
    callbacks: new PgCallbackStore(db),
    secrets: () => openbotSecrets(env),
    flags: () => flags,
    now: c.deps.now,
    // o agente não escolhe o resultRef: o callback de `completed` só aceita `res-<taskId>-a<tentativa>` (o mesmo que a rota io/result devolve)
    requireDerivedResultRef: true,
    ...(pilot ? { pilot } : {}),
  };
}

const NO_STORE = { 'cache-control': 'no-store' } as const;
const send = (r: HandlerResult<unknown>) => json(r.body, r.status, NO_STORE);
const err = (status: number, code: string, message: string, details?: unknown) => json(apiError(code, message, details), status, NO_STORE);

async function readRaw(req: Request, max = MAX_BODY): Promise<string> {
  const body = await req.text();
  if (Buffer.byteLength(body, 'utf8') > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Corpo acima de ${Math.round(max / 1024)} KB.`);
  return body;
}

export const openbotRoute =
  (kind: 'pull' | 'heartbeat' | 'callback'): RouteFn =>
  async (req, c) => {
    const body = await readRaw(req);
    const deps = await openbotDeps(c);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      if (k === 'x-ln-signature' || k === 'x-ln-timestamp') headers[k] = v; // só os dois cabeçalhos de assinatura; nenhum outro é lido
    });
    if (kind === 'pull' && !deps.flags().dispatchEnabled && !deps.flags().kill) {
      // sem despacho ligado nada é entregue (nenhuma tarefa, nenhum efeito); a parada tem a própria resposta, abaixo. A ASSINATURA é conferida antes: quem não tem o segredo
      // recebe 401 como nas demais rotas e não descobre o estado da flag; o kill switch já se comporta assim (o handler confere a assinatura primeiro).
      const sig = toSignedRequest({ body, headers });
      const v = verifySignature({ secrets: deps.secrets(), header: sig.signature, timestampMs: sig.timestampMs, body, now: deps.now() });
      if (!v.ok) return err(401, 'UNAUTHORIZED', `assinatura recusada: ${v.reason}`);
      return err(LOCKED, 'DISPATCH_OFF', 'despacho ao OpenBot desligado (flag openbotDispatch)');
    }
    const routes = createOpenBotRoutes(deps);
    return send(await routes[kind]({ body, headers }));
  };

// ---------- conteúdo (TaskIo) para o AGENTE ----------

const LeaseBody = z.object({ taskId: z.string().regex(ID_RE), leaseId: z.string().regex(ID_RE) });
const ResultBody = LeaseBody.extend({ result: z.unknown() });

/** Autentica (HMAC), confere a parada e o piloto e o LEASE vivo da tarefa. Devolve a tarefa ou a resposta de recusa. */
async function guarded(req: Request, c: RouteCtx, schemaOf: z.ZodType<{ taskId: string; leaseId: string }>, maxBody = MAX_BODY) {
  const raw = await readRaw(req, maxBody);
  const deps = await openbotDeps(c);
  const now = deps.now();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (k === 'x-ln-signature' || k === 'x-ln-timestamp') headers[k] = v;
  });
  const sig = toSignedRequest({ body: raw, headers });
  const v = verifySignature({ secrets: deps.secrets(), header: sig.signature, timestampMs: sig.timestampMs, body: raw, now });
  if (!v.ok) return { ok: false as const, res: err(401, 'UNAUTHORIZED', `assinatura recusada: ${v.reason}`) } as const;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false as const, res: err(400, 'VALIDATION_ERROR', 'corpo não é JSON') } as const;
  }
  const p = schemaOf.safeParse(parsed);
  if (!p.success) return { ok: false as const, res: err(400, 'VALIDATION_ERROR', 'corpo inválido', p.error.issues.map((i) => i.path.join('.') || '(raiz)')) } as const;
  if (deps.flags().kill) return { ok: false as const, res: err(LOCKED, 'KILL_SWITCH', 'kill switch ativo') } as const;
  if (deps.pilot?.enabled) {
    const stop = await deps.pilot.state.get();
    if (stop) return { ok: false as const, res: err(LOCKED, 'PILOT_STOPPED', 'piloto em parada imediata', stop.reasons) } as const;
  }
  const task = await deps.queue.get(p.data.taskId);
  if (!task) return { ok: false as const, res: err(404, 'LEASE_ERROR', 'tarefa inexistente', 'tarefa_inexistente') } as const;
  if (task.status !== 'leased' || task.leaseId !== p.data.leaseId) return { ok: false as const, res: err(409, 'LEASE_ERROR', 'lease inválido', 'lease_invalida') } as const;
  if (task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= now.getTime()) return { ok: false as const, res: err(409, 'LEASE_ERROR', 'lease expirado', 'lease_expirada') } as const;
  return { ok: true as const, task, body: p.data, now };
}

/** O agente lê a ENTRADA da tarefa (por `refId`). Só com o lease vivo. */
export const openbotIoInput: RouteFn = async (req, c) => {
  const g = await guarded(req, c, LeaseBody);
  if (!g.ok) return g.res;
  const got = await new PgTaskIo(c.deps.db, c.deps.now).getInputFor(g.task.refId);
  if (!got) return err(404, 'NOT_FOUND', 'entrada da tarefa não encontrada');
  return json({ data: { refId: g.task.refId, input: got.input, taskClass: got.taskClass, promptVersion: got.promptVersion, ...(got.meta ? { meta: got.meta } : {}) } }, 200, NO_STORE);
};

/** O agente grava o RESULTADO da tentativa (idempotente) e recebe o `resultRef` para mandar no callback. Só com o lease vivo. */
export const openbotIoResult: RouteFn = async (req, c) => {
  const g = await guarded(req, c, ResultBody, MAX_RESULT_BYTES + 4096); // o resultado vai até 256 KB, mais o envelope
  if (!g.ok) return g.res;
  const { result } = g.body as unknown as { result: unknown };
  if (result === undefined) return err(400, 'VALIDATION_ERROR', 'falta o resultado', ['result']);
  const resultRef = resultRefFor(g.task.id, g.task.attempts);
  try {
    await new PgTaskIo(c.deps.db, c.deps.now).putResultFor(resultRef, g.task.id, result); // primeira gravação vence; a mesma repetida devolve o mesmo resultRef
  } catch (e) {
    if (e instanceof IoTooLargeError) return err(413, 'PAYLOAD_TOO_LARGE', `resultado acima de ${MAX_RESULT_BYTES / 1024} KB`);
    if (e instanceof ResultConflict) return err(409, 'RESULT_CONFLICT', 'esta tentativa já gravou outro resultado (a primeira gravação vence)');
    throw e;
  }
  return json({ data: { resultRef } }, 200, NO_STORE);
};

// ---------- retomar o piloto (Studio, só admin) ----------

/**
 * `POST /api/studio/openbot/pilot/resume`: retoma o piloto depois de uma parada imediata. A rota exige admin (usuarios:update); o handler de @ln/openbot confere a
 * permissão `openbot:pilot_admin`, que só este caminho concede, e só limpa a parada se o `canDispatchNext` do AgentOps aceita as linhas (409 PILOT_STILL_INVALID
 * com os motivos, senão). Sem piloto ativo (fora do staging ou sem LN_OPENBOT_PILOT=1): 409 PILOT_OFF. Não liga o despacho nem a flag `openbotDispatch`.
 */
export const openbotPilotResume: RouteFn = async (_req, c) => {
  const deps = await openbotDeps(c);
  return send(await resumePilot(deps, { id: c.session!.userId, permissions: [PILOT_PERMISSIONS.admin] }));
};
