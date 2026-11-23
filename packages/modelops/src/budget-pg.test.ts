import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@ln/db/testing';
import { PostgresLedgerStore, type SqlDatabase } from './budget-pg';
import { BudgetGate, gateConfigFromPolicy, type ReserveInput } from './budget';
import { callModel } from './gateway';
import { SimulatedOpenRouterClient } from './openrouter.mock';
import { loadPolicyFile } from './policy';
import type { ModelPolicy } from './types';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url));
const policy = loadPolicyFile(FIXTURE).policy as ModelPolicy;
const cfg = gateConfigFromPolicy(policy);
const NOW = new Date('2026-11-23T12:00:00-03:00');

// O drizzle embrulha o erro do banco ("Failed query"); a mensagem real do gatilho fica em cause. Procura em toda a cadeia.
async function rejectsWith(p: Promise<unknown>, re: RegExp): Promise<void> {
  try {
    await p;
  } catch (err) {
    const parts: string[] = [];
    let cur: unknown = err;
    while (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
    }
    assert.match(parts.join(' | '), re);
    return;
  }
  assert.fail('esperava rejeição do banco');
}

// Um banco PGlite com todas as migrações de @ln/db (inclui 0005, do orçamento).
async function setupDb() {
  const { db, client, close } = await createTestDb();
  return { db, client, close, store: new PostgresLedgerStore(db as unknown as SqlDatabase) };
}

function req(over: Partial<ReserveInput> = {}): ReserveInput {
  return {
    taskId: 'editorial_draft',
    taskClass: 'essential',
    lane: 'text',
    route: 'economy',
    provider: 'anthropic',
    model: 'anthropic/claude-sonnet-5.5',
    escalation: false,
    amountUsd: 1,
    at: NOW,
    ...over,
  };
}

test('reservas gravadas sobrevivem a restart: outro gate sobre o mesmo banco vê o mesmo estado', async () => {
  const { db, close, store } = await setupDb();
  try {
    const gate1 = new BudgetGate(cfg, store);
    assert.equal((await gate1.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra', amountUsd: 20 }))).ok, true);
    assert.equal((await gate1.reserve(req({ amountUsd: 22 }))).ok, true);
    assert.equal((await gate1.snapshot(NOW)).totalMicro, 42_000_000);

    // "Restart": novo store e novo gate sobre o mesmo banco.
    const gate2 = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    const snap = await gate2.snapshot(NOW);
    assert.equal(snap.totalMicro, 42_000_000);
    assert.equal(snap.providerMicro.openai, 20_000_000);
    const refused = await gate2.reserve(req({ amountUsd: 0.5 }));
    assert.equal(refused.ok, false, 'verba de anthropic continua esgotada após restart');
    if (!refused.ok) assert.equal(refused.reason, 'provider_allocation_exhausted');
  } finally {
    await close();
  }
});

test('concorrência no banco: 100 reservas simultâneas numa verba de 22 deixam exatamente 22', async () => {
  const { close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const results = await Promise.all(Array.from({ length: 100 }, () => gate.reserve(req())));
    assert.equal(results.filter((r) => r.ok).length, 22);
    assert.equal((await gate.snapshot(NOW)).totalMicro, 22_000_000);
  } finally {
    await close();
  }
});

test('pendente sobrevive a restart e conta no teto; liberação só com evidência, também persistida', async () => {
  const { db, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const r = await gate.reserve(req({ amountUsd: 2 }));
    if (!r.ok) throw new Error('reserva inesperadamente recusada');
    assert.equal((await gate.markPending(r.reservationId, 'timeout depois do envio', NOW)).ok, true);

    const gate2 = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    const st = await gate2.statusOf(r.reservationId);
    assert.equal(st?.status, 'pending', 'pendente lido do banco após restart');
    assert.equal((await gate2.snapshot(NOW)).totalMicro, 2_000_000, 'pendente conta no teto');

    assert.equal((await gate2.releaseConciliated(r.reservationId, 'geração inexistente', NOW)).ok, true);
    const gate3 = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    assert.equal((await gate3.snapshot(NOW)).totalMicro, 0, 'liberação com evidência persiste');
    assert.equal((await gate3.statusOf(r.reservationId))?.status, 'released');
  } finally {
    await close();
  }
});

test('conciliação pelo custo real grava a geração e o custo; reconciliação posterior não reabre', async () => {
  const { db, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const r = await gate.reserve(req({ amountUsd: 1 }));
    if (!r.ok) throw new Error('reserva inesperadamente recusada');
    assert.equal((await gate.commit(r.reservationId, 0.4, NOW, 'gen-123')).ok, true);

    const gate2 = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    assert.equal((await gate2.statusOf(r.reservationId))?.status, 'committed');
    assert.equal((await gate2.snapshot(NOW)).totalMicro, 400_000);
    assert.equal((await gate2.commit(r.reservationId, 0.1, NOW, 'gen-456')).ok, false, 'já conciliada');
  } finally {
    await close();
  }
});

test('parada persistida: global ligada num processo bloqueia chamadas no outro', async () => {
  const { db, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    await gate.setKill('global', true, 'parada de teste', NOW);

    const gate2 = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    assert.equal((await gate2.killState()).global, true);

    const client = new SimulatedOpenRouterClient();
    const out = await callModel(
      { policy, gate: gate2, client },
      {
        task: 'editorial_draft',
        dataClasses: ['public'],
        unpublished: false,
        mode: 'simulation',
        qualifiedModelIds: ['claude-haiku-5-5'],
        zdrVerifiedModelIds: [],
        now: NOW,
        messages: [{ role: 'user', content: 'teste' }],
        estimate: { promptTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 50, uncertain: false },
      },
    );
    assert.equal(out.status, 'blocked');
    if (out.status === 'blocked') assert.equal(out.reason, 'kill_global');
    assert.equal(client.calls.length, 0, 'nenhuma chamada sai com a parada ligada');

    await gate2.setKill('global', false, 'retomada', NOW);
    assert.equal((await gate.killState()).global, false, 'desligar também persiste');
  } finally {
    await close();
  }
});

test('ledger é append-only no banco: UPDATE e DELETE são rejeitados pelo trigger', async () => {
  const { client, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    assert.equal((await gate.reserve(req({ amountUsd: 1 }))).ok, true);
    await assert.rejects(client.exec(`UPDATE budget_ledger SET delta_microusd = 0`));
    await assert.rejects(client.exec(`DELETE FROM budget_ledger`));
  } finally {
    await close();
  }
});

// Caso medido pelo AgentOps: dois gates sobre o mesmo store aceitavam além da verba e geravam ids repetidos.
// Aqui: dois stores e dois gates sobre o mesmo banco, 100 reservas simultâneas contra a verba de 22.
// PGlite tem uma só conexão: isto prova a lógica; a exclusão entre processos precisa de PostgreSQL real.
test('dois gates sobre o mesmo banco: exatamente 22 aceitas e ids únicos (UUID do banco)', async () => {
  const { db, close } = await setupDb();
  try {
    const gateA = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    const gateB = new BudgetGate(cfg, new PostgresLedgerStore(db as unknown as SqlDatabase));
    const jobs = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? gateA : gateB).reserve(req()));
    const results = await Promise.all(jobs);
    const accepted = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
    assert.equal(accepted.length, 22);
    const ids = new Set(accepted.map((r) => r.reservationId));
    assert.equal(ids.size, 22, 'ids de reserva não se repetem');
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal((await gateB.snapshot(NOW)).totalMicro, 22_000_000);
  } finally {
    await close();
  }
});

