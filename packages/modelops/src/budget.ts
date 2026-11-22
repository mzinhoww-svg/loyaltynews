// Portão de orçamento: reserva atômica em micro-USD contra o teto agregado de US$ 50 (DP-04, ADR-015).
// Cada reserva é checada e gravada dentro de um lock; sem isso, chamadas concorrentes poderiam estourar o teto.
import { usdToMicro, microToUsd } from './money';
import { monthKey } from './month';
import { replay, spentMicro, type LedgerStore, type Lane, type ReservationState } from './ledger';
import type { ModelPolicy, Pool, TaskClass } from './types';

export interface GateConfig {
  capMicro: number; // teto mensal agregado (50)
  providerAllocationMicro: Record<string, number>; // openai 20, anthropic 22, deepseek 0
  imageAllocationMicro: number; // images 0
  escalationSublimitMicro: number; // 5 dentro da verba da Anthropic
  reserveMicro: number; // 8, exclusiva de auditoria e errata
  reserveTaskIds: readonly string[];
  ceilingMicro: Record<TaskClass, number>; // degraus: premium 35, não essencial 40, essencial 42, reserva 50
}

export interface ReserveInput {
  taskId: string;
  taskClass: TaskClass;
  lane: Lane;
  provider: string;
  model: string;
  escalation: boolean;
  amountUsd: number | null; // teto superior estimado; null = custo desconhecido
  at: Date;
}

export type ReserveRefusal =
  | 'unknown_cost'
  | 'zero_allocation'
  | 'image_allocation_zero'
  | 'reserve_task_not_eligible'
  | 'reserve_pool_exhausted'
  | 'provider_allocation_exhausted'
  | 'escalation_sublimit'
  | 'step_ceiling'
  | 'hard_cap';

export type ReserveResult =
  | { ok: true; reservationId: string; amountMicro: number }
  | { ok: false; reason: ReserveRefusal; detail: string };

export interface Snapshot {
  monthKey: string;
  totalMicro: number;
  allocationMicro: number;
  reserveMicro: number;
  providerMicro: Record<string, number>;
  escalationMicro: number;
  openReservations: number;
  pendingReservations: number;
}

export interface CommitResult {
  ok: boolean;
  overrun: boolean;
  actualMicro: number;
  detail: string;
}

// Constrói a configuração do portão a partir da política validada. Degraus mapeados explicitamente.
export function gateConfigFromPolicy(policy: ModelPolicy): GateConfig {
  const rules = policy.rules;
  const alloc = rules.budget_allocation_usd;
  const steps = rules.budget_steps_usd;
  const providerAllocationMicro: Record<string, number> = {
    openai: usdToMicro(alloc.openai),
    anthropic: usdToMicro(alloc.anthropic),
    deepseek: usdToMicro(alloc.deepseek),
  };
  return {
    capMicro: usdToMicro(rules.hard_monthly_budget_usd),
    providerAllocationMicro,
    imageAllocationMicro: usdToMicro(alloc.images),
    escalationSublimitMicro: usdToMicro(alloc.anthropic_escalation_opus_fable_included),
    reserveMicro: usdToMicro(alloc.audit_errata_reserve),
    reserveTaskIds: auditTaskIdsOf(rules),
    ceilingMicro: {
      premium: usdToMicro(Number(findStep(steps, '35'))),
      non_essential: usdToMicro(Number(findStep(steps, '40'))),
      essential: usdToMicro(Number(findStep(steps, '42'))),
      reserve: usdToMicro(Number(findStep(steps, '50'))),
    },
  };
}

// Tarefas que podem usar a reserva de 8, lidas de rules.budget_enforcement (tipado, sem any).
function auditTaskIdsOf(rules: ModelPolicy['rules']): readonly string[] {
  const enforcement: unknown = rules.budget_enforcement;
  if (typeof enforcement !== 'object' || enforcement === null) return [];
  const list: unknown = (enforcement as { audit_errata_reserve_exclusive_to?: unknown }).audit_errata_reserve_exclusive_to;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === 'string');
}

// Os valores dos degraus são texto ("stop premium/experiments"); o teto de cada degrau vem da chave.
function findStep(steps: Record<string, string>, key: string): number {
  if (!(key in steps)) throw new Error(`degrau ${key} ausente`);
  return Number(key);
}

export class BudgetGate {
  private readonly config: GateConfig;
  private readonly store: LedgerStore;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(config: GateConfig, store: LedgerStore) {
    this.config = config;
    this.store = store;
  }

