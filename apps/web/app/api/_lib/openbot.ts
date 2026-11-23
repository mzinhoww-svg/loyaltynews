// Rotas do adaptador OpenBot (ADR-003): `POST /api/openbot/pull|heartbeat|callback`. Quem chama é o OpenBot (só conexão de SAÍDA dele),
// sem sessão: a autenticação é a assinatura HMAC-SHA256 do corpo CRU (`x-ln-signature: v1=<hex>`, `x-ln-timestamp: <ms>`), janela de ±5 min,
// segredo atual e anterior (rotação) do cofre via ambiente (`OPENBOT_HMAC_SECRET`, `OPENBOT_HMAC_SECRET_PREVIOUS`); sem segredo, tudo é 401.
// A lógica é dos handlers PUROS de @ln/openbot (Frente 09); aqui só há a ligação: fila/custos/saúde/dedupe no PostgreSQL
// (`@ln/workers/openbot-pg`: `FOR UPDATE SKIP LOCKED`), flag e parada.
//  - Flag `openbotDispatch` (desligada por padrão): desligada, `pull` não entrega tarefa (503 DISPATCH_OFF); heartbeat e callback continuam
//    para fechar o que já estava em curso.
//  - Parada (kill switch): a parada GLOBAL ou da rota `openbot` do ledger canônico (`budget_kill_switch`) bloqueia pull e heartbeat (503 KILL_SWITCH).
//    O callback segue aceito durante a parada (handler da Frente 09): fecha a tarefa e REGISTRA o custo já gasto; perder esse registro esconderia gasto.
//  - Corpo até 64 KB. Nunca loga corpo, assinatura nem segredo.
import { handleCallback, handleHeartbeat, handlePull, type HandlerResult, type OpenBotDeps } from '@ln/openbot';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue } from '@ln/workers/openbot-pg';
import { HttpError, json, type RouteCtx, type RouteFn } from './http';
import { killFlags } from './orcamento';

const MAX_BODY = 64 * 1024;
export const OPENBOT_KILL_ROUTE = 'openbot';

export function openbotSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [env.OPENBOT_HMAC_SECRET, env.OPENBOT_HMAC_SECRET_PREVIOUS].filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** Dependências dos handlers sobre o PostgreSQL desta requisição. A parada é lida antes (os handlers a recebem pronta). */
export async function openbotDeps(c: RouteCtx, env: Record<string, string | undefined> = process.env): Promise<OpenBotDeps> {
  const k = await killFlags(c.deps.db);
  const kill = k.killGlobal || k.killedRoutes.includes(OPENBOT_KILL_ROUTE);
  const db = c.deps.db;
  return {
    queue: new PgLeaseQueue(db),
    ledger: new PgCostLedger(db, c.deps.now),
    health: new PgHealthStore(db),
    callbacks: new PgCallbackStore(db),
    secrets: () => openbotSecrets(env),
    flags: () => ({ dispatchEnabled: c.deps.flags.openbotDispatch === true, kill }),
    now: c.deps.now,
  };
}

const send = (r: HandlerResult<unknown>) => json(r.body, r.status, { 'cache-control': 'no-store' });

export const openbotRoute =
  (kind: 'pull' | 'heartbeat' | 'callback'): RouteFn =>
  async (req, c) => {
    const body = await req.text();
    if (body.length > MAX_BODY) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo acima de 64 KB.');
    const raw = req.headers.get('x-ln-timestamp');
    const request = {
      body,
      signature: req.headers.get('x-ln-signature') ?? undefined,
      timestampMs: raw !== null && /^[0-9]{10,16}$/.test(raw) ? Number(raw) : undefined,
    };
    const deps = await openbotDeps(c);
    if (kind === 'pull') {
      // sem despacho ligado nada é entregue (o handler só checa a parada); a recusa vale antes de qualquer efeito
      if (!deps.flags().dispatchEnabled) return json({ error: { code: 'DISPATCH_OFF', message: 'despacho ao OpenBot desligado (flag openbotDispatch)', requestId: c.requestId } }, 503, { 'cache-control': 'no-store' });
      return send(await handlePull(deps, request));
    }
    return send(kind === 'heartbeat' ? await handleHeartbeat(deps, request) : await handleCallback(deps, request));
  };
