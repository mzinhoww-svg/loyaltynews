// @ln/modelops — Gateway de modelos, roteamento e orçamento.
// Dono: Frente 11 — LN Backend Engineer + FinOps. Código determinístico; sem chamadas reais por padrão.
export const PACKAGE_NAME = '@ln/modelops' as const;

export * from './types';
export { validatePolicy, loadPolicyFile } from './policy';
export { MICRO_PER_USD, usdToMicro, microToUsd, priceToMicroPerMtok, tokensToMicro } from './money';
export { monthKey } from './month';
export { MemoryLedgerStore, replay, spentMicro, type LedgerEvent, type LedgerIO, type LedgerStore, type KillState, type ReservationState, type Lane } from './ledger';
// Única porta de escrita do ledger de orçamento em produção (ADR-020): tabelas budget_* de @ln/db.
export { PostgresLedgerStore, type SqlDatabase, type SqlRunner } from './budget-pg';
export { BudgetGate, gateConfigFromPolicy, type GateConfig, type ReserveInput, type ReserveResult, type ReserveRefusal, type Snapshot, type CommitResult } from './budget';
export { route, TASK_CATALOG, ESSENTIAL_RITUALS, isEscalation, type RouteRequest, type RouteDecision, type TaskSpec } from './router';
export { estimateMicro, type TokenEstimate } from './pricing';
export { buildRequestBody, checkEvidence, isNoChargeStatus, ProviderRejectedError, type OpenRouterBody, type OpenRouterClient, type OpenRouterResponse, type ChatMessage } from './openrouter';
export { SimulatedOpenRouterClient, type SimulatedOptions } from './openrouter.mock';
export { selectClient, createRealOpenRouterClient, createOpenRouterCreditsReader, OPENROUTER_URL, OPENROUTER_CREDITS_URL, type ClientConfig } from './openrouter-client';
export { BalanceGuard, type HoldResult } from './balance';
export { callModel, reconcilePending, type GatewayCall, type GatewayDeps, type GatewayOutcome, type ReconcileProbe, type ReconcileOutcome } from './gateway';
// G4.2: conciliação do ledger com o provedor (`/generation`) e replay mensal com tolerância; G4.3: composição do gateway.
export { createOpenRouterGenerationReader, generationProbe, reconcileMonth, describeReconciliation, OPENROUTER_GENERATION_URL, type GenerationReader, type GenerationRecord, type MonthReconciliation, type ReconcileItem } from './reconcile';
export { buildModelGateway, type ModelGateway, type ModelGatewayEnv, type BuildModelGatewayOptions } from './compose';
