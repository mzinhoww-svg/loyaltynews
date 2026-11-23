import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@ln/db/testing';
import { BudgetGate, gateConfigFromPolicy } from './budget';
import { PostgresLedgerStore, type SqlDatabase } from './budget-pg';
import { buildModelGateway } from './compose';
import { callModel, reconcilePending, type GatewayCall } from './gateway';
import { MemoryLedgerStore } from './ledger';
import { SimulatedOpenRouterClient } from './openrouter.mock';
import { validatePolicy } from './policy';
import { createOpenRouterGenerationReader, describeReconciliation, generationProbe, reconcileMonth, type GenerationReader } from './reconcile';
import type { ModelPolicy } from './types';

// G4.2 (conciliação com /generation, replay mensal ≤ 1%) e G4.3 (composição do gateway: real exige portão de saldo).
const V7 = fileURLToPath(new URL('../../contracts/fixtures/model.policy.dp02-v7.json', import.meta.url));
const NOW = new Date('2026-11-23T12:00:00-03:00');
const MONTH = '2026-11';

function policy(mutate: (p: any) => void = () => undefined): ModelPolicy { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = JSON.parse(readFileSync(V7, 'utf8'));
  p.qualification.mode.enabled = true;
  mutate(p);
  const c = validatePolicy(p);
  if (!c.policy) throw new Error(c.errors.join('; '));
  return c.policy;
}

/** Cria N reservas conciliadas com custos e ids de geração dados. */
async function seed(gate: BudgetGate, rows: { cost: number; gen?: string }[]) {
  const ids: string[] = [];
  for (const r of rows) {
    const rs = await gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 1, at: NOW });
    if (!rs.ok) throw new Error(rs.detail);
    await gate.commit(rs.reservationId, r.cost, NOW, r.gen);
    ids.push(rs.reservationId);
  }
  return ids;
}
const fixed = (table: Record<string, number | null | 'erro'>): GenerationReader => async (id) => {
  const v = table[id];
  if (v === 'erro') throw new Error('rede');
  if (v === undefined || v === null) return null;
  return { id, costUsd: v };
};
const newGate = (p = policy(), store: MemoryLedgerStore | PostgresLedgerStore = new MemoryLedgerStore()) => new BudgetGate(gateConfigFromPolicy(p), store);