  // Serializa operações: cada uma começa depois que a anterior terminou.
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async states(): Promise<Map<string, ReservationState>> {
    return replay(await this.store.readAll());
  }

  async snapshot(at: Date): Promise<Snapshot> {
    return this.locked(async () => this.computeSnapshot(await this.states(), monthKey(at)));
  }

  private computeSnapshot(states: Map<string, ReservationState>, month: string): Snapshot {
    const snap: Snapshot = {
      monthKey: month,
      totalMicro: 0,
      allocationMicro: 0,
      reserveMicro: 0,
      providerMicro: {},
      escalationMicro: 0,
      openReservations: 0,
      pendingReservations: 0,
    };
    for (const s of states.values()) {
      if (s.monthKey !== month) continue;
      const spent = spentMicro(s);
      if (s.status === 'open') snap.openReservations += 1;
      if (s.status === 'pending') snap.pendingReservations += 1;
      if (s.pool === 'reserve') {
        snap.reserveMicro += spent;
      } else {
        snap.allocationMicro += spent;
        snap.providerMicro[s.provider] = (snap.providerMicro[s.provider] ?? 0) + spent;
        if (s.escalation) snap.escalationMicro += spent;
      }
      snap.totalMicro += spent;
    }
    return snap;
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.locked(async () => {
      const month = monthKey(input.at);
      const refuse = (reason: ReserveRefusal, detail: string): ReserveResult => ({ ok: false, reason, detail });

      // 1. Custo desconhecido bloqueia (block_unknown_cost).
      if (input.amountUsd === null || !Number.isFinite(input.amountUsd) || input.amountUsd < 0) {
        return refuse('unknown_cost', 'custo máximo não estimado');
      }
      const amountMicro = usdToMicro(input.amountUsd);

      // 2. Verba zero vale para qualquer bolsa: provedor sem verba (DeepSeek) não recebe chamada.
      const pool: Pool = input.taskClass === 'reserve' ? 'reserve' : 'allocation';
      const providerCap = this.config.providerAllocationMicro[input.provider];
      if (providerCap === undefined || providerCap === 0) {
        return refuse('zero_allocation', `verba zero ou inexistente para ${input.provider}`);
      }
      if (input.lane === 'image' && this.config.imageAllocationMicro === 0) {
        return refuse('image_allocation_zero', 'verba de imagens é zero até o preço ser verificado');
      }

      // 3. Reserva exclusiva: só WF08, WF18 e auditoria/despublicação podem usá-la.
      if (pool === 'reserve' && !this.config.reserveTaskIds.includes(input.taskId)) {
        return refuse('reserve_task_not_eligible', `tarefa ${input.taskId} não pode usar a reserva`);
      }

      const snap = this.computeSnapshot(await this.states(), month);

      if (pool === 'reserve') {
        if (snap.reserveMicro + amountMicro > this.config.reserveMicro) {
          return refuse('reserve_pool_exhausted', 'reserva de 8 esgotada no mês');
        }
      } else {
        const providerSpent = snap.providerMicro[input.provider] ?? 0;
        if (providerSpent + amountMicro > providerCap) {
          return refuse('provider_allocation_exhausted', `verba de ${input.provider} esgotada no mês`);
        }
        if (input.escalation) {
          if (snap.escalationMicro + amountMicro > this.config.escalationSublimitMicro) {
            return refuse('escalation_sublimit', 'sublimite de escalonamento (Opus/Fable) esgotado');
          }
        }
      }

      // 4. Degrau da classe: o gasto total projetado não pode passar do teto da classe.
      const ceiling = this.config.ceilingMicro[input.taskClass];
      if (snap.totalMicro + amountMicro > ceiling) {
        return refuse('step_ceiling', `degrau ${microToUsd(ceiling)} para classe ${input.taskClass}`);
      }

      // 5. Teto mensal agregado, sempre.
      if (snap.totalMicro + amountMicro > this.config.capMicro) {
        return refuse('hard_cap', 'teto mensal de US$ 50 atingido');
      }

      // Id derivado do próprio log: sem contador em memória, não colide após reinício.
      const seq = (await this.store.readAll()).length + 1;
      const id = `r-${seq}`;
      await this.store.append({
        seq,
        at: input.at.toISOString(),
        monthKey: month,
        type: 'reserve',
        reservationId: id,
        taskId: input.taskId,
        taskClass: input.taskClass,
        pool,
        lane: input.lane,
        provider: input.provider,
        model: input.model,
        escalation: input.escalation,
        amountMicro,
      });
      return { ok: true, reservationId: id, amountMicro };
    });
  }

