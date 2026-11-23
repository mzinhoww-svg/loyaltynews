import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@ln/db/testing';
import { PostgresLedgerStore, type SqlDatabase } from './budget-pg';
import { BudgetGate, gateConfigFromPolicy, type ReserveInput } from './budget';
import { loadPolicyFile } from './policy';
import type { ModelPolicy } from './types';

// L5 e L4b do G4 (AgentOps, PostgreSQL real): custo real negativo e reserva sem classe/bolsa/faixa não podem ser gravados.
const policy = loadPolicyFile(fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;
const cfg = gateConfigFromPolicy(policy);
const NOW = new Date('2026-11-23T12:00:00-03:00');
const req = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', route: 'economy', provider: 'anthropic', model: 'anthropic/claude-sonnet-5.5', escalation: false, amountUsd: 1, at: NOW, ...over,
});

async function setup() {
  const t = await createTestDb();
  const store = new PostgresLedgerStore(t.db as unknown as SqlDatabase);
  return { ...t, store, gate: new BudgetGate(cfg, store) };
}

describe('custo real nunca negativo (L5)', () => {
  it('o portão recusa custo real negativo, infinito ou não numérico; a reserva continua aberta e nada é gravado', async () => {
    const { close, gate, db } = await setup();
    try {
      const r = await gate.reserve(req());
      if (!r.ok) throw new Error('reserva recusada');
      for (const bad of [-5, -0.000001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const c = await gate.commit(r.reservationId, bad, NOW, 'gen-x');
        expect(c.ok, String(bad)).toBe(false);
        expect(c.detail).toMatch(/inválido/);
      }
      expect((await gate.statusOf(r.reservationId))?.status).toBe('open');
      const rows = (await db.execute(sql`SELECT count(*)::int AS n FROM budget_ledger WHERE kind = 'conciliacao'`)) as unknown as { rows: { n: number }[] };
      expect(rows.rows[0]!.n).toBe(0);
      expect((await gate.commit(r.reservationId, 0.4, NOW, 'gen-ok')).ok).toBe(true); // o custo válido segue funcionando
      expect((await gate.snapshot(NOW)).totalMicro).toBe(400_000);
    } finally {
      await close();
    }
  });

  it('o banco recusa custo real negativo mesmo por SQL direto, e a loja não grava commit negativo', async () => {
    const { close, gate, db, store } = await setup();
    try {
      const r = await gate.reserve(req());
      if (!r.ok) throw new Error('reserva recusada');
      await expect(db.execute(sql`UPDATE budget_reservations SET actual_microusd = -5 WHERE id = ${r.reservationId}`)).rejects.toThrow();
      await expect(store.append({ seq: 99, at: NOW.toISOString(), monthKey: '2026-11', type: 'commit', reservationId: r.reservationId, actualMicro: -5, overrun: false })).rejects.toThrow();
      expect((await gate.statusOf(r.reservationId))?.status).toBe('open');
    } finally {
      await close();
    }
  });
});

describe('sem padrões silenciosos na reserva (L4b)', () => {
  it('reserva sem tarefa, classe, bolsa, faixa, provedor, modelo ou escalonamento não é gravada (nada vira essential em silêncio)', async () => {
    const { close, store, db } = await setup();
    try {
      const full = { seq: 1, at: NOW.toISOString(), monthKey: '2026-11', type: 'reserve' as const, reservationId: 'r-1', taskId: 't', taskClass: 'essential' as const, pool: 'allocation' as const, lane: 'text' as const, provider: 'anthropic', model: 'm', escalation: false, amountMicro: 1_000_000 };
      for (const falta of ['taskId', 'taskClass', 'pool', 'lane', 'provider', 'model', 'escalation'] as const) {
        const e = { ...full, [falta]: undefined };
        await expect(store.append(e as never), falta).rejects.toThrow(/obrigatório/);
      }
      await expect(store.append({ ...full, amountMicro: -1 })).rejects.toThrow();
      await expect(store.append({ ...full, amountMicro: 1.5 })).rejects.toThrow();
      const rows = (await db.execute(sql`SELECT count(*)::int AS n FROM budget_reservations`)) as unknown as { rows: { n: number }[] };
      expect(rows.rows[0]!.n).toBe(0);
      await store.append(full); // completa passa
    } finally {
      await close();
    }
  });
});
