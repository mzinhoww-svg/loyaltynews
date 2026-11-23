// Gateway: roteia, retém saldo, reserva, chama o cliente, checa a evidência e concilia. Não guarda estado próprio:
// todo estado de orçamento fica no BudgetGate (ledger) e no BalanceGuard (saldo do provedor).
import { isEnabled, type FlagState } from '@ln/contracts';
import { realCallsAllowed } from './policy';
import { route, TASK_CATALOG, isEscalation, type RouteRequest } from './router';
import type { BudgetGate } from './budget';
import type { BalanceGuard } from './balance';
import { microToUsd } from './money';
import { estimateMicro, type TokenEstimate } from './pricing';
import {
  buildRequestBody,
  checkEvidence,
  ProviderRejectedError,
  type ChatMessage,
  type OpenRouterClient,
  type OpenRouterResponse,
} from './openrouter';
import type { ModelPolicy } from './types';

export interface GatewayCall extends RouteRequest {
  messages: ChatMessage[];
  estimate: TokenEstimate;
}

export interface GatewayDeps {
  policy: ModelPolicy;
  gate: BudgetGate;
  client: OpenRouterClient;
  balance?: BalanceGuard; // saldo do provedor; obrigatório em chamadas reais
  flags?: Partial<FlagState>; // overrides de flags (padrão: todas desligadas)
}

export type GatewayOutcome =
  | { status: 'deterministic' }
  | {
      status: 'blocked';
      reason: string;
      detail: string;
      reservationId?: string;
      costUsd?: number;
      attempts?: number;
    }
  | {
      status: 'ok';
      model: string;
      response: OpenRouterResponse;
      reservationId: string;
      attempts: number;
      costUsd: number;
      overrun: boolean;
    };

function errorLabel(err: unknown): string {
  return err instanceof Error ? err.message : 'erro desconhecido';
}

