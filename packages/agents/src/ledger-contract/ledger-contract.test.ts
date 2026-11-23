import { loadPolicyFile, MemoryLedgerStore, type ModelPolicy } from '@ln/modelops';
import { describe, expect, it } from 'vitest';
import { POLICY_FIXTURE } from '../paths';
import { ACCEPTANCE_CASES, runAcceptance, type AcceptanceHarness } from './acceptance';
import { defineLedgerAcceptance } from './acceptance.vitest';
import { checkTransition, monthSpentMicro, validateEventShape, type NewLedgerEvent } from './contract';
import { MemoryAtomicLedgerStore } from './memory-atomic';

const policy = loadPolicyFile(POLICY_FIXTURE).policy as ModelPolicy;

const harness = (opts: ConstructorParameters<typeof MemoryAtomicLedgerStore>[1] = {}) => async (): Promise<AcceptanceHarness> => {
  const a = new MemoryAtomicLedgerStore(undefined, opts);
  return { a, b: () => a.sibling(), policy };
};

// A implementação de referência passa a suíte inteira (A10 depende de SQL cru e fica "skipped" aqui).
defineLedgerAcceptance('implementação de referência em memória', harness());

describe('a suíte de aceitação tem dentes: reprova armazenamentos defeituosos', () => {
  const failed = async (opts: ConstructorParameters<typeof MemoryAtomicLedgerStore>[1]) =>
    (await runAcceptance(harness(opts))).filter((r) => r.outcome === 'failed' && !r.optional).map((r) => r.id);

  it('sem exclusão mútua por mês: estoura o teto sob concorrência (A07)', async () => {
    expect(await failed({ exclusive: false })).toEqual(['A07_concurrency_cap']);
  });
  it('sem rollback: eventos de transação desfeita aparecem (A05)', async () => {
    expect(await failed({ rollback: false })).toEqual(['A05_atomic_rollback']);
  });
  it('sem unicidade/idempotência: repetir o mesmo evento duplica (A04)', async () => {
    expect(await failed({ idempotent: false })).toEqual(['A03_transitions', 'A04_idempotency']);
  });
  it('a referência passa tudo e só A10 fica "skipped" (precisa de SQL cru)', async () => {
    const r = await runAcceptance(harness());
    expect(r.filter((x) => x.outcome === 'failed')).toEqual([]);
    expect(r.filter((x) => x.outcome === 'skipped').map((x) => x.id)).toEqual(['A10_append_only']);
    expect(r).toHaveLength(ACCEPTANCE_CASES.length);
  });
  it('sem a política o caso do BudgetGate fica "skipped", nunca "passed"', async () => {
    const r = await runAcceptance(async () => {
      const a = new MemoryAtomicLedgerStore();
      return { a, b: () => a.sibling() };
    });
    expect(r.find((x) => x.id === 'A12_budget_gate_dropin')!.outcome).toBe('skipped');
  });
});

describe('o defeito que motiva o G4: BudgetGate atual com dois processos sobre o mesmo ledger', () => {
  // SONDA, desligada por padrão: mede o comportamento ATUAL do gate (fora desta frente). Rode com LN_LEDGER_PROBE=1.
  // Medido em 23/11/2026 sobre ft/agents 4f589da: 8 de 8 reservas de US$ 5 aceitas (US$ 40 contra a verba Anthropic de US$ 22)
  // e ids/seq duplicados (r-1, r-3, r-5, r-7 duas vezes). Quando o Backend entregar o PgLedgerStore atômico, esta sonda deve
  // passar a reprovar o defeito (accepted <= 4, ids únicos) ou ser removida em favor do A07.
  it.skipIf(!process.env.LN_LEDGER_PROBE)('dois gates sobre o mesmo MemoryLedgerStore', async () => {
    const { BudgetGate, gateConfigFromPolicy } = await import('@ln/modelops');
    const store = new MemoryLedgerStore();
    const cfg = gateConfigFromPolicy(policy);
    const g1 = new BudgetGate(cfg, store);
    const g2 = new BudgetGate(cfg, store);
    const at = new Date('2026-12-03T12:00:00Z');
    const input = { taskId: 'daily', taskClass: 'non_essential' as const, lane: 'text' as const, provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountUsd: 5, at };
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? g1 : g2).reserve(input)));
    const ids = (await store.readAll()).filter((e) => e.type === 'reserve').map((e) => e.reservationId);
    expect(results.filter((r) => r.ok).length, 'reservas aceitas (verba segura: 4)').toBeLessThanOrEqual(4);
    expect(new Set(ids).size, 'ids de reserva únicos').toBe(ids.length);
  });
});

