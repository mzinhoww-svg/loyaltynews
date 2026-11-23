import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ApiError } from '@ln/contracts';
import {
  dispatchTask, getOpenBotStatus, handleCallback, handleHeartbeat, handlePull, InMemoryCallbackStore, InMemoryCostLedger,
  InMemoryHealthStore, InMemoryLeaseQueue, OPENBOT_PERMISSIONS, signBody, DEFAULT_OPENBOT_FLAGS,
  type Caller, type CallbackResult, type OpenBotDeps, type OpenBotFlags, type PullResult, type SignedRequest, type UsageReport,
} from '../index';

const SECRET = 'segredo-de-teste-1';
const OLD = 'segredo-de-teste-0';
let clock = new Date('2026-11-23T12:00:00.000Z');
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms); };

let flags: OpenBotFlags;
let secrets: string[];
let deps: OpenBotDeps;
let n = 0;

const ADMIN: Caller = { id: 'u', permissions: [OPENBOT_PERMISSIONS.dispatch, OPENBOT_PERMISSIONS.read] };
const isErr = (b: unknown): b is ApiError => typeof b === 'object' && b !== null && 'error' in b;
const code = (b: unknown) => (isErr(b) ? b.error.code : undefined);
const ok = <T>(r: { status: number; body: T | ApiError }): T => {
  assert.ok(!isErr(r.body), JSON.stringify(r.body));
  return r.body as T;
};

function signed(obj: unknown, secret = SECRET, ts = clock.getTime()): SignedRequest {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(secret, ts, body), timestampMs: ts };
}

const task = (over: Record<string, unknown> = {}) => ({
  kind: 'editorial_draft', profileId: 'writer_programas', refId: 'a1', idempotencyKey: 'k1', dataClass: 'public', maxCostMicro: 2_000_000, ...over,
});
const usage = (t: { id: string; leaseId: string }, over: Partial<UsageReport> = {}): UsageReport => ({
  executionId: `ex-${t.id}`, taskId: t.id, leaseId: t.leaseId, model: 'claude-haiku-5-5', generationIds: [`gen-${t.id}`],
  promptTokens: 1000, completionTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 1_500, ...over,
});

beforeEach(() => {
  clock = new Date('2026-11-23T12:00:00.000Z');
  flags = { ...DEFAULT_OPENBOT_FLAGS, dispatchEnabled: true };
  secrets = [SECRET];
  deps = {
    queue: new InMemoryLeaseQueue(() => `lease-${++n}`),
    ledger: new InMemoryCostLedger(),
    health: new InMemoryHealthStore(),
    callbacks: new InMemoryCallbackStore(),
    secrets: () => secrets,
    flags: () => flags,
    now: () => clock,
  };
});

async function dispatchAndPull(over: Record<string, unknown> = {}) {
  assert.equal((await dispatchTask(deps, ADMIN, task(over))).status, 201);
  const pull = ok<PullResult>(await handlePull(deps, signed({ workerId: 'openbot-1' })));
  return pull.tasks[0]!;
}

