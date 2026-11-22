import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPolicyFile } from './policy';
import { BudgetGate, gateConfigFromPolicy } from './budget';
import { MemoryLedgerStore } from './ledger';
import { callModel, reconcilePending, type GatewayCall, type GatewayDeps } from './gateway';
import { SimulatedOpenRouterClient, type SimulatedOptions } from './openrouter.mock';
import { BalanceGuard } from './balance';
import type { ModelPolicy } from './types';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v4.json', import.meta.url));
const base = loadPolicyFile(FIXTURE).policy as ModelPolicy;
const NOW = new Date('2026-11-23T12:00:00-03:00');
const QUALIFIED = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'openai-text-review', 'openai-text-review-alt'];

function policyClone(): ModelPolicy {
  return JSON.parse(JSON.stringify(base)) as ModelPolicy;
}

function setup(policy: ModelPolicy = base, clientOpts: SimulatedOptions = {}, balance?: BalanceGuard) {
  const store = new MemoryLedgerStore();
  const gate = new BudgetGate(gateConfigFromPolicy(policy), store);
  const client = new SimulatedOpenRouterClient(clientOpts);
  const deps: GatewayDeps = { policy, gate, client, balance };
  return { store, gate, client, deps };
}

function call(over: Partial<GatewayCall> = {}): GatewayCall {
  return {
    task: 'editorial_draft',
    dataClasses: ['public'],
    unpublished: false,
    mode: 'simulation',
    qualifiedModelIds: QUALIFIED,
    zdrVerifiedModelIds: [],
    now: NOW,
    messages: [{ role: 'user', content: 'teste' }],
    estimate: { promptTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false },
    ...over,
  };
}

test('caminho feliz: reserva, chamada com coleta negada, conciliação e registro no ledger', async () => {
  const { deps, client, store } = setup();
  const out = await callModel(deps, call());
  assert.equal(out.status, 'ok');
  if (out.status === 'ok') {
    assert.equal(out.model, 'anthropic/claude-haiku-5.5');
    assert.equal(out.attempts, 1);
    assert.equal(out.costUsd, 0.5);
    assert.equal(out.overrun, true, 'custo real de 0,50 acima da reserva estimada é sinalizado');
  }
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]?.provider.data_collection, 'deny');
  const types = (await store.readAll()).map((e) => e.type);
  assert.deepEqual(types, ['reserve', 'commit']);
});

test('produção desligada: nenhuma chamada sai e nada é reservado', async () => {
  const { deps, client, store } = setup();
  const out = await callModel(deps, call({ mode: 'production' }));
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') assert.equal(out.reason, 'production_disabled');
  assert.equal(client.calls.length, 0);
  assert.equal((await store.readAll()).length, 0);
});

test('parada global bloqueia antes de qualquer decisão de orçamento', async () => {
  const { deps, client, store } = setup();
  const out = await callModel(deps, call({ killGlobal: true }));
  assert.equal(out.status, 'blocked');
  assert.equal(client.calls.length, 0);
  assert.equal((await store.readAll()).length, 0);
});

test('tarefa determinística não reserva orçamento nem chama modelo', async () => {
  const { deps, client, store } = setup();
  const out = await callModel(deps, call({ task: 'social_publish' }));
  assert.equal(out.status, 'deterministic');
  assert.equal(client.calls.length, 0);
  assert.equal((await store.readAll()).length, 0);
});

test('rejeição com status sem cobrança (429) libera a reserva e cai no fallback lateral', async () => {
  const { deps, client, gate, store } = setup(base, { failFirst: 1, failKind: 'rejected' });
  const out = await callModel(deps, call({ task: 'fact_check', draftModelId: 'deepseek/deepseek-v4-pro' }));
  assert.equal(out.status, 'ok');
  if (out.status === 'ok') {
    assert.equal(out.model, 'openai/gpt-6.1-terra', 'o primário (Sonnet) foi rejeitado e o fallback OpenAI respondeu');
    assert.equal(out.attempts, 2);
  }
  assert.equal(client.calls.length, 2);
  const types = (await store.readAll()).map((e) => e.type);
  assert.deepEqual(types, ['reserve', 'release', 'reserve', 'commit']);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 500_000, 'só a chamada concluída conta');
});

