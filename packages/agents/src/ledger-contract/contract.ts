/**
 * Contrato do ledger de orçamento PERSISTENTE (gate G4) — proposta da Frente 07 para o Backend.
 *
 * O `BudgetGate` de @ln/modelops hoje serializa com um lock em memória e usa `readAll().length + 1` como
 * `seq`: isso NÃO é seguro com dois processos (OpenBot + worker próprio, ADR-003) nem após reinício
 * concorrente. A implementação em PostgreSQL precisa de: (1) transação por mês com exclusão mútua,
 * (2) `seq` atribuído pelo banco, (3) idempotência por chave, (4) invariantes e transições impostas
 * pelo armazenamento, (5) log append-only. Este arquivo fixa a interface e as regras; a suíte de
 * aceitação (`acceptance.ts`) é o critério do G4. Nada aqui altera @ln/modelops nem @ln/db.
 */
import { replay, spentMicro, type LedgerEvent, type LedgerStore, type ReservationState } from '@ln/modelops';

export type { LedgerEvent, ReservationState };

/** Evento a gravar: o `seq` é do armazenamento; `idempotencyKey` é obrigatória e torna a gravação repetível. */
export type NewLedgerEvent = Omit<LedgerEvent, 'seq'> & { idempotencyKey: string };

/** Evento gravado: `seq` atribuído pelo armazenamento (único e crescente; lacunas são permitidas após ROLLBACK, como numa sequência do PostgreSQL). */
export type StoredLedgerEvent = LedgerEvent & { idempotencyKey: string };

export class LedgerConflictError extends Error {
  readonly code = 'LEDGER_CONFLICT' as const;
}
export class LedgerInvariantError extends Error {
  readonly code = 'LEDGER_INVARIANT' as const;
}

/** Visão transacional de UM mês: lê tudo do mês e acrescenta eventos; a confirmação é atômica. */
export interface LedgerTx {
  readonly monthKey: string;
  /** eventos do mês, em ordem de `seq`, incluindo os já acrescentados nesta transação */
  readMonth(): Promise<readonly StoredLedgerEvent[]>;
  /**
   * Acrescenta o evento. Idempotente por `idempotencyKey`: repetir devolve o evento já gravado (mesmo `seq`),
   * sem duplicar. Lança `LedgerInvariantError` (forma) ou `LedgerConflictError` (transição ilegal, chave
   * reutilizada com conteúdo diferente, reserva inexistente) — e nada do que a transação fez é confirmado.
   */
  append(event: NewLedgerEvent): Promise<StoredLedgerEvent>;
}

/**
 * `LedgerStore` atômico. `transact` executa `fn` com exclusão mútua POR MÊS entre processos
 * (PostgreSQL: `pg_advisory_xact_lock` ou `SELECT … FOR UPDATE` numa linha do mês, dentro de BEGIN/COMMIT).
 * Se `fn` lançar, nenhum `append` da transação vale (ROLLBACK). `append`/`readAll` do `LedgerStore` base
 * continuam existindo para compatibilidade e equivalem a uma transação de um único evento.
 */
