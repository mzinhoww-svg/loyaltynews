import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { GatewayRequest, GatewayResponse, ModelGateway } from '@ln/editorial';
import {
  createOpenBotRoutes, handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore, InMemoryLeaseQueue, openbotFlagsFrom,
  OPENBOT_DISPATCH_DEFAULT, OPENBOT_PERMISSIONS, OpenBotModelGateway, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER, toSignedRequest,
  type GatewayRequestLike, type OpenBotDeps, type OpenBotFlags, type PullResult, type SignedRequest, type TaskIo,
} from '../index';

const SECRET = 'segredo-de-teste-gateway';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const signed = (obj: unknown): SignedRequest => {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() };
};

class MemIo implements TaskIo {
  inputs = new Map<string, unknown>();
  metas = new Map<string, unknown>();
  results = new Map<string, unknown>();
  async putInput(refId: string, input: unknown, meta?: unknown) {
    this.inputs.set(refId, input);
    this.metas.set(refId, meta);
  }
  async getResult(ref: string) {
    return this.results.get(ref) ?? null;
  }
}

let flags: OpenBotFlags;
let deps: OpenBotDeps;
let io: MemIo;
let gw: OpenBotModelGateway;
let n = 0;

beforeEach(() => {
  flags = { dispatchEnabled: true, kill: false };
  io = new MemIo();
  deps = {
    queue: new InMemoryLeaseQueue(() => `lease-${++n}`), ledger: new InMemoryCostLedger(), health: new InMemoryHealthStore(), callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET], flags: () => flags, now: () => NOW,
  };
  gw = new OpenBotModelGateway({
    deps, io, caller: { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch] },
    profiles: { triage: 'newsdesk', context: 'newsdesk', draft: 'writer_programas', factcheck: 'checker', review: 'editor_programas', social_pack: 'social', roles: 'entity' },
    timeoutMs: 2000, pollMs: 1,
  });
});

const req = (over: Partial<GatewayRequestLike> = {}): GatewayRequestLike => ({
  taskClass: 'factcheck', route: 'review', workflow: 'WF02', idempotencyKey: 'art-1:factcheck:1', promptVersion: 'editorial-0.2', dataClass: 'public',
  excludeProviders: ['anthropic'], input: { headline: 'Texto da matéria que NÃO pode ir para a fila' }, ...over,
});

