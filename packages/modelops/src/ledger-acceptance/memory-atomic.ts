/**
 * Implementação de REFERÊNCIA em memória do `AtomicLedgerStore`. Serve para (a) provar que a suíte de
 * aceitação é satisfazível e (b) dar ao Backend um modelo executável do comportamento esperado do
 * PostgreSQL. Dois objetos criados sobre o mesmo `MemoryBacking` emulam dois processos no mesmo banco.
 * As opções `exclusive: false`, `rollback: false` e `idempotent: false` criam armazenamentos DEFEITUOSOS que a suíte deve reprovar (prova de que ela tem dentes).
 */
import { replay } from '../index';
import {
  checkTransition,
  LedgerConflictError,
  LedgerInvariantError,
  validateEventShape,
  type AtomicLedgerStore,
  type LedgerEvent,
  type LedgerTx,
  type NewLedgerEvent,
  type StoredLedgerEvent,
} from './contract';

export class MemoryBacking {
  events: StoredLedgerEvent[] = [];
  byKey = new Map<string, StoredLedgerEvent>();
  nextSeq = 1;
  locks = new Map<string, Promise<unknown>>();
}

const sameContent = (a: NewLedgerEvent, b: StoredLedgerEvent): boolean => {
  const { seq: _seq, ...rest } = b;
  void _seq;
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(rest));
};
function sortKeys(o: object): object {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)));
}

export class MemoryAtomicLedgerStore implements AtomicLedgerStore {
  constructor(
    private readonly backing: MemoryBacking = new MemoryBacking(),
    private readonly opts: { exclusive?: boolean; rollback?: boolean; idempotent?: boolean } = {},
  ) {}

  /** outro "processo" sobre o mesmo banco */
  sibling(): MemoryAtomicLedgerStore {
    return new MemoryAtomicLedgerStore(this.backing, this.opts);
  }

  async transact<T>(monthKey: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    const exclusive = this.opts.exclusive !== false;
    const run = async (): Promise<T> => {
      const buffer: StoredLedgerEvent[] = [];
      const keysAdded: string[] = [];
      const b = this.backing;
      const visible = () => [...b.events, ...buffer];
      const tx: LedgerTx = {
        monthKey,
        readMonth: async () => visible().filter((e) => e.monthKey === monthKey),
        append: async (event: NewLedgerEvent) => {
          const shape = validateEventShape(event);
          if (shape.length) throw new LedgerInvariantError(shape.join('; '));
          if (event.monthKey !== monthKey) throw new LedgerConflictError(`evento de ${event.monthKey} dentro da transação de ${monthKey}`);
          const existing = this.opts.idempotent === false ? undefined : (b.byKey.get(event.idempotencyKey) ?? buffer.find((x) => x.idempotencyKey === event.idempotencyKey));
          if (existing) {
            if (!sameContent(event, existing)) throw new LedgerConflictError('idempotencyKey reutilizada com conteúdo diferente');
            return existing;
          }
          const states = replay(visible());
          const prior = states.get(event.reservationId);
          if (prior && prior.monthKey !== event.monthKey) throw new LedgerConflictError('evento em mês diferente da reserva');
          // `idempotent: false` também permite reserva duplicada (defeito simulado: sem unicidade de identidade)
          const bad = this.opts.idempotent === false && event.type === 'reserve' ? null : checkTransition(states, event);
          if (bad) throw new LedgerConflictError(bad);
          const stored: StoredLedgerEvent = { ...event, seq: b.nextSeq++ };
          buffer.push(stored);
          keysAdded.push(event.idempotencyKey);
          return stored;
        },
      };
      try {
        const out = await fn(tx);
        for (const e of buffer) {
          b.events.push(e);
          b.byKey.set(e.idempotencyKey, e);
        }
        return out;
      } catch (err) {
        // ROLLBACK: nada do buffer vale (os seq consumidos ficam como lacuna, como numa sequência do PostgreSQL)
        if (this.opts.rollback === false) {
          for (const e of buffer) {
            b.events.push(e);
            b.byKey.set(e.idempotencyKey, e);
          }
        }
        throw err;
      }
    };
    if (!exclusive) return run();
    const prev = this.backing.locks.get(monthKey) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.backing.locks.set(monthKey, next.catch(() => undefined));
    return next;
  }

  async readAllStored(): Promise<readonly StoredLedgerEvent[]> {
    return [...this.backing.events].sort((a, b) => a.seq - b.seq);
  }

  // --- compatibilidade com o LedgerStore base ---------------------------------------------------------------
  async append(event: LedgerEvent): Promise<void> {
    const { seq: _seq, ...rest } = event;
    void _seq;
    await this.transact(event.monthKey, (tx) => tx.append({ ...rest, idempotencyKey: `legacy:${event.reservationId}:${event.type}:${event.at}` }));
  }

  async readAll(): Promise<readonly LedgerEvent[]> {
    return (await this.readAllStored()).map(({ idempotencyKey: _k, ...e }) => {
      void _k;
      return e;
    });
  }
}