export interface AtomicLedgerStore extends LedgerStore {
  transact<T>(monthKey: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
  /** todos os eventos de todos os meses, em ordem de `seq` (replay) */
  readAllStored(): Promise<readonly StoredLedgerEvent[]>;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EVENT_TYPES = ['reserve', 'pending', 'commit', 'release', 'refill_fee'] as const;
const PROVIDERS = ['anthropic', 'openai', 'deepseek'] as const;
const TASK_CLASSES = ['essential', 'non_essential', 'premium', 'reserve'] as const;
const POOLS = ['allocation', 'reserve'] as const;
const LANES = ['text', 'image'] as const;
const isMicro = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Forma de um evento. Todo armazenamento DEVE impor estas regras (no PostgreSQL, também com CHECK). */
export function validateEventShape(e: NewLedgerEvent): string[] {
  const errors: string[] = [];
  if (!MONTH_RE.test(e.monthKey)) errors.push('monthKey deve ser AAAA-MM');
  if (!EVENT_TYPES.includes(e.type)) errors.push(`type inválido: ${String(e.type)}`);
  if (!e.idempotencyKey || e.idempotencyKey.length < 8) errors.push('idempotencyKey obrigatória (mín. 8 caracteres)');
  if (!e.reservationId) errors.push('reservationId obrigatório');
  if (Number.isNaN(Date.parse(e.at))) errors.push('at deve ser data ISO válida');
  for (const f of ['amountMicro', 'actualMicro'] as const) {
    if (e[f] !== undefined && !isMicro(e[f])) errors.push(`${f} deve ser inteiro não negativo (micro-USD)`);
  }
  switch (e.type) {
    case 'reserve':
      for (const f of ['taskId', 'taskClass', 'pool', 'lane', 'provider', 'model'] as const) if (!e[f]) errors.push(`reserve exige ${f}`);
      if (typeof e.escalation !== 'boolean') errors.push('reserve exige escalation booleano');
      if (e.provider && !(PROVIDERS as readonly string[]).includes(e.provider)) errors.push(`provider desconhecido: ${e.provider}`);
      if (e.taskClass && !(TASK_CLASSES as readonly string[]).includes(e.taskClass)) errors.push(`taskClass inválida: ${e.taskClass}`);
      if (e.pool && !(POOLS as readonly string[]).includes(e.pool)) errors.push(`pool inválido: ${e.pool}`);
      if (e.lane && !(LANES as readonly string[]).includes(e.lane)) errors.push(`lane inválida: ${e.lane}`);
      if (e.amountMicro === undefined) errors.push('reserve exige amountMicro');
      break;
    case 'pending':
      if (!e.reason) errors.push('pending exige reason');
      break;
    case 'commit':
      if (e.actualMicro === undefined) errors.push('commit exige actualMicro');
      if (typeof e.overrun !== 'boolean') errors.push('commit exige overrun booleano');
      break;
    case 'release':
      if (!e.reason) errors.push('release exige reason');
      break;
    case 'refill_fee':
      if (e.amountMicro === undefined) errors.push('refill_fee exige amountMicro');
      if (!e.reservationId.startsWith('fee-')) errors.push('refill_fee usa reservationId com prefixo fee-');
      break;
  }
  return errors;
}

/**
 * Transição permitida, dado o estado atual das reservas do mês:
 *   reserve  → só para reservationId novo
 *   pending  → só de `open`
 *   commit   → de `open` ou `pending`
 *   release  → de `open` (motivo) ou de `pending` (SÓ com `evidence` de não cobrança)
 *   committed/released são terminais; refill_fee não pertence a nenhuma reserva (id novo, `fee-…`).
 * Devolve a mensagem de erro, ou `null` se permitida.
 */
export function checkTransition(states: ReadonlyMap<string, ReservationState>, e: NewLedgerEvent): string | null {
  const s = states.get(e.reservationId);
  switch (e.type) {
    case 'reserve':
      return s ? `reserva ${e.reservationId} já existe` : null;
    case 'refill_fee':
      return s ? `${e.reservationId} já existe` : null;
    case 'pending':
      if (!s) return 'reserva inexistente';
      return s.status === 'open' ? null : `pending só de open (está ${s.status})`;
    case 'commit':
      if (!s) return 'reserva inexistente';
      return s.status === 'open' || s.status === 'pending' ? null : `commit de reserva ${s.status}`;
    case 'release':
      if (!s) return 'reserva inexistente';
      if (s.status === 'open') return null;
      if (s.status === 'pending') return e.evidence && e.evidence.trim() ? null : 'liberar reserva pendente exige evidence de não cobrança';
      return `release de reserva ${s.status}`;
  }
}

/** Gasto do mês pelo replay: soma o que cada reserva pesa (aberta/pendente = reservado; comprometida = real). */
export function monthSpentMicro(events: readonly LedgerEvent[], monthKey: string): number {
  let total = 0;
  for (const s of replay(events).values()) if (s.monthKey === monthKey) total += spentMicro(s);
  return total;
}