export async function callModel(deps: GatewayDeps, call: GatewayCall): Promise<GatewayOutcome> {
  // Gate de chamada real: production_enabled E a flag modelosHabilitados. Qualquer um desligado bloqueia.
  if (call.mode === 'production' && !realCallsAllowed(deps.policy, isEnabled('modelosHabilitados', deps.flags))) {
    return {
      status: 'blocked',
      reason: 'model_calls_disabled',
      detail: 'chamada real exige production_enabled = true e a flag modelosHabilitados ligada',
    };
  }

  const decision = route(deps.policy, call);
  if (decision.status === 'deterministic') return { status: 'deterministic' };
  if (decision.status === 'blocked') return { status: 'blocked', reason: decision.reason, detail: decision.detail };

  const spec = TASK_CATALOG[call.task];
  if (!spec) return { status: 'blocked', reason: 'unknown_task', detail: call.task };

  const guard = deps.balance;
  const draftAuthor = call.draftModelId ? call.draftModelId.split('/')[0] : undefined;
  const ordered = [decision.primary, ...decision.fallbacks];
  let attempts = 0;
  let lastRefusal = 'sem_candidato';

  for (const id of ordered) {
    const model = deps.policy.models.find((m) => m.id === id);
    const binding = model?.binding;
    if (!model || !binding) {
      lastRefusal = 'unknown_cost';
      continue;
    }

    const micro = estimateMicro(model, call.estimate);
    if (micro === null) {
      lastRefusal = 'unknown_cost';
      continue;
    }
    const amountUsd = microToUsd(micro);

    // 1. Saldo do provedor: retém o valor máximo antes de reservar.
    if (guard) {
      const held = await guard.hold(amountUsd);
      if (!held.ok) {
        lastRefusal = held.reason;
        continue;
      }
    }

    // 2. Reserva no teto. Recusa libera a retenção de saldo e passa ao próximo candidato da mesma classe.
    const reserve = await deps.gate.reserve({
      taskId: call.task,
      taskClass: decision.taskClass,
      lane: decision.lane,
      provider: model.provider,
      model: binding.openrouter_id,
      escalation: isEscalation(id, decision.taskClass),
      amountUsd,
      at: call.now,
    });
    if (!reserve.ok) {
      if (guard) await guard.settle(amountUsd, 0);
      lastRefusal = reserve.reason;
      continue;
    }

    // 3. Chamada. Só rejeição com status sem cobrança libera e segue ao fallback.
    //    Qualquer outro erro depois do envio é incerto: a reserva fica pendente e não há fallback automático.
    attempts += 1;
    let response: OpenRouterResponse;
    try {
      response = await deps.client.chat(
        buildRequestBody({
          openrouterId: binding.openrouter_id,
          messages: call.messages,
          maxTokens: call.estimate.maxOutputTokens,
          zdrRequired: call.unpublished && decision.taskClass === 'essential',
        }),
      );
    } catch (err) {
      if (err instanceof ProviderRejectedError) {
        await deps.gate.release(reserve.reservationId, `rejeitado HTTP ${err.status}, sem cobrança`, call.now);
        if (guard) await guard.settle(amountUsd, 0);
        lastRefusal = 'provider_rejected';
        continue;
      }
      await deps.gate.markPending(reserve.reservationId, `resultado incerto: ${errorLabel(err)}`, call.now);
      return {
        status: 'blocked',
        reason: 'pending_reconciliation',
        detail: 'resultado incerto depois do envio: reserva mantida como pendente; sem fallback automático',
        reservationId: reserve.reservationId,
        attempts,
      };
    }

    // 4. Conciliação: custo real do provedor. Sem custo informado, a reserva fica como custo (conservador).
    const reportedUsd = response.usage?.cost;
    const costUsd = typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) ? reportedUsd : amountUsd;
    const commit = await deps.gate.commit(reserve.reservationId, costUsd, call.now);
    if (guard) await guard.settle(amountUsd, costUsd);

    // 5. Evidência incompleta: a chamada custou e conta no teto, mas a saída não é aceita.
    const missing = checkEvidence(response);
    if (missing.length > 0) {
      return {
        status: 'blocked',
        reason: 'evidence_invalid',
        detail: `faltam: ${missing.join(', ')}`,
        reservationId: reserve.reservationId,
        costUsd,
        attempts,
      };
    }

    // 6. Checagem independente: o modelo que respondeu não pode ser do mesmo autor do redator.
    if (spec.requiresDistinctAuthor && draftAuthor) {
      const responseAuthor = (response.generation?.model ?? response.model ?? '').split('/')[0];
      if (responseAuthor === draftAuthor) {
        return {
          status: 'blocked',
          reason: 'response_same_author',
          detail: 'autor da resposta igual ao do redator',
          reservationId: reserve.reservationId,
          costUsd,
          attempts,
        };
      }
    }

    return {
      status: 'ok',
      model: binding.openrouter_id,
      response,
      reservationId: reserve.reservationId,
      attempts,
      costUsd,
      overrun: commit.overrun,
    };
  }

  if (attempts === 0) {
    return { status: 'blocked', reason: 'budget_refused', detail: lastRefusal };
  }
  return { status: 'blocked', reason: 'provider_failed', detail: lastRefusal, attempts };
}

// Resultado da consulta de conciliação de uma reserva pendente.
export type ReconcileProbe = () => Promise<
  { kind: 'charged'; costUsd: number } | { kind: 'not_charged'; evidence: string } | { kind: 'unknown' }
>;

export type ReconcileOutcome = 'committed' | 'released' | 'still_pending' | 'refused';

// Concilia uma reserva pendente. Só sai de pendente com evidência: cobrança confirmada ou ausência de cobrança.
// Sem prova, continua pendente e segue contando no teto.
export async function reconcilePending(
  deps: GatewayDeps,
  reservationId: string,
  probe: ReconcileProbe,
  at: Date,
): Promise<ReconcileOutcome> {
  const state = await deps.gate.statusOf(reservationId);
  if (!state || state.status !== 'pending') return 'refused';

  const heldUsd = microToUsd(state.reservedMicro);
  const result = await probe();
  if (result.kind === 'charged') {
    await deps.gate.commit(reservationId, result.costUsd, at);
    if (deps.balance) await deps.balance.settle(heldUsd, result.costUsd);
    return 'committed';
  }
  if (result.kind === 'not_charged') {
    const rel = await deps.gate.releaseConciliated(reservationId, result.evidence, at);
    if (!rel.ok) return 'refused';
    if (deps.balance) await deps.balance.settle(heldUsd, 0);
    return 'released';
  }
  return 'still_pending';
}
