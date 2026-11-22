// Gateway: roteia, reserva, chama o cliente, checa a evidência e concilia. Não guarda estado próprio:
// todo estado de orçamento fica no BudgetGate (ledger).
import { route, TASK_CATALOG, isEscalation, type RouteRequest } from './router.ts';
import type { BudgetGate } from './budget.ts';
import { microToUsd } from './money.ts';
import { estimateMicro, type TokenEstimate } from './pricing.ts';
import { buildRequestBody, checkEvidence, type ChatMessage, type OpenRouterClient, type OpenRouterResponse } from './openrouter.ts';
import type { ModelPolicy } from './types.ts';

export interface GatewayCall extends RouteRequest {
  messages: ChatMessage[];
  estimate: TokenEstimate;
}

export interface GatewayDeps {
  policy: ModelPolicy;
  gate: BudgetGate;
  client: OpenRouterClient;
}

export type GatewayOutcome =
  | { status: 'deterministic' }
  | { status: 'blocked'; reason: string; detail: string; costUsd?: number; attempts?: number }
  | {
      status: 'ok';
      model: string;
      response: OpenRouterResponse;
      reservationId: string;
      attempts: number;
      costUsd: number;
      overrun: boolean;
    };

export async function callModel(deps: GatewayDeps, call: GatewayCall): Promise<GatewayOutcome> {
  const decision = route(deps.policy, call);
  if (decision.status === 'deterministic') return { status: 'deterministic' };
  if (decision.status === 'blocked') return { status: 'blocked', reason: decision.reason, detail: decision.detail };

  const spec = TASK_CATALOG[call.task];
  if (!spec) return { status: 'blocked', reason: 'unknown_task', detail: call.task };

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

    // Reserva antes da chamada. Recusa de orçamento passa ao próximo candidato da mesma classe.
    const reserve = await deps.gate.reserve({
      taskId: call.task,
      taskClass: decision.taskClass,
      lane: decision.lane,
      provider: model.provider,
      model: binding.openrouter_id,
      escalation: isEscalation(id, decision.taskClass),
      amountUsd: microToUsd(micro),
      at: call.now,
    });
    if (!reserve.ok) {
      lastRefusal = reserve.reason;
      continue;
    }

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
    } catch {
      // Falha de provedor: libera a reserva (sem custo) e tenta o fallback lateral.
      await deps.gate.release(reserve.reservationId, 'erro de provedor', call.now);
      lastRefusal = 'provider_error';
      continue;
    }

    // Conciliação: custo real do provedor; sem custo informado, a reserva fica como custo (conservador).
    const reportedUsd = response.usage?.cost;
    const costUsd = typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) ? reportedUsd : microToUsd(micro);
    const commit = await deps.gate.commit(reserve.reservationId, costUsd, call.now);

    const missing = checkEvidence(response);
    if (missing.length > 0) {
      return { status: 'blocked', reason: 'evidence_invalid', detail: `faltam: ${missing.join(', ')}`, costUsd, attempts };
    }

    // Checagem independente: o modelo que respondeu não pode ser do mesmo autor do redator.
    if (spec.requiresDistinctAuthor && draftAuthor) {
      const responseAuthor = (response.generation?.model ?? response.model ?? '').split('/')[0];
      if (responseAuthor === draftAuthor) {
        return { status: 'blocked', reason: 'response_same_author', detail: 'autor da resposta igual ao do redator', costUsd, attempts };
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
