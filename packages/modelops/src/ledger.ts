// Ledger append-only do orçamento. O estado (reservas abertas, pendentes, comprometido, sobrecarga) é reconstruído
// por replay do log. O armazenamento real (PostgreSQL) implementa a mesma interface LedgerStore: a escrita e a
// leitura do gate acontecem dentro de withLock, que no banco é uma transação com trava de consultoria.
import { randomUUID } from 'node:crypto';
import type { Pool, TaskClass } from './types';

export type Lane = 'text' | 'image';

export interface LedgerEvent {
  seq: number;
  at: string;
  monthKey: string;
  type: 'reserve' | 'pending' | 'commit' | 'release' | 'refill_fee';
  reservationId: string;
  taskId?: string;
  taskClass?: TaskClass;
  pool?: Pool;
  lane?: Lane;
  route?: string;
  provider?: string;
  model?: string;
  escalation?: boolean;
  amountMicro?: number; // reserve: teto reservado; refill_fee: valor pago
  actualMicro?: number; // commit: custo real informado pelo provedor
  overrun?: boolean; // commit: custo real acima da reserva
  generationId?: string; // commit: identificador da geração no provedor (prova da cobrança)
  reason?: string; // pending/release: motivo
  evidence?: string; // release conciliada: evidência de que nada foi cobrado
}

// Leitura e escrita de um mesmo instante de travamento.
export interface LedgerIO {
  append(event: LedgerEvent): Promise<void>;
  readAll(): Promise<readonly LedgerEvent[]>;
  // Id novo da reserva, gerado fora da contagem de eventos (UUID; no banco, gen_random_uuid()).
  nextReservationId(): Promise<string>;
}

// Parada: global e por rota. Lida a cada chamada; ligada por quem tem autoridade (proprietário, gate).
export interface KillState {
  global: boolean;
  routes: string[];
}

export interface LedgerStore {
  withLock<T>(fn: (io: LedgerIO) => Promise<T>): Promise<T>;
  append(event: LedgerEvent): Promise<void>;
  readAll(): Promise<readonly LedgerEvent[]>;
  readKill(): Promise<KillState>;
  setKill(scope: 'global' | `route:${string}`, active: boolean, reason: string, at: Date): Promise<void>;
}

// Implementação em memória (testes e desenvolvimento). Não sobrevive a restart.
export class MemoryLedgerStore implements LedgerStore {
  private events: LedgerEvent[] = [];
  private kill = new Map<string, { active: boolean; reason: string }>();
  private chain: Promise<unknown> = Promise.resolve();

  async withLock<T>(fn: (io: LedgerIO) => Promise<T>): Promise<T> {
    const run = this.chain.then(
      () => fn(this.io()),
      () => fn(this.io()),
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  private io(): LedgerIO {
    return {
      append: async (event) => {
        this.events.push(event);
      },
      readAll: async () => this.events.slice(),
      nextReservationId: async () => randomUUID(),
    };
  }

  async append(event: LedgerEvent): Promise<void> {
    await this.withLock((io) => io.append(event));
  }

  async readAll(): Promise<readonly LedgerEvent[]> {
    return this.withLock((io) => io.readAll());
  }

  async readKill(): Promise<KillState> {
    const global = this.kill.get('global')?.active === true;
    const routes = [...this.kill.entries()]
      .filter(([scope, v]) => scope.startsWith('route:') && v.active)
      .map(([scope]) => scope.slice('route:'.length));
    return { global, routes };
  }

  async setKill(scope: 'global' | `route:${string}`, active: boolean, reason: string, _at: Date): Promise<void> {
    this.kill.set(scope, { active, reason });
  }
}

// open: reservada, chamada ainda não resolvida. pending: resultado incerto, aguarda conciliação.
export type ReservationStatus = 'open' | 'pending' | 'committed' | 'released';

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
    } else if (e.type === 'pending') {
      const s = states.get(e.reservationId);
      if (s) s.status = 'pending';
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

// Quanto uma reserva pesa no orçamento: o reservado enquanto aberta ou pendente (resultado incerto conta
// como gasto até conciliação), o real após a conciliação, zero se liberada.
export function spentMicro(s: ReservationState): number {
  if (s.status === 'committed') return s.actualMicro;
  if (s.status === 'open' || s.status === 'pending') return s.reservedMicro;
  return 0;
}