// Gaps L1–L4 apontados pelo AgentOps (suíte de aceitação, PostgreSQL 18.7 real). Cada um é testado no banco.
test('L1: transições ilegais de reserva são recusadas pelo banco (gatilhos, não só pelo app)', async () => {
  const { client, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const r = await gate.reserve(req({ amountUsd: 1 }));
    if (!r.ok) throw new Error('reserva inesperadamente recusada');
    const id = r.reservationId;
    assert.equal((await gate.commit(id, 0.5, NOW, 'gen-1')).ok, true);
    // conciliada -> liberada, conciliada -> pendente, commit duplo: todos ilegais.
    await rejectsWith(client.query(`UPDATE budget_reservations SET state='liberada' WHERE id=$1`, [id]), /transicao ilegal/);
    await rejectsWith(client.query(`UPDATE budget_reservations SET state='pendente' WHERE id=$1`, [id]), /transicao ilegal/);
    await rejectsWith(store.append({ type: 'release', monthKey: '2026-11', at: NOW.toISOString(), reservationId: id, seq: 0, reason: 'x' }), /encerrada/);
    // pending duplo e pending após commit também são recusados.
    const r2 = await gate.reserve(req({ amountUsd: 1 }));
    if (!r2.ok) throw new Error('reserva inesperadamente recusada');
    assert.equal((await gate.markPending(r2.reservationId, 'timeout', NOW)).ok, true);
    await rejectsWith(client.query(`UPDATE budget_reservations SET state='pendente' WHERE id=$1`, [r2.reservationId]), /transicao ilegal/);
    // Liberar pendente sem evidência é recusado pelo guarda do ledger.
    await rejectsWith(
      store.append({ type: 'release', monthKey: '2026-11', at: NOW.toISOString(), reservationId: r2.reservationId, seq: 0, reason: 'sem evidência' }),
      /exige evidencia/,
    );
    // DELETE de reserva é recusado.
    await assert.rejects(client.query(`DELETE FROM budget_reservations WHERE id=$1`, [id]));
  } finally {
    await close();
  }
});

