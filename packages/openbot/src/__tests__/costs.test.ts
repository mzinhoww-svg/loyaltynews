import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { budgetStatus, InMemoryCostLedger, MONTHLY_CAP_MICRO, reconcile, validateUsage } from '../costs';
import { evaluateHealth, InMemoryHealthStore } from '../health';
import type { UsageReport } from '../types';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const usage = (over: Partial<UsageReport> = {}): UsageReport => ({
  executionId: 'e1', taskId: 't1', leaseId: 'l1', model: 'claude-haiku-5-5', generationIds: ['g1'],
  promptTokens: 1000, completionTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 1500, ...over,
});

describe('validação do custo relatado', () => {
  test('relato completo passa', () => assert.deepEqual(validateUsage(usage()), { ok: true, problems: [] }));

  test('custo ausente, nulo, negativo, fracionário ou NaN = preço desconhecido (recusa)', () => {
    for (const c of [undefined, null, -1, 1.5, Number.NaN, '10']) {
      const v = validateUsage({ ...usage(), costMicro: c });
      assert.equal(v.ok, false, String(c));
      assert.ok(v.problems.some((p) => p.code === 'custo_desconhecido'), String(c));
    }
  });

  test('contagens inválidas, ids inválidos e campos ausentes', () => {
    assert.ok(validateUsage({ ...usage(), promptTokens: -1 }).problems.some((p) => p.field === 'promptTokens'));
    assert.ok(validateUsage({ ...usage(), executionId: 'com espaço' }).problems.some((p) => p.code === 'id_invalido'));
    assert.ok(validateUsage({ ...usage(), model: '' }).problems.some((p) => p.field === 'model'));
    assert.equal(validateUsage(null).ok, false);
    assert.equal(validateUsage([]).ok, false);
  });

  test('gasto sem id de geração não pode ser conciliado (recusa); execução determinística (tudo zero) sem geração passa', () => {
    assert.ok(validateUsage({ ...usage(), generationIds: [] }).problems.some((p) => p.code === 'geracao_ausente'));
    assert.equal(validateUsage(usage({ generationIds: [], costMicro: 0, promptTokens: 0, completionTokens: 0 })).ok, true);
  });
});

describe('livro de custos', () => {
  test('deduplica por executionId e soma inteiros', async () => {
    const l = new InMemoryCostLedger();
    assert.equal((await l.record(usage(), 10_000, NOW)).recorded, true);
    assert.equal((await l.record(usage({ costMicro: 999 }), 10_000, NOW)).recorded, false);
    await l.record(usage({ executionId: 'e2', costMicro: 500 }), 10_000, NOW);
    assert.equal(await l.totalMicro(), 2000);
    assert.equal((await l.entries()).length, 2);
  });

  test('estouro do teto da tarefa é registrado, não escondido', async () => {
    const l = new InMemoryCostLedger();
    const r = await l.record(usage({ costMicro: 5000 }), 1000, NOW);
    assert.equal(r.entry.overrun, true);
    assert.equal((await l.record(usage({ executionId: 'e3', costMicro: 1000 }), 1000, NOW)).entry.overrun, false);
  });
});

describe('orçamento (US$ 50)', () => {
  test('limiares ok / alerta (80%) / estourado, em inteiros', () => {
    assert.equal(MONTHLY_CAP_MICRO, 50_000_000);
    assert.equal(budgetStatus(0).status, 'ok');
    assert.equal(budgetStatus(39_999_999).status, 'ok');
    assert.equal(budgetStatus(40_000_000).status, 'alerta');
    assert.equal(budgetStatus(50_000_000).status, 'alerta');
    assert.deepEqual(budgetStatus(50_000_001), { status: 'estourado', remainingMicro: -1 });
    assert.equal(budgetStatus(10, 100).status, 'ok');
  });
});

describe('conciliação com o ledger do gateway (por generationId)', () => {
  test('tudo bate: ok', () => {
    const r = reconcile([usage(), usage({ executionId: 'e2', generationIds: ['g2'], costMicro: 700 })], [
      { generationId: 'g1', costMicro: 1500 }, { generationId: 'g2', costMicro: 700 },
    ]);
    assert.deepEqual({ ok: r.ok, matched: r.matched, a: r.totalOpenbotMicro, b: r.totalGatewayMicro }, { ok: true, matched: 2, a: 2200, b: 2200 });
  });

  test('geração relatada pelo OpenBot que o gateway não tem: custo sem lastro', () => {
    const r = reconcile([usage()], []);
    assert.equal(r.ok, false);
    assert.deepEqual(r.onlyOpenbot, ['g1']);
  });

  test('gasto no gateway que o OpenBot não relatou: sem relato', () => {
    const r = reconcile([usage()], [{ generationId: 'g1', costMicro: 1500 }, { generationId: 'g9', costMicro: 300 }]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.onlyGateway, ['g9']);
    assert.equal(r.totalGatewayMicro, 1800);
  });

  test('valores diferentes: divergência por geração; tolerância aceita diferença pequena', () => {
    const r = reconcile([usage()], [{ generationId: 'g1', costMicro: 1600 }]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.mismatches, [{ generationId: 'g1', openbotMicro: 1500, gatewayMicro: 1600 }]);
    assert.equal(reconcile([usage()], [{ generationId: 'g1', costMicro: 1600 }], 100).ok, true);
  });

  test('execução com várias gerações: repartição inteira que preserva a soma', () => {
    const r = reconcile([usage({ generationIds: ['a', 'b', 'c'], costMicro: 10 })], [
      { generationId: 'a', costMicro: 4 }, { generationId: 'b', costMicro: 3 }, { generationId: 'c', costMicro: 3 },
    ]);
    assert.equal(r.totalOpenbotMicro, 10);
    assert.equal(r.totalGatewayMicro, 10);
    assert.equal(r.ok, true);
  });

  test('consumo alheio no mesmo saldo (geração que nenhum relato do LN cita) aparece como onlyGateway e reprova a soma', () => {
    const r = reconcile([], [{ generationId: 'alheio', costMicro: 50 }]);
    assert.deepEqual(r.onlyGateway, ['alheio']);
    assert.equal(r.ok, false);
  });
});

describe('saúde pelo último pull', () => {
  test('sem contato, saudável e atrasado; atrasado/sem contato pedem workers de reserva e pausa de publicação', async () => {
    const s = new InMemoryHealthStore();
    assert.deepEqual(await evaluateHealth(s, NOW), { status: 'sem_contato', fallbackWorkers: true, pausePublishing: true });
    await s.markPull('w1', NOW);
    const ok = await evaluateHealth(s, new Date(NOW.getTime() + 60_000));
    assert.equal(ok.status, 'saudavel');
    assert.equal(ok.pausePublishing, false);
    const late = await evaluateHealth(s, new Date(NOW.getTime() + 10 * 60_000));
    assert.equal(late.status, 'atrasado');
    assert.equal(late.fallbackWorkers, true);
    assert.equal(late.pausePublishing, true);
  });
});
