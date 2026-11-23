/**
 * Suíte de ACEITAÇÃO do ledger persistente (critérios do G4). Independente de framework: cada caso é uma
 * função que lança se a implementação viola o contrato. O Backend roda os mesmos casos contra o
 * `PgLedgerStore` (ver `acceptance.vitest.ts`); aqui eles rodam contra a implementação de referência.
 */
import { BudgetGate, gateConfigFromPolicy, type ModelPolicy } from '@ln/modelops';
import {
  LedgerConflictError,
  LedgerInvariantError,
  monthSpentMicro,
  type AtomicLedgerStore,
  type NewLedgerEvent,
} from './contract';

export interface AcceptanceHarness {
  /** dois handles sobre o MESMO banco (dois processos); o segundo deve ser aberto depois, para provar leitura do banco */
  a: AtomicLedgerStore;
  b: () => AtomicLedgerStore;
  /** tenta UPDATE/DELETE direto no armazenamento (SQL cru); a implementação PostgreSQL deve REJEITAR (trigger) */
  tamper?: (kind: 'update' | 'delete') => Promise<void>;
  /** política validada, para o caso de substituição direta do BudgetGate */
  policy?: ModelPolicy;
}

export interface AcceptanceCase {
  id: string;
  title: string;
  /** o que a implementação PostgreSQL precisa fazer para passar */
  requirement: string;
  run(h: AcceptanceHarness): Promise<void | 'skipped'>;
}

const MONTH = '2026-12';
const T = '2026-12-02T09:00:00.000Z';
let counter = 0;
export const key = (p = 'k'): string => `${p}-${String(++counter).padStart(8, '0')}`;

export const reserveEvent = (id: string, amountMicro = 100_000, over: Partial<NewLedgerEvent> = {}): NewLedgerEvent => ({
  at: T, monthKey: MONTH, type: 'reserve', reservationId: id, taskId: 'daily', taskClass: 'non_essential', pool: 'allocation', lane: 'text',
  provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountMicro, idempotencyKey: key('res'), ...over,
});
export const commitEvent = (id: string, actualMicro = 80_000, over: Partial<NewLedgerEvent> = {}): NewLedgerEvent => ({
  at: T, monthKey: MONTH, type: 'commit', reservationId: id, actualMicro, overrun: false, idempotencyKey: key('com'), ...over,
});
export const pendingEvent = (id: string, over: Partial<NewLedgerEvent> = {}): NewLedgerEvent => ({
  at: T, monthKey: MONTH, type: 'pending', reservationId: id, reason: 'timeout depois do envio', idempotencyKey: key('pen'), ...over,
});
export const releaseEvent = (id: string, over: Partial<NewLedgerEvent> = {}): NewLedgerEvent => ({
  at: T, monthKey: MONTH, type: 'release', reservationId: id, reason: 'rejeição 429 sem cobrança', idempotencyKey: key('rel'), ...over,
});

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`aceitação falhou: ${msg}`);
}
async function rejects(p: Promise<unknown>, type: new (...a: never[]) => Error, label: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof type) return;
    throw new Error(`aceitação falhou: ${label}: esperava ${type.name}, veio ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`, { cause: e });
  }
  throw new Error(`aceitação falhou: ${label}: deveria ser rejeitado`);
}
const append = (s: AtomicLedgerStore, e: NewLedgerEvent, month = MONTH) => s.transact(month, (tx) => tx.append(e));