describe('G4.2: replay mensal contra /generation', () => {
  it('ledger igual ao provedor: o mês FECHA (divergência 0)', async () => {
    const gate = newGate();
    await seed(gate, [{ cost: 0.1, gen: 'g1' }, { cost: 0.25, gen: 'g2' }]);
    const r = await reconcileMonth(gate, fixed({ g1: 0.1, g2: 0.25 }), MONTH);
    expect(r).toMatchObject({ closed: true, committed: 2, verified: 2, divergencePct: 0, unverified: [], mismatches: [] });
    expect(describeReconciliation(r)).toContain('FECHADO');
  });

  it('divergência de até 1% no total e por item fecha; acima de 1% NÃO fecha', async () => {
    const dentro = newGate();
    await seed(dentro, [{ cost: 1.0, gen: 'g1' }]);
    expect((await reconcileMonth(dentro, fixed({ g1: 1.009 }), MONTH)).closed).toBe(true); // ~0,9%
    const fora = newGate();
    await seed(fora, [{ cost: 1.0, gen: 'g1' }]);
    const r = await reconcileMonth(fora, fixed({ g1: 1.02 }), MONTH); // ~2%
    expect(r.closed).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.divergencePct).toBeGreaterThan(1);
  });

  it('um item muito fora não é escondido pela média: soma dentro de 1%, item fora ⇒ não fecha', async () => {
    const gate = newGate();
    await seed(gate, [{ cost: 10, gen: 'g1' }, { cost: 0.5, gen: 'g2' }]);
    const r = await reconcileMonth(gate, fixed({ g1: 10, g2: 0.55 }), MONTH); // total 10,5 × 10,55 = 0,47%; g2 é 10% acima
    expect(r.divergencePct).toBeLessThan(1);
    expect(r.mismatches.map((m) => m.generationId)).toEqual(['g2']);
    expect(r.closed).toBe(false);
  });

  it('falha fechada: sem id de geração, geração desconhecida ou leitura com erro = sem prova = o mês não fecha', async () => {
    const gate = newGate();
    await seed(gate, [{ cost: 0.1 }, { cost: 0.1, gen: 'g2' }, { cost: 0.1, gen: 'g3' }, { cost: 0.1, gen: 'g4' }]);
    const r = await reconcileMonth(gate, fixed({ g2: null, g3: 'erro', g4: 0.1 }), MONTH);
    expect(r.closed).toBe(false);
    expect(r.verified).toBe(1);
    expect(r.unverified.map((u) => u.reason)).toEqual([
      expect.stringContaining('sem id de geração'),
      expect.stringContaining('não conhece'),
      expect.stringContaining('leitura falhou'),
    ]);
  });

  it('o provedor cobrou algo e o ledger registrou 0 (ou o contrário) não fecha', async () => {
    const gate = newGate();
    await seed(gate, [{ cost: 0, gen: 'g1' }]);
    expect((await reconcileMonth(gate, fixed({ g1: 0.2 }), MONTH)).closed).toBe(false);
  });

  it('só olha o mês pedido e só reservas conciliadas (abertas e pendentes não entram)', async () => {
    const gate = newGate();
    await seed(gate, [{ cost: 0.1, gen: 'g1' }]);
    await gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 1, at: NOW }); // aberta
    expect((await reconcileMonth(gate, fixed({ g1: 0.1 }), MONTH)).committed).toBe(1);
    expect((await reconcileMonth(gate, fixed({ g1: 0.1 }), '2026-10')).committed).toBe(0);
  });

  it('funciona sobre o PostgreSQL (o id da geração volta do banco; "sem-id" do banco conta como sem prova)', async () => {
    const t = await createTestDb();
    try {
      const gate = newGate(policy(), new PostgresLedgerStore(t.db as unknown as SqlDatabase));
      await seed(gate, [{ cost: 0.2, gen: 'gp1' }, { cost: 0.2 }]);
      const r = await reconcileMonth(gate, fixed({ gp1: 0.2 }), MONTH);
      expect(r).toMatchObject({ committed: 2, verified: 1, closed: false });
      expect(r.unverified).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it('leitor real de /generation: URL e cabeçalho certos, 404 = desconhecida, formato inesperado e HTTP 500 lançam', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const mk = (status: number, body: unknown) =>
      createOpenRouterGenerationReader('sk-teste', (async (url: string, init: RequestInit) => {
        seen.push({ url, auth: new Headers(init.headers).get('authorization') });
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch);
    expect(await mk(200, { data: { id: 'gen-1', total_cost: 0.0123, model: 'anthropic/x' } })('gen 1/x')).toEqual({ id: 'gen-1', costUsd: 0.0123, model: 'anthropic/x' });
    expect(seen[0]).toEqual({ url: 'https://openrouter.ai/api/v1/generation?id=gen%201%2Fx', auth: 'Bearer sk-teste' });
    expect(await mk(404, {})('x')).toBeNull();
    await expect(mk(200, { data: { total_cost: 'caro' } })('x')).rejects.toThrow(/formato inesperado/);
    await expect(mk(200, { data: { total_cost: -1 } })('x')).rejects.toThrow(/formato inesperado/);
    await expect(mk(500, {})('x')).rejects.toThrow(/HTTP 500/);
    await expect(mk(500, {})('x')).rejects.not.toThrow(/sk-teste/);
  });

  it('sonda para reconcilePending: geração encontrada concilia pelo custo do provedor; desconhecida ou erro continua pendente (nunca libera)', async () => {
    const gate = newGate();
    const deps = { policy: policy(), gate, client: new SimulatedOpenRouterClient() };
    const mkPending = async () => {
      const rs = await gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 1, at: NOW });
      if (!rs.ok) throw new Error('reserva');
      await gate.markPending(rs.reservationId, 'timeout', NOW);
      return rs.reservationId;
    };
    const a = await mkPending();
    expect(await reconcilePending(deps, a, generationProbe(fixed({ g1: 0.3 }), 'g1'), NOW)).toBe('committed');
    expect((await gate.statusOf(a))).toMatchObject({ status: 'committed', actualMicro: 300_000, generationId: 'g1' });
    const b = await mkPending();
    expect(await reconcilePending(deps, b, generationProbe(fixed({}), 'g2'), NOW)).toBe('still_pending');
    const c = await mkPending();
    expect(await reconcilePending(deps, c, generationProbe(fixed({ g3: 'erro' }), 'g3'), NOW)).toBe('still_pending');
    expect((await gate.statusOf(b))!.status).toBe('pending');
  });
});