// Regressão do parecer QA (ft-modelops-finops): falha depois do envio não libera a reserva nem chama outro modelo.
test('REGRESSÃO: timeout depois do envio mantém a reserva pendente, sem fallback e sem liberar', async () => {
  const { deps, client, gate, store } = setup(base, { failFirst: 1 });
  const out = await callModel(deps, call({ task: 'fact_check', draftModelId: 'deepseek/deepseek-v4-pro' }));
  assert.equal(out.status, 'blocked');
  if (out.status !== 'blocked') return;
  assert.equal(out.reason, 'pending_reconciliation');
  assert.equal(out.attempts, 1);
  assert.equal(client.calls.length, 1, 'nenhum fallback automático depois de resultado incerto');
  assert.deepEqual((await store.readAll()).map((e) => e.type), ['reserve', 'pending']);

  const id = out.reservationId;
  assert.ok(id, 'a reserva é devolvida para conciliação');
  const st = id ? await gate.statusOf(id) : undefined;
  assert.equal(st?.status, 'pending');
  const snap = await gate.snapshot(NOW);
  assert.equal(snap.totalMicro, st?.reservedMicro, 'a reserva pendente continua contando no teto');
  assert.equal(snap.pendingReservations, 1);
});

test('reconciliação: sem prova de cobrança ou ausência, a reserva segue pendente e no teto', async () => {
  const { deps, gate } = setup(base, { failFirst: 1 });
  const out = await callModel(deps, call());
  if (out.status !== 'blocked' || !out.reservationId) throw new Error('esperava pendente');
  const before = (await gate.snapshot(NOW)).totalMicro;
  const outcome = await reconcilePending(deps, out.reservationId, async () => ({ kind: 'unknown' }), NOW);
  assert.equal(outcome, 'still_pending');
  assert.equal((await gate.snapshot(NOW)).totalMicro, before);
});

test('reconciliação com evidência de não cobrança libera a reserva; repetir é recusado', async () => {
  const { deps, gate } = setup(base, { failFirst: 1 });
  const out = await callModel(deps, call());
  if (out.status !== 'blocked' || !out.reservationId) throw new Error('esperava pendente');
  const probe = async () => ({ kind: 'not_charged' as const, evidence: 'geração inexistente na consulta' });
  assert.equal(await reconcilePending(deps, out.reservationId, probe, NOW), 'released');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 0, 'liberada após prova');
  assert.equal(await reconcilePending(deps, out.reservationId, probe, NOW), 'refused');
});

test('reconciliação com cobrança confirmada fecha pelo custo real', async () => {
  const { deps, gate } = setup(base, { failFirst: 1 });
  const out = await callModel(deps, call());
  if (out.status !== 'blocked' || !out.reservationId) throw new Error('esperava pendente');
  const outcome = await reconcilePending(deps, out.reservationId, async () => ({ kind: 'charged', costUsd: 0.3 }), NOW);
  assert.equal(outcome, 'committed');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 300_000);
});

test('liberação de pendente exige evidência não vazia', async () => {
  const { deps, gate } = setup(base, { failFirst: 1 });
  const out = await callModel(deps, call());
  if (out.status !== 'blocked' || !out.reservationId) throw new Error('esperava pendente');
  const refused = await gate.releaseConciliated(out.reservationId, '   ', NOW);
  assert.equal(refused.ok, false);
  assert.equal((await gate.statusOf(out.reservationId))?.status, 'pending', 'continua pendente');
});

