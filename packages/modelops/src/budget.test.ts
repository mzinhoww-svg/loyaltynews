import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPolicyFile } from './policy';
import { BudgetGate, gateConfigFromPolicy, type ReserveInput } from './budget';
import { MemoryLedgerStore } from './ledger';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url));
const policy = loadPolicyFile(FIXTURE).policy;
if (!policy) throw new Error('fixture inválido');
const cfg = gateConfigFromPolicy(policy);

const NOW = new Date('2026-11-23T12:00:00-03:00');
const AUDIT = 'wf08_correction';

function newGate(): { gate: BudgetGate; store: MemoryLedgerStore } {
  const store = new MemoryLedgerStore();
  return { gate: new BudgetGate(cfg, store), store };
}

function req(over: Partial<ReserveInput> = {}): ReserveInput {
  return {
    taskId: 'editorial_draft',
    taskClass: 'essential',
    lane: 'text',
    provider: 'anthropic',
    model: 'anthropic/claude-sonnet-5.5',
    escalation: false,
    amountUsd: 1,
    at: NOW,
    ...over,
  };
}

test('configuração derivada da política: teto 50, verbas, reserva 8 e degraus', () => {
  assert.equal(cfg.capMicro, 50_000_000);
  assert.equal(cfg.providerAllocationMicro.openai, 20_000_000);
  assert.equal(cfg.providerAllocationMicro.anthropic, 22_000_000);
  assert.equal(cfg.providerAllocationMicro.deepseek, 0);
  assert.equal(cfg.imageAllocationMicro, 0);
  assert.equal(cfg.reserveMicro, 8_000_000);
  assert.equal(cfg.escalationSublimitMicro, 5_000_000);
  assert.deepEqual(cfg.ceilingMicro, {
    premium: 35_000_000,
    non_essential: 40_000_000,
    essential: 42_000_000,
    reserve: 50_000_000,
  });
  assert.ok(cfg.reserveTaskIds.includes(AUDIT));
});

test('concorrência: 100 reservas simultâneas numa verba de 22 deixam exatamente 22', async () => {
  const { gate } = newGate();
  const results = await Promise.all(Array.from({ length: 100 }, () => gate.reserve(req())));
  const ok = results.filter((r) => r.ok).length;
  assert.equal(ok, 22);
  const snap = await gate.snapshot(NOW);
  assert.equal(snap.providerMicro.anthropic, 22_000_000);
  assert.ok(snap.totalMicro <= 42_000_000);
});

test('concorrência mista: nunca passa de 42 fora da reserva, nem a verba de cada provedor', async () => {
  const { gate } = newGate();
  const jobs = [
    ...Array.from({ length: 60 }, () => gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra' }))),
    ...Array.from({ length: 60 }, () => gate.reserve(req())),
  ];
  const results = await Promise.all(jobs);
  assert.equal(results.filter((r) => r.ok).length, 42);
  const snap = await gate.snapshot(NOW);
  assert.equal(snap.providerMicro.openai, 20_000_000);
  assert.equal(snap.providerMicro.anthropic, 22_000_000);
  assert.equal(snap.reserveMicro, 0);
});

test('degrau de premium: o limite de 35 é inclusivo e nada passa dele', async () => {
  const { gate } = newGate();
  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }));
  await gate.reserve(req({ amountUsd: 14 }));
  const ok = await gate.reserve(req({ taskClass: 'premium', amountUsd: 1, model: 'anthropic/claude-opus-5.5' }));
  assert.equal(ok.ok, true, 'exatamente 35 deve passar');
  const over = await gate.reserve(req({ taskClass: 'premium', amountUsd: 0.01, model: 'anthropic/claude-opus-5.5' }));
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, 'step_ceiling');
});

test('degrau de não essencial (40) e de essencial (42): cada classe para no seu degrau', async () => {
  const { gate } = newGate();
  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }));
  await gate.reserve(req({ amountUsd: 20 }));
  const ne = await gate.reserve(req({ taskClass: 'non_essential', amountUsd: 1, taskId: 'entity_resolution' }));
  assert.equal(ne.ok, false);
  if (!ne.ok) assert.equal(ne.reason, 'step_ceiling');

  const e1 = await gate.reserve(req({ amountUsd: 1 }));
  assert.equal(e1.ok, true, 'essencial ainda passa entre 40 e 42');
  const e2 = await gate.reserve(req({ amountUsd: 1 }));
  assert.equal(e2.ok, true, 'essencial chega a 42 com a verba da Anthropic');
  const e3 = await gate.reserve(req({ amountUsd: 0.5 }));
  assert.equal(e3.ok, false);
  if (!e3.ok) assert.equal(e3.reason, 'provider_allocation_exhausted');
});

