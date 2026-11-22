// Ledger append-only do orçamento. O estado (reservas abertas, comprometido, sobrecarga) é reconstruído
// por replay do log. Persistência real (PostgreSQL, R2-08) implementa a mesma interface LedgerStore.
import type { Pool, TaskClass } from './types.ts';

export type Lane = 'text' | 'image';

export interface LedgerEvent {
  seq: number;
  at: string;
  monthKey: string;
  type: 'reserve' | 'commit' | 'release' | 'refill_fee';
  reservationId: string;
  taskId?: string;
  taskClass?: TaskClass;
  pool?: Pool;
  lane?: Lane;
  provider?: string;
  model?: string;
  escalation?: boolean;
  amountMicro?: number; // reserve: teto reservado; refill_fee: valor pago
  actualMicro?: number; // commit: custo real informado pelo provedor
  overrun?: boolean; // commit: custo real acima da reserva
  reason?: string; // release: motivo
}

export interface LedgerStore {
  append(event: LedgerEvent): Promise<void>;
  readAll(): Promise<readonly LedgerEvent[]>;
}

export class MemoryLedgerStore implements LedgerStore {
  private events: LedgerEvent[] = [];

  async append(event: LedgerEvent): Promise<void> {
    this.events.push(event);
  }

  async readAll(): Promise<readonly LedgerEvent[]> {
    return this.events.slice();
  }
}

export type ReservationStatus = 'open' | 'committed' | 'released';

export interface ReservationState {
  id: string;
  taskId: string;
  taskClass: TaskClass;
  pool: Pool;
  lane: Lane;
  provider: string;
  model: string;
  escalation: boolean;
  monthKey: string;
  reservedMicro: number;
  status: ReservationStatus;
  actualMicro: number;
  overrun: boolean;
}

// Reconstrói o estado das reservas a partir do log. Eventos de taxa de compra não entram aqui.
export function replay(events: readonly LedgerEvent[]): Map<string, ReservationState> {
  const states = new Map<string, ReservationState>();
  for (const e of events) {
    if (e.type === 'reserve') {
      states.set(e.reservationId, {
        id: e.reservationId,
        taskId: e.taskId ?? '',
        taskClass: e.taskClass ?? 'essential',
        pool: e.pool ?? 'allocation',
        lane: e.lane ?? 'text',
        provider: e.provider ?? '',
        model: e.model ?? '',
        escalation: e.escalation ?? false,
        monthKey: e.monthKey,
        reservedMicro: e.amountMicro ?? 0,
        status: 'open',
        actualMicro: 0,
        overrun: false,
      });
    } else if (e.type === 'commit') {
      const s = states.get(e.reservationId);
      if (s) {
        s.status = 'committed';
        s.actualMicro = e.actualMicro ?? s.reservedMicro;
        s.overrun = e.overrun ?? false;
      }
    } else if (e.type === 'release') {
      const s = states.get(e.reservationId);
      if (s) s.status = 'released';
    }
  }
  return states;
}

// Quanto uma reserva pesa no orçamento: o reservado enquanto aberta, o real após a conciliação, zero se liberada.
export function spentMicro(s: ReservationState): number {
  if (s.status === 'committed') return s.actualMicro;
  if (s.status === 'open') return s.reservedMicro;
  return 0;
}