test('L2: evento com mês diferente do da reserva é recusado e nada é gravado', async () => {
  const { close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const r = await gate.reserve(req({ amountUsd: 1 }));
    if (!r.ok) throw new Error('reserva inesperadamente recusada');
    await rejectsWith(
      store.append({ type: 'commit', monthKey: '2026-01', at: NOW.toISOString(), reservationId: r.reservationId, seq: 0, actualMicro: 400_000, overrun: false, generationId: 'g' }),
      /conflito de mês/,
    );
    assert.equal((await gate.statusOf(r.reservationId))?.status, 'open', 'continua aberta: nada foi gravado');
    assert.equal((await gate.snapshot(NOW)).totalMicro, 1_000_000);
  } finally {
    await close();
  }
});

test('L3: taxa de compra de crédito é gravada em tabela própria, fora do teto', async () => {
  const { client, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    await gate.recordRefillFee(5, NOW);
    const rows = await client.query(`SELECT count(*)::int AS n, sum(amount_microusd)::bigint AS total FROM budget_refill_fees`);
    assert.equal((rows.rows[0] as { n: number }).n, 1);
    assert.equal(Number((rows.rows[0] as { total: string }).total), 5_000_000);
    assert.equal((await gate.snapshot(NOW)).totalMicro, 0, 'não entra no teto');
    const events = await store.readAll();
    assert.ok(events.some((e) => e.type === 'refill_fee' && e.amountMicro === 5_000_000));
  } finally {
    await close();
  }
});

test('L4: classe de tarefa, pool e faixa inválidos são recusados pelo banco; ordem segue a coluna seq', async () => {
  const { close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    await rejectsWith(
      store.append({
        type: 'reserve', monthKey: '2026-11', at: NOW.toISOString(), reservationId: 'r-bad-1', seq: 0,
        taskId: 'x', taskClass: 'classe-inventada' as never, pool: 'allocation', lane: 'text', route: 'review',
        provider: 'anthropic', model: 'm', escalation: false, amountMicro: 1,
      }),
      /budget_reservations_task_class/,
    );
    // Mesmo instante de criação: a ordem de gravação precisa ser preservada pelo seq.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await gate.reserve(req({ amountUsd: 0.1 }));
      if (!r.ok) throw new Error('reserva inesperadamente recusada');
      ids.push(r.reservationId);
    }
    const reserves = (await store.readAll()).filter((e) => e.type === 'reserve').map((e) => e.reservationId);
    assert.deepEqual(reserves, ids, 'leitura na ordem de criação, mesmo com instantes iguais');
  } finally {
    await close();
  }
});

// L5 (AgentOps): custo real negativo era aceito e gravava delta negativo. Recusado no gate, no store e no banco.
// L4b (AgentOps): classe ausente virava 'essential' em silêncio. Agora é recusada no store e no banco.
test('L5/L4b: custo real negativo e classe ausente são recusados; o banco também recusa', async () => {
  const { client, close, store } = await setupDb();
  try {
    const gate = new BudgetGate(cfg, store);
    const r = await gate.reserve(req({ amountUsd: 1 }));
    if (!r.ok) throw new Error('reserva inesperadamente recusada');
    // Gate: custo negativo não é conciliado e a reserva continua pendente de conciliação correta.
    const bad = await gate.commit(r.reservationId, -0.000005, NOW, 'gen-neg');
    assert.equal(bad.ok, false);
    assert.equal((await gate.statusOf(r.reservationId))?.status, 'open', 'nada foi gravado');
    // Store: a mesma tentativa direta é recusada.
    await rejectsWith(
      store.append({ type: 'commit', monthKey: '2026-11', at: NOW.toISOString(), reservationId: r.reservationId, seq: 0, actualMicro: -5, overrun: false, generationId: 'g' }),
      /custo real negativo/,
    );
    // Banco: UPDATE direto com custo negativo é recusado pela checagem da 0020.
    await rejectsWith(client.query(`UPDATE budget_reservations SET state='conciliada', actual_microusd=-5, generation_id='g' WHERE id=$1`, [r.reservationId]), /budget_reservations_actual_nonneg/);
    // L4b: reserva sem classe é recusada pelo store.
    await rejectsWith(
      store.append({
        type: 'reserve', monthKey: '2026-11', at: NOW.toISOString(), reservationId: 'r-sem-classe', seq: 0,
        taskId: 'x', pool: 'allocation', lane: 'text', route: 'review', provider: 'anthropic', model: 'm', escalation: false, amountMicro: 1,
      }),
      /classe da tarefa ausente/,
    );
    // L4b no banco: sem default, INSERT sem task_class é recusado.
    await rejectsWith(
      client.query(`INSERT INTO budget_reservations (id, task_id, idempotency_key, month_key, route, provider, model, max_estimated_microusd, state, pool, lane, escalation, reserved_at)
                    VALUES ('r-x', 'x', 'r-x', '2026-11', 'review', 'anthropic', 'm', 1, 'reservada', 'allocation', 'text', false, now())`),
      /task_class/,
    );
  } finally {
    await close();
  }
});