test('reserva de 8 é exclusiva: essencial não entra nela; auditoria entra até 8 e depois para', async () => {
  const { gate } = newGate();
  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }));
  await gate.reserve(req({ amountUsd: 22 }));
  const audit = await gate.reserve(req({ taskId: AUDIT, taskClass: 'reserve', amountUsd: 1, model: 'anthropic/claude-sonnet-5.5' }));
  assert.equal(audit.ok, true, 'auditoria passa acima de 42');
  const snap = await gate.snapshot(NOW);
  assert.equal(snap.reserveMicro, 1_000_000);
  assert.equal(snap.allocationMicro, 42_000_000);

  const essentialAfter = await gate.reserve(req({ amountUsd: 0.01 }));
  assert.equal(essentialAfter.ok, false, 'essencial não usa a reserva');

  const more = await Promise.all(Array.from({ length: 10 }, () => gate.reserve(req({ taskId: AUDIT, taskClass: 'reserve', amountUsd: 1 }))));
  assert.equal(more.filter((r) => r.ok).length, 7, 'só restam 7 da reserva de 8 após a primeira');
  const refused = more.find((r) => !r.ok);
  assert.ok(refused && !refused.ok && refused.reason === 'reserve_pool_exhausted');
  const final = await gate.snapshot(NOW);
  assert.equal(final.totalMicro, 50_000_000, 'total fecha em 50, nunca passa');
});

test('tarefa que não é de auditoria não usa a reserva, mesmo com classe reserva', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ taskId: 'editorial_draft', taskClass: 'reserve', amountUsd: 1 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'reserve_task_not_eligible');
});

test('sublimite de escalonamento (Opus/Fable) é de US$ 5 dentro da verba da Anthropic', async () => {
  const { gate } = newGate();
  const esc = (amountUsd: number) =>
    gate.reserve(req({ taskClass: 'premium', escalation: true, amountUsd, model: 'anthropic/claude-opus-5.5' }));
  assert.equal((await esc(5)).ok, true);
  const over = await esc(0.01);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, 'escalation_sublimit');
});

test('verba zero: DeepSeek e imagem não recebem chamada, nem na reserva', async () => {
  const { gate, store } = newGate();
  const ds = await gate.reserve(req({ provider: 'deepseek', model: 'deepseek/deepseek-v4-pro' }));
  assert.equal(ds.ok, false);
  if (!ds.ok) assert.equal(ds.reason, 'zero_allocation');
  const dsAudit = await gate.reserve(req({ provider: 'deepseek', taskId: AUDIT, taskClass: 'reserve' }));
  assert.equal(dsAudit.ok, false);
  const img = await gate.reserve(req({ lane: 'image', provider: 'openai', model: 'openai/gpt-image' }));
  assert.equal(img.ok, false);
  if (!img.ok) assert.equal(img.reason, 'image_allocation_zero');
  assert.equal((await store.readAll()).length, 0, 'nenhuma reserva foi gravada');
});

test('custo desconhecido bloqueia (block_unknown_cost)', async () => {
  const { gate } = newGate();
  for (const amountUsd of [null, Number.NaN, -1]) {
    const r = await gate.reserve(req({ amountUsd }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'unknown_cost');
  }
});

test('conciliação: custo real menor libera a diferença; custo maior é sinalizado', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ amountUsd: 2 }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const c = await gate.commit(r.reservationId, 1.5, NOW);
  assert.equal(c.ok, true);
  assert.equal(c.overrun, false);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 1_500_000);

  const r2 = await gate.reserve(req({ amountUsd: 1 }));
  if (!r2.ok) throw new Error('reserva inesperadamente recusada');
  const over = await gate.commit(r2.reservationId, 1.2, NOW);
  assert.equal(over.overrun, true, 'real acima da reserva é sinalizado');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 2_700_000, 'o real conta, mesmo acima da reserva');
});

test('reserva só se fecha uma vez; liberada não conta mais', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ amountUsd: 22 }));
  if (!r.ok) throw new Error('reserva inesperadamente recusada');
  assert.equal((await gate.release(r.reservationId, 'erro de chamada', NOW)).ok, true);
  assert.equal((await gate.release(r.reservationId, 'de novo', NOW)).ok, false);
  assert.equal((await gate.commit(r.reservationId, 1, NOW)).ok, false);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 0);
  assert.equal((await gate.reserve(req({ amountUsd: 22 }))).ok, true, 'a verba voltou após a liberação');
});