export const ACCEPTANCE_CASES: AcceptanceCase[] = [
  {
    id: 'A01_seq_by_store',
    title: 'seq é atribuído pelo armazenamento, único e crescente; replay em ordem de seq',
    requirement: 'coluna identity/bigserial; nunca `count(*) + 1` (BudgetGate faz isso hoje)',
    async run({ a }) {
      const e1 = await append(a, reserveEvent('r-a1'));
      const e2 = await append(a, reserveEvent('r-a2'));
      const e3 = await append(a, commitEvent('r-a1'));
      assert(e1.seq < e2.seq && e2.seq < e3.seq, 'seq deve crescer');
      const all = await a.readAllStored();
      assert(all.map((e) => e.seq).join() === [...all.map((e) => e.seq)].sort((x, y) => x - y).join(), 'readAllStored fora de ordem de seq');
      assert(new Set(all.map((e) => e.seq)).size === all.length, 'seq repetido');
    },
  },
  {
    id: 'A02_shape_invariants',
    title: 'evento malformado é rejeitado e nada é gravado',
    requirement: 'CHECK no banco + validateEventShape na aplicação',
    async run({ a }) {
      const bads: [string, NewLedgerEvent][] = [
        ['valor negativo', reserveEvent('r-b1', -1)],
        ['valor fracionário', reserveEvent('r-b2', 10.5)],
        ['mês inválido', reserveEvent('r-b3', 1, { monthKey: '2026-13' })],
        ['chave de idempotência curta', reserveEvent('r-b4', 1, { idempotencyKey: 'x' })],
        ['reserve sem provedor', reserveEvent('r-b5', 1, { provider: undefined })],
        ['commit sem actualMicro', commitEvent('r-b6', 1, { actualMicro: undefined })],
        ['release sem motivo', releaseEvent('r-b7', { reason: undefined })],
        ['refill sem prefixo fee-', { at: T, monthKey: MONTH, type: 'refill_fee', reservationId: 'r-b8', amountMicro: 5, idempotencyKey: key('fee') }],
        ['data inválida', reserveEvent('r-b9', 1, { at: 'ontem' })],
      ];
      for (const [label, ev] of bads) await rejects(append(a, ev, ev.monthKey.match(/^\d{4}-(0[1-9]|1[0-2])$/) ? ev.monthKey : MONTH), LedgerInvariantError, label);
      assert((await a.readAllStored()).length === 0, 'nada deve ter sido gravado');
    },
  },
  {
    id: 'A03_transitions',
    title: 'transições ilegais são recusadas pelo armazenamento (não só pela aplicação)',
    requirement: 'índices únicos parciais (1 reserve, ≤1 pending e ≤1 terminal por reserva) + trigger de transição',
    async run({ a }) {
      await append(a, reserveEvent('r-t1'));
      await rejects(append(a, reserveEvent('r-t1')), LedgerConflictError, 'reserve duplicada');
      await rejects(append(a, commitEvent('r-nao-existe')), LedgerConflictError, 'commit de reserva inexistente');
      await append(a, commitEvent('r-t1'));
      await rejects(append(a, commitEvent('r-t1')), LedgerConflictError, 'commit duplo');
      await rejects(append(a, releaseEvent('r-t1')), LedgerConflictError, 'release depois de commit');
      await rejects(append(a, pendingEvent('r-t1')), LedgerConflictError, 'pending depois de commit');
      await append(a, reserveEvent('r-t2'));
      await append(a, releaseEvent('r-t2'));
      await rejects(append(a, commitEvent('r-t2')), LedgerConflictError, 'commit depois de release');
      await append(a, reserveEvent('r-t3'));
      await append(a, pendingEvent('r-t3'));
      await rejects(append(a, pendingEvent('r-t3')), LedgerConflictError, 'pending duplo');
      await rejects(append(a, releaseEvent('r-t3')), LedgerConflictError, 'release de pendente sem evidência');
      await append(a, releaseEvent('r-t3', { evidence: 'generation consultada: cobrança zero' }));
      await append(a, reserveEvent('r-t4'));
      await append(a, pendingEvent('r-t4'));
      await append(a, commitEvent('r-t4')); // pendente fecha pelo custo real
    },
  },
  {
    id: 'A04_idempotency',
    title: 'repetir a mesma chave devolve o mesmo evento; chave com conteúdo diferente é conflito',
    requirement: 'UNIQUE(idempotency_key) + comparação de conteúdo; vale entre processos',
    async run({ a, b }) {
      const ev = reserveEvent('r-i1');
      const first = await append(a, ev);
      const again = await append(a, ev);
      const other = await append(b(), ev);
      assert(first.seq === again.seq && first.seq === other.seq, 'a repetição deve devolver o mesmo seq');
      assert((await a.readAllStored()).filter((e) => e.reservationId === 'r-i1').length === 1, 'não pode duplicar o evento');
      await rejects(append(a, { ...ev, amountMicro: (ev.amountMicro ?? 0) + 1 }), LedgerConflictError, 'mesma chave, conteúdo diferente');
    },
  },
  {
    id: 'A05_atomic_rollback',
    title: 'erro dentro da transação desfaz todos os eventos dela',
    requirement: 'BEGIN … COMMIT/ROLLBACK numa única conexão',
    async run({ a }) {
      await rejects(
        a.transact(MONTH, async (tx) => {
          await tx.append(reserveEvent('r-x1'));
          await tx.append(reserveEvent('r-x2'));
          throw new LedgerConflictError('falha simulada depois de dois appends');
        }),
        LedgerConflictError,
        'transação com erro',
      );
      await rejects(
        a.transact(MONTH, async (tx) => {
          await tx.append(reserveEvent('r-x3'));
          await tx.append(commitEvent('r-x3', -5)); // inválido: derruba a transação inteira
        }),
        LedgerInvariantError,
        'append inválido no meio da transação',
      );
      const ids = (await a.readAllStored()).map((e) => e.reservationId);
      assert(!ids.some((id) => ['r-x1', 'r-x2', 'r-x3'].includes(id)), 'eventos de transação desfeita apareceram no ledger');
      // a transação lê o que ela mesma acrescentou
      await a.transact(MONTH, async (tx) => {
        await tx.append(reserveEvent('r-x4'));
        assert((await tx.readMonth()).some((e) => e.reservationId === 'r-x4'), 'a transação deve ver os próprios appends');
      });
    },
  },
  {
    id: 'A06_month_isolation',
    title: 'cada transação é de um mês; gasto e leitura não vazam entre meses',
    requirement: 'lock por month_key; month_key do evento == da transação',
    async run({ a }) {
      await append(a, reserveEvent('r-m1', 300_000));
      await append(a, reserveEvent('r-m2', 500_000, { monthKey: '2027-01', at: '2027-01-04T09:00:00.000Z' }), '2027-01');
      const dez = await a.transact(MONTH, (tx) => tx.readMonth());
      const jan = await a.transact('2027-01', (tx) => tx.readMonth());
      assert(dez.length === 1 && jan.length === 1, 'cada mês lê só os próprios eventos');
      assert(monthSpentMicro(dez, MONTH) === 300_000 && monthSpentMicro(jan, '2027-01') === 500_000, 'gasto por mês');
      await rejects(append(a, reserveEvent('r-m3', 1, { monthKey: '2027-01' }), MONTH), LedgerConflictError, 'evento de outro mês na transação');
      await rejects(append(a, commitEvent('r-m1', 1, { monthKey: '2027-01', at: '2027-01-04T09:00:00.000Z' }), '2027-01'), LedgerConflictError, 'commit em mês diferente da reserva');
    },
  },
  {
    id: 'A07_concurrency_cap',
    title: 'reservas concorrentes de dois processos nunca ultrapassam o teto',
    requirement: 'exclusão mútua por mês entre processos (pg_advisory_xact_lock ou SELECT … FOR UPDATE)',
    async run({ a, b }) {
      const cap = 10_000_000;
      const amount = 100_000;
      const second = b();
      const attempt = (store: AtomicLedgerStore, n: number) =>
        store.transact(MONTH, async (tx) => {
          const spent = monthSpentMicro(await tx.readMonth(), MONTH);
          if (spent + amount > cap) return false;
          await tx.append(reserveEvent(`r-c${n}`, amount));
          return true;
        });
      const results = await Promise.all(Array.from({ length: 200 }, (_, n) => attempt(n % 2 === 0 ? a : second, n)));
      const ok = results.filter(Boolean).length;
      const spent = monthSpentMicro(await a.readAllStored(), MONTH);
      assert(spent <= cap, `teto estourado: ${spent} > ${cap}`);
      assert(ok === cap / amount, `esperadas exatamente ${cap / amount} reservas aceitas, vieram ${ok}`);
      const seqs = (await a.readAllStored()).map((e) => e.seq);
      assert(new Set(seqs).size === seqs.length, 'seq repetido sob concorrência');
    },
  },
  {
    id: 'A08_reopen_replay',
    title: 'outro handle (outro processo/reinício) reconstrói o mesmo estado e o mesmo gasto',
    requirement: 'estado só no banco; nada em memória do processo',
    async run({ a, b }) {
      await append(a, reserveEvent('r-p1', 200_000));
      await append(a, commitEvent('r-p1', 150_000));
      await append(a, reserveEvent('r-p2', 300_000));
      await append(a, pendingEvent('r-p2'));
      const late = b();
      const x = await a.readAllStored();
      const y = await late.readAllStored();
      assert(JSON.stringify(x) === JSON.stringify(y), 'leituras divergentes entre handles');
      assert(monthSpentMicro(y, MONTH) === 150_000 + 300_000, 'pendente conta pelo reservado; comprometida pelo real');
    },
  },
  {
    id: 'A09_refill_outside_cap',
    title: 'taxa de recarga fica registrada e fora do teto',
    requirement: 'refill_fee é evento próprio; não entra no gasto do mês',
    async run({ a }) {
      await append(a, reserveEvent('r-f1', 100_000));
      await append(a, { at: T, monthKey: MONTH, type: 'refill_fee', reservationId: 'fee-2026-12-02T09:00:00.000Z', amountMicro: 75_000, idempotencyKey: key('fee') });
      const all = await a.readAllStored();
      assert(all.some((e) => e.type === 'refill_fee' && e.amountMicro === 75_000), 'taxa não registrada');
      assert(monthSpentMicro(all, MONTH) === 100_000, 'taxa não pode contar no teto');
    },
  },
  {
    id: 'A10_append_only',
    title: 'UPDATE e DELETE no ledger são rejeitados pelo banco',
    requirement: 'triggers BEFORE UPDATE/DELETE que lançam exceção (como budget_ledger já faz)',
    async run({ a, tamper }) {
      if (!tamper) return 'skipped';
      await append(a, reserveEvent('r-o1'));
      await rejects(tamper('update'), Error, 'UPDATE cru no ledger');
      await rejects(tamper('delete'), Error, 'DELETE cru no ledger');
      assert((await a.readAllStored()).some((e) => e.reservationId === 'r-o1'), 'o evento deve continuar lá');
    },
  },
  {
    id: 'A11_legacy_store_interface',
    title: 'append/readAll do LedgerStore base seguem funcionando (compatibilidade com o BudgetGate atual)',
    requirement: 'o armazenamento atômico também implementa LedgerStore',
    async run({ a }) {
      const { idempotencyKey: _k, ...legacy } = reserveEvent('r-l1');
      void _k;
      await a.append({ ...legacy, seq: 999 }); // seq do chamador é ignorado
      const all = await a.readAll();
      const got = all.find((e) => e.reservationId === 'r-l1');
      assert(got && got.seq !== 999 && got.seq >= 1, 'o seq vem do armazenamento, não do chamador');
    },
  },
  {
    id: 'A12_budget_gate_dropin',
    title: 'o BudgetGate funciona sobre o armazenamento (reserva, conciliação, recusa por teto)',
    requirement: 'substituição direta do MemoryLedgerStore sem mudar o gate',
    async run({ a, policy }) {
      if (!policy) return 'skipped';
      const gate = new BudgetGate(gateConfigFromPolicy(policy), a);
      const at = new Date('2026-12-03T12:00:00Z');
      const r = await gate.reserve({ taskId: 'daily', taskClass: 'non_essential', lane: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountUsd: 0.5, at });
      assert(r.ok, 'reserva deveria passar');
      if (r.ok) {
        const c = await gate.commit(r.reservationId, 0.4, at);
        assert(c.ok && !c.overrun, 'commit deveria conciliar');
      }
      const snap = await gate.snapshot(at);
      assert(snap.totalMicro === 400_000, `gasto esperado 400000, veio ${snap.totalMicro}`);
      const huge = await gate.reserve({ taskId: 'daily', taskClass: 'non_essential', lane: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountUsd: 45, at });
      assert(!huge.ok, 'reserva acima do degrau deveria ser recusada');
    },
  },
];

export interface AcceptanceResult {
  id: string;
  outcome: 'passed' | 'failed' | 'skipped';
  error?: string;
}

/** Roda todos os casos, cada um com um banco novo; não lança: devolve o resultado por caso. */
export async function runAcceptance(makeHarness: () => Promise<AcceptanceHarness>, only?: readonly string[]): Promise<AcceptanceResult[]> {
  const out: AcceptanceResult[] = [];
  for (const c of ACCEPTANCE_CASES.filter((x) => !only || only.includes(x.id))) {
    try {
      const r = await c.run(await makeHarness());
      out.push({ id: c.id, outcome: r === 'skipped' ? 'skipped' : 'passed' });
    } catch (e) {
      out.push({ id: c.id, outcome: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
