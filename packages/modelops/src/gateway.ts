// Gateway: roteia, retém saldo, reserva, chama o cliente, checa a evidência e concilia. Não guarda estado próprio:
// todo estado de orçamento fica no BudgetGate (ledger) e no BalanceGuard (saldo do provedor).
import { isEnabled, qualificationCallAllowed, type FlagState } from '@ln/contracts';
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
  /** Modo qualification (ADR-021): id do candidato na política (ex.: claude-haiku-5-5). Ignorado nos demais modos. */
  candidate?: string;
  /** Modo qualification, política v7: etapa do protocolo ('1' = US$ 5, '2' = US$ 10). Obrigatória quando a política tem `stage_caps_usd`. */
  stage?: '1' | '2';
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
  // Qualificação (T6, ADR-021): caminho próprio, sem roteamento por tarefa de produção, sem fallback e com pool e teto próprios.
  if (call.mode === 'qualification') return callQualification(deps, call);

  // Gate de chamada real: production_enabled E a flag modelosHabilitados. Qualquer um desligado bloqueia.
  if (call.mode === 'production' && !realCallsAllowed(deps.policy, isEnabled('modelosHabilitados', deps.flags))) {
    return {
      status: 'blocked',
      reason: 'model_calls_disabled',
      detail: 'chamada real exige production_enabled = true e a flag modelosHabilitados ligada',
    };
  }

  // G4.3: em produção, o portão de saldo (BalanceGuard) é obrigatório. Ele lê o saldo antes da primeira retenção.
  if (call.mode === 'production' && !deps.balance) {
    return {
      status: 'blocked',
      reason: 'balance_guard_missing',
      detail: 'chamada de produção sem portão de saldo do provedor: saldo precisa ser lido antes da primeira chamada',
    };
  }

  // Parada persistida (global e por rota), lida a cada chamada.
  const kill = await deps.gate.killState();
  const decision = route(deps.policy, {
    ...call,
    killGlobal: call.killGlobal === true || kill.global,
    killedRoutes: [...(call.killedRoutes ?? []), ...kill.routes],
  });
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
      route: decision.route,
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
    const commit = await deps.gate.commit(reserve.reservationId, costUsd, call.now, response.id);
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
  | { kind: 'charged'; costUsd: number; generationId: string }
  | { kind: 'not_charged'; evidence: string }
  | { kind: 'unknown' }
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
    await deps.gate.commit(reservationId, result.costUsd, at, result.generationId);
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

// ---------------------------------------------------------------------------------------------------------------------
// Modo `qualification` (T6, ADR-021). NÃO é produção: roda com `production_enabled=false`, só candidatos do protocolo, tarefa
// `model_qualification`, classe `public`, ZDR em TODA chamada, sem fallback, pool `qualification` dentro de `cap_usd` (US$ 5; conta
// no teto de US$ 50 e não toca a reserva de auditoria), kill switch e evidência por chamada. Ligar o modo é mudança protegida da política
// (`qualification.mode.enabled`) e exige a flag `modelosHabilitados`. Qualquer recusa acontece ANTES de reservar ou enviar.
// ---------------------------------------------------------------------------------------------------------------------
const QUALIFICATION_ROUTE = 'qualification';