test('virada do mês: o mês de Brasília zera uma vez; reserva de novembro conciliada depois conta em novembro', async () => {
  const { gate } = newGate();
  const lastNov = new Date('2026-11-30T23:59:59-03:00');
  const firstDec = new Date('2026-12-01T00:00:00-03:00');

  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20, at: lastNov }));
  const nov = await gate.reserve(req({ amountUsd: 22, at: lastNov }));
  assert.equal(nov.ok, true);
  assert.equal((await gate.snapshot(lastNov)).totalMicro, 42_000_000);

  const decA = await gate.snapshot(firstDec);
  const decB = await gate.snapshot(firstDec);
  assert.equal(decA.monthKey, '2026-12');
  assert.equal(decA.totalMicro, 0, 'dezembro começa do zero');
  assert.deepEqual(decA, decB, 'consultar de novo não zera nem soma outra vez');

  assert.equal((await gate.reserve(req({ amountUsd: 22, at: firstDec }))).ok, true);

  if (nov.ok) {
    assert.equal((await gate.commit(nov.reservationId, 21, new Date('2026-12-02T10:00:00-03:00'))).ok, true);
  }
  const novAfter = await gate.snapshot(lastNov);
  assert.equal(novAfter.totalMicro, 41_000_000, 'conciliação tardia altera novembro, não dezembro');
  assert.equal((await gate.snapshot(firstDec)).totalMicro, 22_000_000);
});

test('taxa de compra de crédito fica fora do teto', async () => {
  const { gate } = newGate();
  await gate.recordRefillFee(10, NOW);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 0);
  assert.equal((await gate.reserve(req({ amountUsd: 22 }))).ok, true);
});

test('pendente: só reserva aberta vira pendente; liberação simples não sai de pendente', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ amountUsd: 2 }));
  if (!r.ok) throw new Error('reserva inesperadamente recusada');
  assert.equal((await gate.markPending(r.reservationId, 'timeout', NOW)).ok, true);
  assert.equal((await gate.markPending(r.reservationId, 'de novo', NOW)).ok, false, 'já pendente');
  const plain = await gate.release(r.reservationId, 'tentativa', NOW);
  assert.equal(plain.ok, false, 'release simples não libera pendente');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 2_000_000, 'pendente continua contando');
  assert.equal((await gate.snapshot(NOW)).pendingReservations, 1);
});

test('pendente: conciliação por custo real fecha; liberação conciliada exige pendente e evidência', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ amountUsd: 2 }));
  if (!r.ok) throw new Error('reserva inesperadamente recusada');
  await gate.markPending(r.reservationId, 'timeout', NOW);
  assert.equal((await gate.releaseConciliated(r.reservationId, 'evidência', NOW)).ok, true);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 0);
  assert.equal((await gate.releaseConciliated(r.reservationId, 'de novo', NOW)).ok, false);

  const r2 = await gate.reserve(req({ amountUsd: 1 }));
  if (!r2.ok) throw new Error('reserva inesperadamente recusada');
  await gate.markPending(r2.reservationId, 'timeout', NOW);
  assert.equal((await gate.commit(r2.reservationId, 0.4, NOW)).ok, true, 'commit aceita pendente');
  assert.equal((await gate.snapshot(NOW)).totalMicro, 400_000);
});

test('pendente: a liberação conciliada não aceita reserva aberta', async () => {
  const { gate } = newGate();
  const r = await gate.reserve(req({ amountUsd: 1 }));
  if (!r.ok) throw new Error('reserva inesperadamente recusada');
  assert.equal((await gate.releaseConciliated(r.reservationId, 'evidência', NOW)).ok, false);
});

// DP-02 v5: auditoria usa a verba do provedor até 42; só acima de 42 cai na reserva de 8.
test('auditoria abaixo de 42 usa a verba do provedor; acima de 42 usa a reserva', async () => {
  const { gate } = newGate();
  const low = await gate.reserve(req({ taskId: 'wf08_correction', taskClass: 'reserve', amountUsd: 3 }));
  assert.equal(low.ok, true);
  let snap = await gate.snapshot(NOW);
  assert.equal(snap.allocationMicro, 3_000_000, 'abaixo de 42 é verba do provedor');
  assert.equal(snap.reserveMicro, 0);

  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }));
  await gate.reserve(req({ amountUsd: 19 })); // total de verba chega a 42
  const high = await gate.reserve(req({ taskId: 'wf08_correction', taskClass: 'reserve', amountUsd: 1 }));
  assert.equal(high.ok, true);
  snap = await gate.snapshot(NOW);
  assert.equal(snap.reserveMicro, 1_000_000, 'acima de 42 entra na reserva');
  assert.equal(snap.totalMicro, 43_000_000);
});

test('tarefa de auditoria nunca passa de 50 nem da reserva de 8', async () => {
  const { gate } = newGate();
  await gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }));
  await gate.reserve(req({ amountUsd: 22 }));
  const results = await Promise.all(
    Array.from({ length: 10 }, () => gate.reserve(req({ taskId: 'postpublication_audit', taskClass: 'reserve', amountUsd: 1 }))),
  );
  assert.equal(results.filter((r) => r.ok).length, 8);
  assert.equal((await gate.snapshot(NOW)).totalMicro, 50_000_000);
});
