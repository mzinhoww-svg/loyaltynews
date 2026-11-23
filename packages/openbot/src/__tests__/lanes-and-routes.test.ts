import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { validateUsage, reconcile } from '../costs';
import { InMemoryLeaseQueue } from '../lease-queue';
import { routeFor, routeProblems } from '../handlers';
import { DEFAULT_ROUTES, DISPATCHABLE_KINDS, NEVER_DISPATCH_KINDS, providerOfModel, type NewTask, type UsageReport } from '../types';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base = { executionId: 'e1', taskId: 't1', leaseId: 'l1', model: 'claude-sonnet-5-5', costMicro: 0 };
const codes = (u: unknown) => validateUsage(u).problems.map((p) => p.code);

describe('faixas de custo: assinatura, OpenCode e Antigravity (sem geração do OpenRouter)', () => {
  test('assinatura (Claude/Codex): custo 0, sem generationIds e sem tokens passa', () => {
    assert.deepEqual(validateUsage({ ...base, lane: 'subscription', account: 'claude' }), { ok: true, problems: [] });
    assert.equal(validateUsage({ ...base, lane: 'subscription', account: 'codex', model: 'gpt-6.2-sol' }).ok, true);
  });

  test('OpenCode e Antigravity: cada uma com a sua conta', () => {
    assert.equal(validateUsage({ ...base, lane: 'opencode', account: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' }).ok, true);
    assert.equal(validateUsage({ ...base, lane: 'antigravity', account: 'antigravity', model: 'gemini-3.8-flash' }).ok, true);
  });

  test('conta incompatível com a faixa é recusada (e conta ausente também)', () => {
    for (const bad of [{ lane: 'subscription', account: 'opencode' }, { lane: 'opencode', account: 'claude' }, { lane: 'antigravity', account: 'codex' }, { lane: 'subscription' }, { lane: 'opencode', account: 'nope' }]) {
      assert.ok(codes({ ...base, ...bad }).includes('conta_incompativel'), JSON.stringify(bad));
    }
  });

  test('custo > 0 numa faixa gratuita é recusado (qualquer centavo seria API tarifada disfarçada)', () => {
    for (const lane of [['subscription', 'claude'], ['opencode', 'opencode'], ['antigravity', 'antigravity']] as const) {
      assert.ok(codes({ ...base, lane: lane[0], account: lane[1], costMicro: 1 }).includes('custo_em_faixa_gratuita'), lane[0]);
    }
    assert.ok(codes({ ...base, lane: 'subscription', account: 'claude', costMicro: undefined }).includes('custo_desconhecido'), 'custo ausente continua recusado');
  });

  test('faixa gratuita: tokens e ids, se vierem, precisam ser válidos; faixa desconhecida é recusada', () => {
    assert.ok(codes({ ...base, lane: 'subscription', account: 'claude', promptTokens: -1 }).includes('numero_invalido'));
    assert.ok(codes({ ...base, lane: 'subscription', account: 'claude', generationIds: ['com espaço'] }).includes('id_invalido'));
    assert.deepEqual(codes({ ...base, lane: 'turbo' }), ['faixa_invalida']);
  });

  test('a faixa tarifada (padrão) continua exigindo tokens, custo conhecido e ids de geração quando há gasto', () => {
    assert.ok(codes({ ...base, costMicro: 100 }).includes('numero_invalido'));
    assert.ok(codes({ ...base, costMicro: 100, promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, generationIds: [] }).includes('geracao_ausente'));
    assert.ok(codes({ ...base, lane: 'api', account: 'claude', promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, generationIds: [] }).includes('conta_incompativel'));
  });

  test('a conciliação com o gateway ignora as faixas gratuitas (não têm geração)', () => {
    const free: UsageReport = { ...base, lane: 'subscription', account: 'claude' };
    const api: UsageReport = { ...base, executionId: 'e2', costMicro: 500, promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, generationIds: ['g1'] };
    const r = reconcile([free, api], [{ generationId: 'g1', costMicro: 500 }]);
    assert.equal(r.ok, true);
    assert.equal(r.totalOpenbotMicro, 500);
  });
});

describe('tipos de tarefa', () => {
  test('revisão editorial e texto social são despacháveis; publicação continua proibida', () => {
    for (const k of ['editorial_review', 'social_copy', 'editorial_draft', 'fact_check', 'classification', 'entity_resolution']) {
      assert.ok((DISPATCHABLE_KINDS as readonly string[]).includes(k), k);
    }
    for (const k of DISPATCHABLE_KINDS) assert.equal((NEVER_DISPATCH_KINDS as readonly string[]).includes(k), false, k);
    assert.ok((NEVER_DISPATCH_KINDS as readonly string[]).includes('create_post'));
  });
});

describe('rotas de contas por tipo', () => {
  test('rotas padrão do piloto: pauta opencode→claude→antigravity; checagem e revisão codex→antigravity; redação só claude', () => {
    assert.deepEqual(routeFor({}, 'classification'), ['opencode', 'claude', 'antigravity']);
    assert.deepEqual(routeFor({}, 'fact_check'), ['codex', 'antigravity']);
    assert.deepEqual(routeFor({}, 'editorial_review'), ['codex', 'antigravity']);
    assert.deepEqual(routeFor({}, 'editorial_draft'), ['claude']);
    assert.deepEqual(routeFor({}, 'daily'), ['claude'], 'sem rota definida: via única claude');
  });

  test('rota configurada substitui a padrão; a devolvida é cópia (não vaza o objeto interno)', () => {
    const r = routeFor({ routes: { classification: ['claude'] } }, 'classification');
    assert.deepEqual(r, ['claude']);
    const d = routeFor({}, 'fact_check');
    d.push('opencode');
    assert.deepEqual(DEFAULT_ROUTES.fact_check, ['codex', 'antigravity']);
  });

  test('invariantes: rota não vazia, contas conhecidas, sem repetição; redação nunca com mais de uma via', () => {
    assert.deepEqual(routeProblems('classification', ['opencode', 'claude']), []);
    assert.ok(routeProblems('classification', []).includes('rota vazia'));
    assert.ok(routeProblems('classification', ['opencode', 'opencode']).includes('conta repetida na rota'));
    assert.ok(routeProblems('classification', ['gemini']).includes('conta desconhecida na rota'));
    assert.ok(routeProblems('editorial_draft', ['claude', 'codex']).some((m) => m.includes('nunca troca de via')));
    assert.deepEqual(routeProblems('editorial_draft', ['claude']), []);
  });

  test('provedor do autor pelo modelo declarado (a via Antigravity hospeda várias famílias)', () => {
    assert.equal(providerOfModel('claude-sonnet-5-5', 'claude'), 'anthropic');
    assert.equal(providerOfModel('gpt-6.2-sol', 'codex'), 'openai');
    assert.equal(providerOfModel('gemini-3.8-flash', 'antigravity'), 'google');
    assert.equal(providerOfModel('claude-sonnet-4-6', 'antigravity'), 'anthropic', 'Claude via Antigravity continua sendo Anthropic');
    assert.equal(providerOfModel('gpt-oss-120b-medium', 'antigravity'), 'openai');
    assert.equal(providerOfModel('opencode/deepseek-v4.1-flash-free', 'opencode'), 'deepseek');
    assert.equal(providerOfModel(null, 'opencode'), 'opencode');
  });
});

describe('fila: troca de via no limite', () => {
  const task = (over: Partial<NewTask> = {}): NewTask => ({
    kind: 'classification', profileId: 'newsdesk', refId: 'a1', idempotencyKey: 'k1', dataClass: 'public', maxCostMicro: 1,
    route: ['opencode', 'claude', 'antigravity'], ...over,
  });
  let n = 0;
  const q = () => new InMemoryLeaseQueue(() => `lease-${++n}`);
  const claim = (queue: InMemoryLeaseQueue, account: 'opencode' | 'claude' | 'antigravity' | 'codex', now: Date) => queue.claim({ workerId: `w-${account}`, now, leaseMs: 60_000, limit: 5, account });

  test('cada via só recebe as tarefas cuja via atual é a dela', async () => {
    const queue = q();
    await queue.enqueue(task(), NOW);
    assert.deepEqual(await claim(queue, 'claude', NOW), []);
    const [t] = await claim(queue, 'opencode', NOW);
    assert.equal(t!.account, 'opencode');
  });

  test('limite na via atual passa a tarefa à PRÓXIMA via, já disponível; o limite não consome tentativa', async () => {
    const queue = q();
    await queue.enqueue(task({ maxAttempts: 1 }), NOW);
    const [a] = await claim(queue, 'opencode', NOW);
    const f1 = await queue.fail(a!.id, a!.leaseId, 'limite', true, at(10), 1800_000, { account: 'opencode', switchRoute: true });
    assert.equal(f1.task.status, 'pending');
    assert.equal(f1.task.routeIndex, 1);
    assert.equal(f1.task.availableAt, undefined);
    assert.equal(f1.task.limitHits, 1);
    assert.deepEqual(f1.task.accountsLimited.map((x) => x.account), ['opencode']);
    assert.deepEqual(await claim(queue, 'opencode', at(20)), [], 'a via que bateu o limite não puxa mais');
    const [b] = await claim(queue, 'claude', at(20));
    assert.equal(b!.id, a!.id);
    assert.equal(b!.attempt, 2);
    const f2 = await queue.fail(b!.id, b!.leaseId, 'limite', true, at(30), 1800_000, { account: 'claude', switchRoute: true });
    assert.equal(f2.task.routeIndex, 2);
    const [c] = await claim(queue, 'antigravity', at(40));
    assert.equal(c!.attempt, 3);
    assert.equal((await queue.complete(c!.id, c!.leaseId, 'res', at(50))).task.status, 'completed');
  });

  test('todas as vias no limite: espera a janela e recomeça pela via preferida', async () => {
    const queue = q();
    await queue.enqueue(task({ route: ['opencode', 'claude'] }), NOW);
    const [a] = await claim(queue, 'opencode', NOW);
    await queue.fail(a!.id, a!.leaseId, 'limite', true, at(1), 600_000, { account: 'opencode', switchRoute: true });
    const [b] = await claim(queue, 'claude', at(2));
    const f = await queue.fail(b!.id, b!.leaseId, 'limite', true, at(3), 600_000, { account: 'claude', switchRoute: true });
    assert.equal(f.task.routeIndex, 0);
    assert.equal(f.task.availableAt, at(3 + 600_000).toISOString());
    assert.deepEqual(await claim(queue, 'opencode', at(1000)), [], 'ainda esperando a janela');
    const [c] = await claim(queue, 'opencode', at(3 + 600_001));
    assert.equal(c!.account, 'opencode');
  });

  test('redação (sem troca): o limite espera a janela e a MESMA via retoma; nunca passa a outra', async () => {
    const queue = q();
    await queue.enqueue(task({ kind: 'editorial_draft', route: ['claude'] }), NOW);
    const [a] = await claim(queue, 'claude', NOW);
    const f = await queue.fail(a!.id, a!.leaseId, 'limite', true, at(1), 900_000, { account: 'claude', switchRoute: false });
    assert.equal(f.task.routeIndex, 0);
    assert.ok(f.task.availableAt);
    for (const acc of ['opencode', 'antigravity', 'codex'] as const) assert.deepEqual(await claim(queue, acc, at(900_000 + 100)), [], acc);
    assert.deepEqual(await claim(queue, 'claude', at(1000)), []);
    const [b] = await claim(queue, 'claude', at(900_002));
    assert.equal(b!.id, a!.id);
  });

  test('a rota de redação não troca nem quando a rota tem mais vias e o limite pede troca desligada', async () => {
    const queue = q();
    await queue.enqueue(task({ route: ['claude', 'antigravity'] }), NOW);
    const [a] = await claim(queue, 'claude', NOW);
    const f = await queue.fail(a!.id, a!.leaseId, 'limite', true, at(1), 60_000, { account: 'claude', switchRoute: false });
    assert.equal(f.task.routeIndex, 0);
    assert.deepEqual(await claim(queue, 'antigravity', at(2)), []);
  });

  test('falha comum (não limite) continua contando tentativa e esgota em dead', async () => {
    const queue = q();
    await queue.enqueue(task({ maxAttempts: 2 }), NOW);
    let [t] = await claim(queue, 'opencode', NOW);
    assert.equal((await queue.fail(t!.id, t!.leaseId, 'erro', true, at(1))).task.status, 'pending');
    [t] = await claim(queue, 'opencode', at(2));
    assert.equal((await queue.fail(t!.id, t!.leaseId, 'erro', true, at(3))).task.status, 'dead');
  });

  test('sem filtro de via (compatibilidade), qualquer worker puxa; tarefa sem rota usa a via única claude', async () => {
    const queue = q();
    await queue.enqueue(task({ route: undefined }), NOW);
    const [t] = await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    assert.equal(t!.account, 'claude');
  });
});