async function callQualification(deps: GatewayDeps, call: GatewayCall): Promise<GatewayOutcome> {
  const blocked = (reason: string, detail: string): GatewayOutcome => ({ status: 'blocked', reason, detail });
  const mode = deps.policy.qualification?.mode;
  if (!mode) return blocked('qualification_absent', 'a política não define o modo de qualificação');
  if (!mode.enabled) return blocked('qualification_disabled', 'modo de qualificação desligado na política');
  if (deps.policy.rules.production_enabled) return blocked('qualification_requires_production_off', 'qualificar exige production_enabled=false');
  if (!isEnabled('modelosHabilitados', deps.flags)) return blocked('model_calls_disabled', 'chamada real exige a flag modelosHabilitados ligada');
  if (call.task !== mode.task) return blocked('qualification_task', `no modo de qualificação só a tarefa ${mode.task}`);
  if (call.dataClasses.length === 0 || call.dataClasses.some((c) => c !== mode.data_class)) {
    return blocked('qualification_data_class', `no modo de qualificação só a classe ${mode.data_class}`);
  }

  const id = call.candidate;
  if (!id) return blocked('qualification_candidate', 'informe o candidato a qualificar');
  const model = deps.policy.models.find((m) => m.id === id);
  if (mode.excluded.includes(id) || (model as { excluded_by?: string } | undefined)?.excluded_by) {
    return blocked('qualification_excluded', `${id} está excluído da qualificação`);
  }
  if (!model || !mode.candidates.includes(id)) return blocked('qualification_candidate', `${id} não é candidato do protocolo`);
  // o contrato valida o documento inteiro; o portão só lê `rules.production_enabled` e `qualification.mode` (o modelops tipa a política de forma local)
  if (!qualificationCallAllowed(deps.policy as unknown as Parameters<typeof qualificationCallAllowed>[0], { model: id, task: call.task, dataClass: mode.data_class })) {
    return blocked('qualification_not_allowed', 'o contrato não permite esta chamada de qualificação');
  }
  const binding = model.binding;
  if (!binding) return blocked('unknown_cost', `${id} sem vínculo de preço`);

  // Teto da etapa (v7): a política manda `stage_caps_usd`; sem a etapa (ou etapa sem teto) não há chamada. v6: só `cap_usd`.
  const stageCaps = mode.stage_caps_usd;
  let stageCapUsd: number | undefined;
  if (stageCaps && Object.keys(stageCaps).length > 0) {
    if (!call.stage) return blocked('qualification_stage', 'informe a etapa (1 ou 2): a política define teto por etapa');
    stageCapUsd = stageCaps[call.stage];
    if (stageCapUsd === undefined) return blocked('qualification_stage', `a política não tem teto para a etapa ${call.stage}`);
  }
  const stageTaskId = call.stage && stageCapUsd !== undefined ? `${call.task}:${call.stage}` : call.task;

  // Parada persistida (global e por rota `qualification`), somada à que o chamador informar.
  const kill = await deps.gate.killState();
  if (call.killGlobal === true || kill.global) return blocked('kill_global', 'parada global ativa');
  if ((call.killedRoutes ?? []).includes(QUALIFICATION_ROUTE) || kill.routes.includes(QUALIFICATION_ROUTE)) {
    return blocked('kill_route', `rota ${QUALIFICATION_ROUTE} parada`);
  }

  const micro = estimateMicro(model, call.estimate);
  if (micro === null) return blocked('unknown_cost', 'custo máximo não estimado');
  const amountUsd = microToUsd(micro);
  // A reserva (custo máximo estimado) nunca pode passar do teto da etapa: recusa ANTES de segurar saldo e de enviar.
  if (stageCapUsd !== undefined && amountUsd > stageCapUsd) {
    return blocked('qualification_cap', `custo máximo estimado US$ ${amountUsd} acima do teto da etapa ${call.stage} (US$ ${stageCapUsd})`);
  }

  const guard = deps.balance;
  if (guard) {
    const held = await guard.hold(amountUsd);
    if (!held.ok) return blocked('budget_refused', held.reason);
  }

  const reserve = await deps.gate.reserve({
    taskId: stageTaskId,
    ...(stageCapUsd !== undefined ? { qualificationStageCapUsd: stageCapUsd } : {}),
    taskClass: 'non_essential', // a reserva de qualificação não usa degrau; a classe só rotula o registro
    lane: 'text',
    route: QUALIFICATION_ROUTE,
    provider: model.provider,
    model: binding.openrouter_id,
    escalation: false,
    qualification: true,
    amountUsd,
    at: call.now,
  });
  if (!reserve.ok) {
    if (guard) await guard.settle(amountUsd, 0);
    return blocked('budget_refused', reserve.reason);
  }

  let response: OpenRouterResponse;
  try {
    response = await deps.client.chat(
      buildRequestBody({ openrouterId: binding.openrouter_id, messages: call.messages, maxTokens: call.estimate.maxOutputTokens, zdrRequired: mode.provider_zdr_per_call, allowFallbacks: mode.allow_fallbacks }),
    );
  } catch (err) {
    if (err instanceof ProviderRejectedError) {
      await deps.gate.release(reserve.reservationId, `rejeitado HTTP ${err.status}, sem cobrança`, call.now);
      if (guard) await guard.settle(amountUsd, 0);
      return { status: 'blocked', reason: 'provider_rejected', detail: `rejeitado HTTP ${err.status}; sem fallback no modo de qualificação`, attempts: 1 };
    }
    await deps.gate.markPending(reserve.reservationId, `resultado incerto: ${errorLabel(err)}`, call.now);
    return {
      status: 'blocked',
      reason: 'pending_reconciliation',
      detail: 'resultado incerto depois do envio: reserva mantida como pendente',
      reservationId: reserve.reservationId,
      attempts: 1,
    };
  }

  const reportedUsd = response.usage?.cost;
  const costUsd = typeof reportedUsd === 'number' && Number.isFinite(reportedUsd) && reportedUsd >= 0 ? reportedUsd : amountUsd;
  const commit = await deps.gate.commit(reserve.reservationId, costUsd, call.now, response.id);
  if (guard) await guard.settle(amountUsd, costUsd);

  // Custo real acima da reserva (que já cabe no teto da etapa): o gasto ficou gravado como realmente foi, mas a chamada NÃO vale
  // como qualificação. Nunca `ok` com `overrun`: estourou o que foi autorizado, então a rodada é bloqueada.
  if (!commit.ok || commit.overrun || costUsd > amountUsd || (stageCapUsd !== undefined && costUsd > stageCapUsd)) {
    return {
      status: 'blocked',
      reason: 'qualification_cost_overrun',
      detail: `custo real US$ ${costUsd} acima do reservado (US$ ${amountUsd})${stageCapUsd !== undefined ? ` / teto da etapa ${call.stage} (US$ ${stageCapUsd})` : ''}; não conta como qualificação`,
      reservationId: reserve.reservationId,
      costUsd,
      attempts: 1,
    };
  }

  // Evidência por chamada (review_evidence.required): sem ela a chamada custou, conta no teto, e a saída não vale como qualificação.
  const missing = checkEvidence(response);
  if (missing.length > 0) {
    return { status: 'blocked', reason: 'evidence_invalid', detail: `faltam: ${missing.join(', ')}`, reservationId: reserve.reservationId, costUsd, attempts: 1 };
  }
  // A evidência precisa ser do modelo PEDIDO pelo gateway (`openrouter_id` ou `canonical_slug`): resposta de outro modelo custou, mas não qualifica.
  const requested = new Set([binding.openrouter_id, binding.canonical_slug]);
  const answered = [response.model, response.generation?.model].filter((m): m is string => typeof m === 'string' && m !== '');
  if (answered.length === 0 || answered.some((m) => !requested.has(m))) {
    return {
      status: 'blocked',
      reason: 'evidence_model_mismatch',
      detail: `pedido ${binding.openrouter_id}; respondeu ${answered.join(' / ') || '(sem modelo)'}; não conta como qualificado`,
      reservationId: reserve.reservationId,
      costUsd,
      attempts: 1,
    };
  }
  return { status: 'ok', model: binding.openrouter_id, response, reservationId: reserve.reservationId, attempts: 1, costUsd, overrun: false };
}