  // Estado atual de uma reserva (ou undefined se não existe).
  async statusOf(reservationId: string): Promise<ReservationState | undefined> {
    return this.locked(async () => (await this.states()).get(reservationId));
  }

  // Resultado incerto depois do envio: a reserva continua contando no teto como pendente de conciliação.
  async markPending(reservationId: string, reason: string, at: Date): Promise<CommitResult> {
    return this.locked(async () => {
      const s = (await this.states()).get(reservationId);
      if (!s) return { ok: false, overrun: false, actualMicro: 0, detail: 'reserva inexistente' };
      if (s.status !== 'open') return { ok: false, overrun: false, actualMicro: 0, detail: `reserva já ${s.status}` };
      await this.store.append({
        seq: (await this.store.readAll()).length + 1,
        at: at.toISOString(),
        monthKey: s.monthKey,
        type: 'pending',
        reservationId,
        reason,
      });
      return { ok: true, overrun: false, actualMicro: 0, detail: 'pendente de conciliação' };
    });
  }

  async commit(reservationId: string, actualUsd: number, at: Date): Promise<CommitResult> {
    return this.locked(async () => {
      const states = await this.states();
      const s = states.get(reservationId);
      if (!s) return { ok: false, overrun: false, actualMicro: 0, detail: 'reserva inexistente' };
      if (s.status !== 'open' && s.status !== 'pending') {
        return { ok: false, overrun: false, actualMicro: 0, detail: `reserva já ${s.status}` };
      }
      const actualMicro = usdToMicro(actualUsd);
      const overrun = actualMicro > s.reservedMicro;
      await this.store.append({
        seq: (await this.store.readAll()).length + 1,
        at: at.toISOString(),
        monthKey: s.monthKey,
        type: 'commit',
        reservationId,
        actualMicro,
        overrun,
      });
      return {
        ok: true,
        overrun,
        actualMicro,
        detail: overrun ? 'custo real acima da reserva: registrado e sinalizado' : 'conciliado',
      };
    });
  }

  // Libera só reserva que nunca teve resultado incerto (rejeição com status sem cobrança).
  async release(reservationId: string, reason: string, at: Date): Promise<CommitResult> {
    return this.locked(async () => {
      const s = (await this.states()).get(reservationId);
      if (!s) return { ok: false, overrun: false, actualMicro: 0, detail: 'reserva inexistente' };
      if (s.status !== 'open') {
        return { ok: false, overrun: false, actualMicro: 0, detail: `reserva ${s.status}: só conciliação libera` };
      }
      await this.store.append({
        seq: (await this.store.readAll()).length + 1,
        at: at.toISOString(),
        monthKey: s.monthKey,
        type: 'release',
        reservationId,
        reason,
      });
      return { ok: true, overrun: false, actualMicro: 0, detail: 'liberada' };
    });
  }

  // Liberação de reserva pendente, só com evidência de não cobrança (ex.: consulta de geração).
  async releaseConciliated(reservationId: string, evidence: string, at: Date): Promise<CommitResult> {
    return this.locked(async () => {
      if (evidence.trim().length === 0) {
        return { ok: false, overrun: false, actualMicro: 0, detail: 'evidência vazia: liberação recusada' };
      }
      const s = (await this.states()).get(reservationId);
      if (!s) return { ok: false, overrun: false, actualMicro: 0, detail: 'reserva inexistente' };
      if (s.status !== 'pending') return { ok: false, overrun: false, actualMicro: 0, detail: `reserva ${s.status}: não está pendente` };
      await this.store.append({
        seq: (await this.store.readAll()).length + 1,
        at: at.toISOString(),
        monthKey: s.monthKey,
        type: 'release',
        reservationId,
        reason: 'conciliada sem cobrança',
        evidence,
      });
      return { ok: true, overrun: false, actualMicro: 0, detail: 'liberada após conciliação' };
    });
  }

  // Compra de crédito no OpenRouter: custo registrado à parte e fora do teto (DP-11/P3).
  async recordRefillFee(amountUsd: number, at: Date): Promise<void> {
    await this.locked(async () => {
      await this.store.append({
        seq: (await this.store.readAll()).length + 1,
        at: at.toISOString(),
        monthKey: monthKey(at),
        type: 'refill_fee',
        reservationId: `fee-${at.toISOString()}`,
        amountMicro: usdToMicro(amountUsd),
      });
    });
  }
}