test('recusa de verba passa ao próximo candidato; se nenhum cabe, bloqueia sem chamar', async () => {
  const { deps, client, gate } = setup();
  await gate.reserve({
    taskId: 'editorial_draft',
    taskClass: 'essential',
    lane: 'text',
    provider: 'openai',
    model: 'openai/gpt-6.1-terra',
    escalation: false,
    amountUsd: 20,
    at: NOW,
  });
  const out = await callModel(deps, call({ task: 'fact_check', draftModelId: 'anthropic/claude-haiku-5.5' }));
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') {
    assert.equal(out.reason, 'budget_refused');
    assert.equal(out.detail, 'provider_allocation_exhausted');
  }
  assert.equal(client.calls.length, 0);
});

test('evidência incompleta bloqueia a saída, mas o custo real fica registrado', async () => {
  const { deps, gate } = setup(base, { omitGeneration: true });
  const out = await callModel(deps, call());
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') {
    assert.equal(out.reason, 'evidence_invalid');
    assert.equal(out.costUsd, 0.5);
  }
  assert.equal((await gate.snapshot(NOW)).totalMicro, 500_000, 'a chamada custou e conta no teto');
});

test('resposta do mesmo autor que o redator é bloqueada no fact-check', async () => {
  const { deps } = setup(base, { responseModel: 'deepseek/deepseek-v4-pro' });
  const out = await callModel(deps, call({ task: 'fact_check', draftModelId: 'deepseek/deepseek-v4-pro' }));
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') assert.equal(out.reason, 'response_same_author');
});

test('fact-check com redator Anthropic usa OpenAI; o custo entra na classe essencial', async () => {
  const { deps, gate } = setup();
  const out = await callModel(deps, call({ task: 'fact_check', draftModelId: 'anthropic/claude-haiku-5.5' }));
  assert.equal(out.status, 'ok');
  if (out.status === 'ok') assert.equal(out.model, 'openai/gpt-6.1-terra');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 500_000);
});

test('política com produção ligada e qualificação: a chamada passa; sem qualificação, não', async () => {
  const p = policyClone();
  p.rules.production_enabled = true;
  const off = setup(p);
  const none = await callModel(off.deps, call({ mode: 'production', qualifiedModelIds: [] }));
  assert.equal(none.status, 'blocked');
  assert.equal(off.client.calls.length, 0);

  const on = setup(p);
  const yes = await callModel(on.deps, call({ mode: 'production', qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(yes.status, 'ok');
});

// Portão de saldo (DP-14): saldo real é limite além do teto de US$ 50.
test('saldo insuficiente recusa antes de reservar: nada é reservado nem chamado', async () => {
  const balance = new BalanceGuard(async () => 0.0001, 10);
  const { deps, client, store } = setup(base, {}, balance);
  const out = await callModel(deps, call());
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') {
    assert.equal(out.reason, 'budget_refused');
    assert.equal(out.detail, 'insufficient_balance');
  }
  assert.equal(client.calls.length, 0);
  assert.equal((await store.readAll()).length, 0);
});

test('chamada com saldo suficiente desconta o custo real do saldo estimado', async () => {
  const balance = new BalanceGuard(async () => 10, 10);
  const { deps } = setup(base, { costUsd: 0.5 }, balance);
  const out = await callModel(deps, call());
  assert.equal(out.status, 'ok');
  assert.equal(balance.estimate(), 9.5);
});

test('falha ao ler o saldo bloqueia a chamada (falha fechada)', async () => {
  const balance = new BalanceGuard(async () => {
    throw new Error('rede');
  }, 10);
  const { deps, client } = setup(base, {}, balance);
  const out = await callModel(deps, call());
  assert.equal(out.status, 'blocked');
  if (out.status === 'blocked') {
    assert.equal(out.reason, 'budget_refused');
    assert.equal(out.detail, 'balance_unknown');
  }
  assert.equal(client.calls.length, 0);
});
