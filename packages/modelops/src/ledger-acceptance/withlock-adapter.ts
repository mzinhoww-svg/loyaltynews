/**
 * Adaptador `LedgerStore.withLock` → `AtomicLedgerStore.transact`, para rodar a suíte de aceitação do ledger sobre o
 * `PostgresLedgerStore` (ADR-020). NÃO acrescenta validação: tudo o que é recusado vem do armazenamento (CHECKs, gatilhos,
 * chaves). Só traduz os erros de integridade do PostgreSQL (SQLSTATE 23xxx) nas classes do contrato.
 */
import type { LedgerEvent, LedgerStore } from '../ledger';
import {
  LedgerConflictError,
  LedgerInvariantError,
  type AtomicLedgerStore,
  type LedgerTx,
  type NewLedgerEvent,
  type StoredLedgerEvent,
} from './contract';

function sqlstateOf(err: unknown): string {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return '';
}

function translate(err: unknown): never {
  const code = sqlstateOf(err);
  const message = err instanceof Error ? err.message : String(err);
  if (code === '23514' || code === '23502' || code === '22003' || code === '22P02' || code === '22007') throw new LedgerInvariantError(message, { cause: err });
  if (code.startsWith('23') || code === '40001' || code === '40P01') throw new LedgerConflictError(message, { cause: err });
  throw err;
}

const keyOf = (e: LedgerEvent): string => `${e.reservationId}:${e.type}`;
const stored = (events: readonly LedgerEvent[]): StoredLedgerEvent[] => events.map((e) => ({ ...e, idempotencyKey: keyOf(e) }));

export class WithLockAtomicAdapter implements AtomicLedgerStore {
  constructor(readonly gateStore: LedgerStore) {}

  async transact<T>(monthKey: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    try {
      return await this.gateStore.withLock(async (io) => {
        const tx: LedgerTx = {
          monthKey,
          readMonth: async () => stored(await io.readAll()).filter((e) => e.monthKey === monthKey),
          append: async (e: NewLedgerEvent) => {
            if (e.monthKey !== monthKey) throw new LedgerConflictError(`evento de ${e.monthKey} na transação de ${monthKey}`);
            const { idempotencyKey: _k, ...ev } = e;
            void _k;
            const before = (await io.readAll()).length;
            await io.append({ ...ev, seq: before + 1 });
            const after = stored(await io.readAll());
            return after.find((x) => x.reservationId === e.reservationId && x.type === e.type) ?? { ...ev, seq: before + 1, idempotencyKey: e.idempotencyKey };
          },
        };
        return fn(tx);
      });
    } catch (err) {
      return translate(err);
    }
  }

  async readAllStored(): Promise<readonly StoredLedgerEvent[]> {
    return stored(await this.gateStore.readAll());
  }

  append(event: LedgerEvent): Promise<void> {
    return this.gateStore.append(event);
  }

  readAll(): Promise<readonly LedgerEvent[]> {
    return this.gateStore.readAll();
  }
}