describe('regras puras do contrato', () => {
  const base: NewLedgerEvent = { at: '2026-12-02T09:00:00.000Z', monthKey: '2026-12', type: 'reserve', reservationId: 'r-1', taskId: 'daily', taskClass: 'non_essential', pool: 'allocation', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountMicro: 10, idempotencyKey: 'abcdefgh' };

  it('forma: válido passa; cada violação é apontada', () => {
    expect(validateEventShape(base)).toEqual([]);
    expect(validateEventShape({ ...base, amountMicro: -1 })).not.toEqual([]);
    expect(validateEventShape({ ...base, amountMicro: 1.5 })).not.toEqual([]);
    expect(validateEventShape({ ...base, monthKey: '2026-00' })).not.toEqual([]);
    expect(validateEventShape({ ...base, idempotencyKey: 'curta' })).not.toEqual([]);
    expect(validateEventShape({ ...base, type: 'commit', actualMicro: 1 })).toContain('commit exige overrun booleano');
  });

  it('transições: tabela completa', () => {
    const open = new Map([['r-1', { id: 'r-1', status: 'open' }]]) as never;
    const pending = new Map([['r-1', { id: 'r-1', status: 'pending' }]]) as never;
    const committed = new Map([['r-1', { id: 'r-1', status: 'committed' }]]) as never;
    const ev = (type: NewLedgerEvent['type'], extra: Partial<NewLedgerEvent> = {}): NewLedgerEvent => ({ ...base, type, ...extra });
    expect(checkTransition(open, ev('pending'))).toBeNull();
    expect(checkTransition(open, ev('commit'))).toBeNull();
    expect(checkTransition(open, ev('release'))).toBeNull();
    expect(checkTransition(open, ev('reserve'))).toMatch(/já existe/);
    expect(checkTransition(pending, ev('pending'))).toMatch(/só de open/);
    expect(checkTransition(pending, ev('commit'))).toBeNull();
    expect(checkTransition(pending, ev('release'))).toMatch(/evidence/);
    expect(checkTransition(pending, ev('release', { evidence: 'ok' }))).toBeNull();
    expect(checkTransition(committed, ev('commit'))).toMatch(/committed/);
    expect(checkTransition(new Map(), ev('commit'))).toBe('reserva inexistente');
  });

  it('gasto do mês: aberta/pendente pesam o reservado, comprometida o real, liberada zero', () => {
    const e = (seq: number, type: NewLedgerEvent['type'], id: string, extra: object = {}) => ({ ...base, seq, type, reservationId: id, ...extra });
    const events = [
      e(1, 'reserve', 'a', { amountMicro: 100 }), e(2, 'commit', 'a', { actualMicro: 60, overrun: false }),
      e(3, 'reserve', 'b', { amountMicro: 200 }), e(4, 'pending', 'b', { reason: 'x' }),
      e(5, 'reserve', 'c', { amountMicro: 300 }), e(6, 'release', 'c', { reason: 'x' }),
      e(7, 'reserve', 'd', { amountMicro: 50 }),
    ];
    expect(monthSpentMicro(events as never, '2026-12')).toBe(60 + 200 + 0 + 50);
  });
});