describe('disparo (lado LN)', () => {
  test('flag desligada por padrão: 409 DISPATCH_OFF; padrão de código é desligado', async () => {
    assert.deepEqual(DEFAULT_OPENBOT_FLAGS, { dispatchEnabled: false, kill: false });
    flags = { ...DEFAULT_OPENBOT_FLAGS };
    const r = await dispatchTask(deps, ADMIN, task());
    assert.equal(r.status, 409);
    assert.equal(code(r.body), 'DISPATCH_OFF');
  });

  test('sem permissão: 403; kill switch: 503', async () => {
    assert.equal((await dispatchTask(deps, { id: 'x', permissions: [] }, task())).status, 403);
    flags = { dispatchEnabled: true, kill: true };
    const r = await dispatchTask(deps, ADMIN, task());
    assert.equal(r.status, 503);
    assert.equal(code(r.body), 'KILL_SWITCH');
  });

  test('publicação NUNCA vai ao OpenBot (nem criação de post, nem composição determinística)', async () => {
    for (const kind of ['social_publish', 'publish', 'create_post', 'creative_composition', 'source_ingestion']) {
      const r = await dispatchTask(deps, ADMIN, task({ kind, idempotencyKey: `k-${kind}` }));
      assert.equal(r.status, 422, kind);
      assert.equal(code(r.body), 'KIND_FORBIDDEN', kind);
    }
    assert.equal(code((await dispatchTask(deps, ADMIN, task({ kind: 'inventado' }))).body), 'KIND_UNKNOWN');
    assert.equal((await deps.queue.counts()).pending, 0);
  });

  test('classe de dado restrita é bloqueada; só public e internal passam', async () => {
    for (const dataClass of ['personal', 'commercial_confidential', 'restricted', 'secret', 'desconhecida']) {
      const r = await dispatchTask(deps, ADMIN, task({ dataClass, idempotencyKey: `k-${dataClass}` }));
      assert.equal(r.status, 422, dataClass);
      assert.equal(code(r.body), 'DATA_CLASS_BLOCKED', dataClass);
    }
    assert.equal((await dispatchTask(deps, ADMIN, task({ dataClass: 'internal', idempotencyKey: 'ki' }))).status, 201);
  });

  test('validação: ids com conteúdo/espaço, custo não inteiro, teto da tarefa acima do teto mensal', async () => {
    assert.equal((await dispatchTask(deps, ADMIN, task({ refId: 'texto com espaço' }))).status, 400);
    assert.equal((await dispatchTask(deps, ADMIN, task({ maxCostMicro: 1.5 }))).status, 400);
    assert.equal((await dispatchTask(deps, ADMIN, task({ maxCostMicro: 0 }))).status, 400);
    const r = await dispatchTask(deps, ADMIN, task({ maxCostMicro: 50_000_001 }));
    assert.equal(r.status, 422);
    assert.equal(code(r.body), 'COST_CAP_EXCEEDS_BUDGET');
  });

  test('idempotente: mesma chave = mesma tarefa (200), uma só na fila', async () => {
    assert.equal((await dispatchTask(deps, ADMIN, task())).status, 201);
    assert.equal((await dispatchTask(deps, ADMIN, task())).status, 200);
    assert.equal((await deps.queue.counts()).pending, 1);
  });

  test('sem saldo no teto mensal: 409 BUDGET_EXHAUSTED', async () => {
    deps.capMicro = 3_000_000;
    const t = await dispatchAndPull({ maxCostMicro: 2_000_000 });
    ok(await handleCallback(deps, signed({ callbackId: 'cb1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: usage(t, { costMicro: 2_500_000 }) })));
    const r = await dispatchTask(deps, ADMIN, task({ idempotencyKey: 'k2', refId: 'a2', maxCostMicro: 1_000_000 }));
    assert.equal(r.status, 409);
    assert.equal(code(r.body), 'BUDGET_EXHAUSTED');
  });
});

describe('pull do OpenBot (assinado, só saída)', () => {
  test('sem assinatura, assinatura errada, corpo adulterado e timestamp velho: 401 e nada é entregue', async () => {
    await dispatchTask(deps, ADMIN, task());
    const good = signed({ workerId: 'w' });
    const attempts: SignedRequest[] = [
      { ...good, signature: undefined },
      { ...good, signature: signBody('errado', clock.getTime(), good.body) },
      { ...good, body: JSON.stringify({ workerId: 'w', limit: 10 }) },
      signed({ workerId: 'w' }, SECRET, clock.getTime() - 10 * 60_000),
    ];
    for (const a of attempts) assert.equal((await handlePull(deps, a)).status, 401);
    assert.equal((await deps.queue.counts()).leased, 0);
    assert.equal(await deps.health.last(), null, 'chamada recusada não conta como contato do OpenBot');
  });

  test('sem segredo configurado, tudo é 401 (falha fechada)', async () => {
    secrets = [];
    assert.equal((await handlePull(deps, signed({ workerId: 'w' }))).status, 401);
  });

  test('entrega a tarefa com lease e só IDs; registra o contato; respeita limit e kinds', async () => {
    await dispatchTask(deps, ADMIN, task());
    await dispatchTask(deps, ADMIN, task({ kind: 'fact_check', idempotencyKey: 'k2', refId: 'a2' }));
    const r = ok<PullResult>(await handlePull(deps, signed({ workerId: 'openbot-1', kinds: ['fact_check'] })));
    assert.equal(r.tasks.length, 1);
    assert.equal(r.tasks[0]!.kind, 'fact_check');
    assert.match(r.tasks[0]!.leaseId, /^lease-/);
    assert.deepEqual((await deps.health.last())?.workerId, 'openbot-1');
    assert.equal((await handlePull(deps, signed({ workerId: 'w', limit: 11 }))).status, 400);
    assert.equal((await handlePull(deps, signed({ workerId: 'w', kinds: ['social_publish'] }))).status, 400);
    assert.equal((await handlePull(deps, signed({ workerId: 'w', extra: 1 }))).status, 200);
  });

  test('rotação de segredo: aceita o anterior enquanto estiver na lista', async () => {
    secrets = [SECRET, OLD];
    assert.equal((await handlePull(deps, signed({ workerId: 'w' }, OLD))).status, 200);
    secrets = [SECRET];
    assert.equal((await handlePull(deps, signed({ workerId: 'w' }, OLD))).status, 401);
  });

  test('kill switch: 503 e nada é entregue', async () => {
    await dispatchTask(deps, ADMIN, task());
    flags = { dispatchEnabled: true, kill: true };
    const r = await handlePull(deps, signed({ workerId: 'w' }));
    assert.equal(r.status, 503);
    assert.equal((await deps.queue.counts()).leased, 0);
  });

  test('pull vazio é 200 com lista vazia (e conta como contato)', async () => {
    const r = ok<PullResult>(await handlePull(deps, signed({ workerId: 'w' })));
    assert.deepEqual(r.tasks, []);
    assert.ok(await deps.health.last());
  });
});

describe('heartbeat', () => {
  test('estende o lease; lease alheio 409; tarefa inexistente 404; assinatura errada 401', async () => {
    const t = await dispatchAndPull();
    tick(60_000);
    const hb = ok<{ leaseExpiresAt: string }>(await handleHeartbeat(deps, signed({ taskId: t.id, leaseId: t.leaseId })));
    assert.ok(Date.parse(hb.leaseExpiresAt) > Date.parse(t.leaseExpiresAt));
    assert.equal((await handleHeartbeat(deps, signed({ taskId: t.id, leaseId: 'lease-alheio' }))).status, 409);
    assert.equal((await handleHeartbeat(deps, signed({ taskId: 'nao-existe', leaseId: 'x' }))).status, 404);
    assert.equal((await handleHeartbeat(deps, signed({ taskId: t.id, leaseId: t.leaseId }, 'errado'))).status, 401);
  });
});

describe('callback assinado e idempotente', () => {
  test('conclui a tarefa, registra o custo e devolve o estado do orçamento', async () => {
    const t = await dispatchAndPull();
    const r = ok<CallbackResult>(await handleCallback(deps, signed({
      callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', resultRef: 'res-1', usage: usage(t),
    })));
    assert.deepEqual({ dup: r.duplicate, rec: r.costRecorded, over: r.overrun, st: r.task?.status, b: r.budget.status, p: r.pauseModelCalls }, { dup: false, rec: true, over: false, st: 'completed', b: 'ok', p: false });
    assert.equal(await deps.ledger.totalMicro(), 1_500);
  });

  test('replay do mesmo callbackId: 200 duplicate, sem novo efeito nem novo custo', async () => {
    const t = await dispatchAndPull();
    const body = { callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: usage(t) };
    ok(await handleCallback(deps, signed(body)));
    const again = ok<CallbackResult>(await handleCallback(deps, signed(body)));
    assert.equal(again.duplicate, true);
    assert.equal(again.costRecorded, false);
    assert.equal(await deps.ledger.totalMicro(), 1_500);
    assert.equal((await deps.queue.counts()).completed, 1);
  });

  test('callbackId novo com a mesma execução: tarefa já concluída pelo mesmo lease, custo não duplica', async () => {
    const t = await dispatchAndPull();
    const mk = (id: string) => ({ callbackId: id, taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: usage(t) });
    ok(await handleCallback(deps, signed(mk('cb-1'))));
    const r = ok<CallbackResult>(await handleCallback(deps, signed(mk('cb-2'))));
    assert.equal(r.costRecorded, false);
    assert.equal(await deps.ledger.totalMicro(), 1_500);
  });

  test('assinatura inválida: 401 e nenhum efeito', async () => {
    const t = await dispatchAndPull();
    const r = await handleCallback(deps, signed({ callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed' }, 'errado'));
    assert.equal(r.status, 401);
    assert.equal((await deps.queue.counts()).completed, 0);
  });

  test('custo desconhecido/ inválido: 422 sem efeito, e o callbackId NÃO é consumido (reenvio corrigido funciona)', async () => {
    const t = await dispatchAndPull();
    const base = { callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed' };
    const { costMicro: _omit, ...semCusto } = usage(t);
    void _omit;
    const bad = await handleCallback(deps, signed({ ...base, usage: semCusto }));
    assert.equal(bad.status, 422);
    assert.equal(code(bad.body), 'USAGE_INVALID');
    assert.equal((await deps.queue.counts()).leased, 1);
    const good = ok<CallbackResult>(await handleCallback(deps, signed({ ...base, usage: usage(t) })));
    assert.equal(good.duplicate, false);
    assert.equal(good.task?.status, 'completed');
  });

  test('custo de outra tarefa ou de outro lease: 422 USAGE_MISMATCH', async () => {
    const t = await dispatchAndPull();
    const base = { callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed' };
    assert.equal(code((await handleCallback(deps, signed({ ...base, usage: usage({ id: 'outra', leaseId: t.leaseId }) }))).body), 'USAGE_MISMATCH');
    assert.equal(code((await handleCallback(deps, signed({ ...base, usage: usage({ id: t.id, leaseId: 'lease-alheio' }) }))).body), 'USAGE_MISMATCH');
  });

  test('lease alheio ou vencido: 409; tarefa inexistente: 404; corpo inválido: 400', async () => {
    const t = await dispatchAndPull();
    assert.equal((await handleCallback(deps, signed({ callbackId: 'c1', taskId: t.id, leaseId: 'lease-alheio', outcome: 'completed' }))).status, 409);
    assert.equal((await handleCallback(deps, signed({ callbackId: 'c2', taskId: 'nao-existe', leaseId: 'x', outcome: 'completed' }))).status, 404);
    assert.equal((await handleCallback(deps, signed({ callbackId: 'c3', taskId: t.id, leaseId: t.leaseId, outcome: 'talvez' }))).status, 400);
    tick(10 * 60_000);
    assert.equal((await handleCallback(deps, signed({ callbackId: 'c4', taskId: t.id, leaseId: t.leaseId, outcome: 'completed' }))).status, 409);
  });

  test('falha retentável: volta à fila e é puxada de novo (tentativa 2); o custo da tentativa falha também é registrado', async () => {
    const t = await dispatchAndPull();
    const r = ok<CallbackResult>(await handleCallback(deps, signed({
      callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'failed', error: 'timeout', retryable: true, usage: usage(t),
    })));
    assert.equal(r.task?.status, 'pending');
    assert.equal(r.costRecorded, true);
    const again = ok<PullResult>(await handlePull(deps, signed({ workerId: 'openbot-1' })));
    assert.equal(again.tasks[0]!.attempt, 2);
  });

  test('estouro do teto da tarefa é sinalizado; estouro do teto mensal manda pausar chamadas de modelo', async () => {
    deps.capMicro = 3_000_000;
    const t = await dispatchAndPull({ maxCostMicro: 1_000_000 });
    const r = ok<CallbackResult>(await handleCallback(deps, signed({
      callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: usage(t, { costMicro: 3_500_000 }),
    })));
    assert.equal(r.overrun, true);
    assert.equal(r.budget.status, 'estourado');
    assert.equal(r.pauseModelCalls, true);
  });

  test('alerta a partir de 80% do teto', async () => {
    deps.capMicro = 10_000_000;
    const t = await dispatchAndPull({ maxCostMicro: 9_000_000 });
    const r = ok<CallbackResult>(await handleCallback(deps, signed({
      callbackId: 'cb-1', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: usage(t, { costMicro: 8_000_000 }),
    })));
    assert.equal(r.budget.status, 'alerta');
    assert.equal(r.pauseModelCalls, false);
  });
});

describe('estado do adaptador', () => {
  test('saúde, fila, custo e flags; sem permissão 403; nunca expõe segredo', async () => {
    assert.equal((await getOpenBotStatus(deps, { id: 'x', permissions: [] })).status, 403);
    const before = ok(await getOpenBotStatus(deps, ADMIN));
    assert.equal(before.health.status, 'sem_contato');
    assert.equal(before.health.pausePublishing, true);
    await dispatchAndPull();
    const after = ok(await getOpenBotStatus(deps, ADMIN));
    assert.equal(after.health.status, 'saudavel');
    assert.equal(after.queue.leased, 1);
    assert.equal(after.cost.capMicro, 50_000_000);
    assert.equal(JSON.stringify(after).includes(SECRET), false);
    tick(10 * 60_000);
    const late = ok(await getOpenBotStatus(deps, ADMIN));
    assert.equal(late.health.status, 'atrasado');
    assert.equal(late.health.fallbackWorkers, true);
  });
});