describe('G4.3: composição do gateway (real exige portão de saldo)', () => {
  const NOKEY = {};
  const call = (over: Partial<GatewayCall> = {}): GatewayCall => ({
    task: 'model_qualification', dataClasses: ['public'], unpublished: false, mode: 'qualification', candidate: 'claude-haiku-5-5', stage: '1',
    qualifiedModelIds: [], zdrVerifiedModelIds: [], now: NOW, messages: [{ role: 'user', content: 'caso' }],
    estimate: { promptTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false }, ...over,
  });

  it('sem banco nem ledger: erro explícito (não existe gateway sem o ledger PostgreSQL)', () => {
    expect(() => buildModelGateway(NOKEY, { policy: policy() })).toThrow(/sem ledger/);
  });

  it('padrão: cliente simulado, sem rede e sem portão de saldo; nada de chave ⇒ sem leitor de geração', () => {
    const g = buildModelGateway(NOKEY, { policy: policy(), ledgerStore: new MemoryLedgerStore(), fetchImpl: (() => { throw new Error('rede proibida'); }) as unknown as typeof fetch });
    expect(g.real).toBe(false);
    expect(g.deps.client).toBeInstanceOf(SimulatedOpenRouterClient);
    expect(g.deps.balance).toBeUndefined();
    expect(g.generationReader).toBeUndefined();
  });

  it('qualificação real: flag + modo LIGADO + produção desligada + chave ⇒ cliente real COM portão de saldo, que lê o saldo antes da 1ª chamada', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes('/credits')) return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }));
      return new Response(JSON.stringify({
        id: 'gen-q', model: 'anthropic/claude-haiku-5.5', usage: { cost: 0.0003, prompt_tokens: 10, completion_tokens: 5 },
        generation: { model: 'anthropic/claude-haiku-5.5', provider_name: 'Anthropic', total_cost: 0.0003 }, choices: [{ message: { content: 'ok' } }],
      }));
    }) as unknown as typeof fetch;
    const g = buildModelGateway({ OPENROUTER_API_KEY: 'sk-x' }, { policy: policy(), ledgerStore: new MemoryLedgerStore(), flags: { modelosHabilitados: true }, mode: 'qualification', fetchImpl });
    expect(g.real).toBe(true);
    expect(g.deps.balance).toBeDefined();
    expect(g.generationReader).toBeDefined();
    const out = await callModel(g.deps, call());
    expect(out.status).toBe('ok');
    expect(urls[0]).toContain('/credits'); // saldo lido ANTES da chamada de modelo
    expect(urls[1]).toContain('/chat/completions');
  });

  it('modo qualification com o modo DESLIGADO na política, produção ligada ou flag desligada: continua simulado', () => {
    const base = { ledgerStore: new MemoryLedgerStore(), mode: 'qualification' as const, fetchImpl: (() => { throw new Error('rede proibida'); }) as unknown as typeof fetch };
    const key = { OPENROUTER_API_KEY: 'sk-x' };
    const p = policy();
    expect(buildModelGateway(key, { ...base, policy: p }).real).toBe(false); // sem a flag
    expect(buildModelGateway(key, { ...base, policy: p, flags: { modelosHabilitados: true } }).real).toBe(true);
    const off = JSON.parse(JSON.stringify(p)) as ModelPolicy;
    off.qualification!.mode!.enabled = false;
    expect(buildModelGateway(key, { ...base, policy: off, flags: { modelosHabilitados: true } }).real).toBe(false);
    const prod = JSON.parse(JSON.stringify(p)) as ModelPolicy;
    prod.rules.production_enabled = true;
    expect(buildModelGateway(key, { ...base, policy: prod, flags: { modelosHabilitados: true } }).real).toBe(false);
  });

  it('flag ligada sem chave: erro explícito (não cai em simulado em silêncio)', () => {
    expect(() => buildModelGateway(NOKEY, { policy: policy(), ledgerStore: new MemoryLedgerStore(), flags: { modelosHabilitados: true }, mode: 'qualification' })).toThrow(/chave/);
  });

  it('o gateway recusa cliente REAL sem portão de saldo (montagem manual errada): nada reservado nem enviado', async () => {
    const store = new MemoryLedgerStore();
    const p = policy();
    const real = { chat: async () => { throw new Error('rede proibida'); } };
    const deps = { policy: p, gate: new BudgetGate(gateConfigFromPolicy(p), store), client: real, flags: { modelosHabilitados: true } };
    expect(await callModel(deps, call())).toMatchObject({ status: 'blocked', reason: 'balance_guard_missing' });
    expect(await store.readAll()).toHaveLength(0);
  });

  it('com o saldo do provedor insuficiente, a chamada real não sai', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ data: { total_credits: 1, total_usage: 1 } })); // saldo 0
    }) as unknown as typeof fetch;
    const g = buildModelGateway({ OPENROUTER_API_KEY: 'sk-x' }, { policy: policy(), ledgerStore: new MemoryLedgerStore(), flags: { modelosHabilitados: true }, mode: 'qualification', fetchImpl });
    expect(await callModel(g.deps, call())).toMatchObject({ status: 'blocked', reason: 'budget_refused' });
    expect(calls.every((u) => u.includes('/credits'))).toBe(true);
  });
});