/** Simula o agente de uma via: puxa, executa e devolve o callback. `model` é o declarado no custo. */
async function worker(account: 'claude' | 'codex' | 'opencode' | 'antigravity', model: string, outcome: 'completed' | 'failed' = 'completed', result: unknown = { verdict: 'pass' }) {
  for (let i = 0; i < 400; i++) {
    const pulled = (await handlePull(deps, signed({ workerId: `agent-${account}`, account }))).body as PullResult;
    const t = pulled.tasks?.[0];
    if (t) {
      const ref = `res-${t.id}`;
      if (outcome === 'completed') io.results.set(ref, result);
      const lane = account === 'opencode' ? 'opencode' : account === 'antigravity' ? 'antigravity' : 'subscription';
      const r = await handleCallback(deps, signed({
        callbackId: `cb-${t.id}-${n++}`, taskId: t.id, leaseId: t.leaseId, outcome, ...(outcome === 'completed' ? { resultRef: ref } : { error: 'quebrou', retryable: false }),
        usage: { executionId: `ex-${t.id}-${n++}`, taskId: t.id, leaseId: t.leaseId, model, lane, account, costMicro: 0 },
      }));
      return { task: t, status: r.status };
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('nenhuma tarefa chegou ao worker');
}

describe('gateway síncrono sobre o adaptador OpenBot', () => {
  test('despacha, espera o callback e devolve a resposta: provedor e modelo do custo declarado, custo 0 em faixa gratuita', async () => {
    const [res, w] = await Promise.all([gw.invoke(req()), worker('codex', 'gpt-6.2-sol')]);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.deepEqual([res.provider, res.model, res.usage.costMicrosUsd], ['openai', 'gpt-6.2-sol', 0]);
      assert.deepEqual(res.output, { verdict: 'pass' });
    }
    assert.equal(w.task.kind, 'fact_check');
    assert.equal(w.task.profileId, 'checker');
  });

  test('o conteúdo fica no armazém, nunca na fila: a tarefa carrega só o refId derivado da chave', async () => {
    await Promise.all([gw.invoke(req()), worker('codex', 'gpt-6.2-sol')]);
    const [key] = [...io.inputs.keys()];
    assert.match(key!, /^gw-[0-9a-f]{32}$/);
    assert.deepEqual(io.inputs.get(key!), req().input);
    const t = await deps.queue.get('task-000001');
    assert.equal(t?.refId, key);
    assert.equal(JSON.stringify(t).includes('Texto da matéria'), false);
  });

  test('classe context é marcada no despacho: meta leva taskClass e stage context', async () => {
    await Promise.all([gw.invoke(req({ taskClass: 'context', idempotencyKey: 'art-1:context:1' })), worker('opencode', 'deepseek-v4.1-flash')]);
    const [key] = [...io.metas.keys()];
    const m = io.metas.get(key!) as { taskClass: string; stage?: string };
    assert.equal(m.taskClass, 'context');
    assert.equal(m.stage, 'context');
  });

  test('independência: provedor excluído sai da rota; sem via restante, recusa; via de provedor incerto é conferida pelo modelo declarado', async () => {
    const none = await gw.invoke(req({ taskClass: 'draft', excludeProviders: ['anthropic'], idempotencyKey: 'd1' }));
    assert.deepEqual(none, { ok: false, refusal: 'no_independent_provider', detail: 'nenhuma via de editorial_draft fora de anthropic' });

    // checagem com openai excluído: sobra só a Antigravity, e o modelo declarado decide
    const [bad] = await Promise.all([gw.invoke(req({ excludeProviders: ['openai'], idempotencyKey: 'c-bad' })), worker('antigravity', 'gpt-oss-120b-medium')]);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.refusal, 'no_independent_provider');
    const [good] = await Promise.all([gw.invoke(req({ excludeProviders: ['openai'], idempotencyKey: 'c-good' })), worker('antigravity', 'gemini-3.8-flash')]);
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.provider, 'google');
  });

  test('a rota do despacho é a restrita: a via excluída nem recebe a tarefa', async () => {
    const p = gw.invoke(req({ excludeProviders: ['openai'], idempotencyKey: 'r1' }));
    await new Promise((r) => setTimeout(r, 20));
    const codex = (await handlePull(deps, signed({ workerId: 'c', account: 'codex' }))).body as PullResult;
    assert.deepEqual(codex.tasks, []);
    const anti = (await handlePull(deps, signed({ workerId: 'a', account: 'antigravity' }))).body as PullResult;
    assert.equal(anti.tasks.length, 1);
    await handleCallback(deps, signed({ callbackId: 'cb-r1', taskId: anti.tasks[0]!.id, leaseId: anti.tasks[0]!.leaseId, outcome: 'failed', error: 'x', retryable: false }));
    await p;
  });

  test('tempo-limite: a tarefa FICA pendente (sem API, sem cancelar) e repetir a chamada com a mesma chave retoma a MESMA tarefa', async () => {
    const short = new OpenBotModelGateway({ ...(gw as unknown as { c: ConstructorParameters<typeof OpenBotModelGateway>[0] }).c, timeoutMs: 30 });
    const first = await short.invoke(req({ idempotencyKey: 'slow' }));
    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.refusal, 'model_disabled');
      assert.match(first.detail ?? '', /^pending_timeout: tarefa task-000001 segue na fila \(pending, via codex\)/);
    }
    assert.equal((await deps.queue.counts()).pending, 1);
    const [again] = await Promise.all([gw.invoke(req({ idempotencyKey: 'slow' })), worker('codex', 'gpt-6.2-sol')]);
    assert.equal(again.ok, true);
    const c = await deps.queue.counts();
    assert.equal(c.completed + c.pending + c.leased + c.failed + c.dead, 1, 'uma só tarefa em toda a vida da chamada');
  });

  test('recusas do adaptador viram recusas da Fábrica: despacho desligado, kill switch, dado restrito', async () => {
    flags = { dispatchEnabled: false, kill: false };
    const off = await gw.invoke(req({ idempotencyKey: 'off' }));
    assert.deepEqual([off.ok, !off.ok && off.refusal, !off.ok && off.detail], [false, 'model_disabled', 'DISPATCH_OFF']);
    flags = { dispatchEnabled: true, kill: true };
    const kill = await gw.invoke(req({ idempotencyKey: 'kill' }));
    assert.deepEqual([kill.ok, !kill.ok && kill.refusal], [false, 'kill_switch']);
    flags = { dispatchEnabled: true, kill: false };
    const restricted = await gw.invoke({ ...req({ idempotencyKey: 'rd' }), dataClass: 'personal' as never });
    assert.deepEqual([restricted.ok, !restricted.ok && restricted.refusal], [false, 'restricted_data']);
  });

  test('falha da tarefa: recusa com o motivo, sem simular sucesso', async () => {
    const [res] = await Promise.all([gw.invoke(req({ idempotencyKey: 'f' })), worker('codex', 'gpt-6.2-sol', 'failed')]);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.detail ?? '', /^falha: failed/);
  });

  test('conclusão sem resultado gravado não vira sucesso', async () => {
    const [res] = await Promise.all([gw.invoke(req({ idempotencyKey: 'nores' })), worker('codex', 'gpt-6.2-sol', 'completed', null)]);
    assert.equal(res.ok, false);
  });

  test('compatível com o ModelGateway REAL da Editorial (conferido na compilação)', async () => {
    const asEditorial: ModelGateway = gw;
    const r: GatewayRequest = { taskClass: 'factcheck', route: 'review', workflow: 'WF02', idempotencyKey: 'tipo', promptVersion: 'p', dataClass: 'public', excludeProviders: ['anthropic'], input: {} };
    flags = { dispatchEnabled: false, kill: false };
    const out: GatewayResponse = await asEditorial.invoke(r);
    assert.equal(out.ok, false);
  });
});

