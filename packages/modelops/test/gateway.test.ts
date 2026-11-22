import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPolicyFile } from '../src/policy.ts';
import { BudgetGate, gateConfigFromPolicy } from '../src/budget.ts';
import { MemoryLedgerStore } from '../src/ledger.ts';
import { callModel, type GatewayCall } from '../src/gateway.ts';
import { SimulatedOpenRouterClient } from '../src/openrouter.mock.ts';
import type { ModelPolicy } from '../src/types.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v4.json', import.meta.url));
const base = loadPolicyFile(FIXTURE).policy as ModelPolicy;
const NOW = new Date('2026-11-23T12:00:00-03:00');
const QUALIFIED = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'openai-text-review', 'openai-text-review-alt'];

function policyClone(): ModelPolicy {
  return JSON.parse(JSON.stringify(base)) as ModelPolicy;
}

function setup(policy: ModelPolicy = base, clientOpts: ConstructorParameters<typeof SimulatedOpenRouterClient>[0] = {}) {
  const store = new MemoryLedgerStore();
  const gate = new BudgetGate(gateConfigFromPolicy(policy), store);
  const client = new SimulatedOpenRouterClient(clientOpts);
  return { store, gate, client, deps: { policy, gate, client } };
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

test('falha de provedor libera a reserva e cai no fallback lateral da mesma classe', async () => {
  const { deps, client, gate, store } = setup(base, { failFirst: 1 });
  const out = await callModel(
    deps,
    call({ task: 'fact_check', draftModelId: 'deepseek/deepseek-v4-pro' }),
  );
  assert.equal(out.status, 'ok');
  if (out.status === 'ok') {
    assert.equal(out.model, 'openai/gpt-6.1-terra', 'o primário (Sonnet) falhou e o fallback OpenAI respondeu');
    assert.equal(out.attempts, 2);
  }
  assert.equal(client.calls.length, 2);
  const types = (await store.readAll()).map((e) => e.type);
  assert.deepEqual(types, ['reserve', 'release', 'reserve', 'commit']);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 500_000, 'só a chamada concluída conta');
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