describe('rotas HTTP e flags do contrato', () => {
  test('cabeçalhos de assinatura: nomes sem diferenciar maiúsculas, valor em lista, timestamp inválido vira indefinido', () => {
    assert.deepEqual(toSignedRequest({ body: '{}', headers: { 'X-LN-Signature': 'v1=ab', 'X-LN-Timestamp': '1763899200000' } }), { body: '{}', signature: 'v1=ab', timestampMs: 1763899200000 });
    assert.equal(toSignedRequest({ body: '{}', headers: { [SIGNATURE_HEADER]: ['v1=a', 'v1=b'] } }).signature, 'v1=a');
    for (const ts of ['abc', '', '12', '1763899200000abc', '-5', '1e12']) {
      assert.equal(toSignedRequest({ body: '{}', headers: { [TIMESTAMP_HEADER]: ts } }).timestampMs, undefined, ts);
    }
    assert.equal(toSignedRequest({ body: '{}', headers: {} }).signature, undefined);
  });

  test('as rotas assinam de ponta a ponta pelos cabeçalhos; sem cabeçalho ou com assinatura errada é 401', async () => {
    const routes = createOpenBotRoutes(deps);
    const body = JSON.stringify({ workerId: 'w' });
    const headers = { [SIGNATURE_HEADER]: signBody(SECRET, NOW.getTime(), body), [TIMESTAMP_HEADER]: String(NOW.getTime()) };
    assert.equal((await routes.pull({ body, headers })).status, 200);
    assert.equal((await routes.pull({ body, headers: {} })).status, 401);
    assert.equal((await routes.pull({ body: JSON.stringify({ workerId: 'x' }), headers })).status, 401, 'corpo diferente do assinado');
    assert.equal((await routes.heartbeat({ body: '{}', headers })).status, 401);
    assert.equal((await routes.callback({ body: '{}', headers })).status, 401);
  });

  test('flag openbotDispatch: desligada por padrão no contrato; ligar é override registrado; o kill switch PREVALECE', () => {
    assert.equal(OPENBOT_DISPATCH_DEFAULT, false);
    assert.deepEqual(openbotFlagsFrom(), { dispatchEnabled: false, kill: false });
    assert.deepEqual(openbotFlagsFrom({ overrides: { openbotDispatch: true } }), { dispatchEnabled: true, kill: false });
    assert.deepEqual(openbotFlagsFrom({ overrides: { openbotDispatch: true }, kill: true }), { dispatchEnabled: false, kill: true });
    assert.deepEqual(openbotFlagsFrom({ kill: true }), { dispatchEnabled: false, kill: true });
  });
});
