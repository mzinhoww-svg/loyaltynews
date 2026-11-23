// Composição do gateway de modelos (G4.3): UM lugar monta política + ledger PostgreSQL + cliente + portão de saldo, para que nenhuma rota
// do app construa as peças soltas (e esqueça o portão de saldo ou o ledger).
//  - Ledger: sempre `PostgresLedgerStore` (ADR-020), a única porta de escrita.
//  - Cliente: `selectClient` (simulado por padrão; real só com a flag `modelosHabilitados` E produção ligada, ou, no modo `qualification`,
//    com o modo LIGADO na política e production_enabled=false). Real sem chave = erro explícito.
//  - Portão de saldo: cliente REAL sempre vem com `BalanceGuard` (saldo do provedor lido antes da primeira chamada). Simulado não precisa.
//  - Conciliação com `/generation`: `reader` pronto para `reconcileMonth` / `generationProbe` (G4.2), só quando há chave.
import type { FlagState } from '@ln/contracts';
import { BalanceGuard } from './balance';
import { BudgetGate, gateConfigFromPolicy } from './budget';
import { PostgresLedgerStore, type SqlDatabase } from './budget-pg';
import type { GatewayDeps } from './gateway';
import type { LedgerStore } from './ledger';
import { createOpenRouterCreditsReader, selectClient } from './openrouter-client';
import { SimulatedOpenRouterClient } from './openrouter.mock';
import { createOpenRouterGenerationReader, type GenerationReader } from './reconcile';
import type { ModelPolicy } from './types';

export interface ModelGatewayEnv {
  OPENROUTER_API_KEY?: string | undefined;
}

export interface ModelGateway {
  deps: GatewayDeps;
  /** Verdadeiro quando o cliente fala com a rede (nunca no simulado). */
  real: boolean;
  /** Leitor de `/generation` para a conciliação; só existe com chave. */
  generationReader?: GenerationReader;
}

export interface BuildModelGatewayOptions {
  policy: ModelPolicy;
  /** Banco PostgreSQL (drizzle). Em testes, pode-se passar um `ledgerStore` pronto. */
  db?: SqlDatabase;
  ledgerStore?: LedgerStore;
  flags?: Partial<FlagState>;
  /** 'production' (padrão) ou 'qualification' (ADR-021). */
  mode?: 'production' | 'qualification';
  fetchImpl?: typeof fetch;
  /** Leituras de saldo a cada N retenções (padrão 10). */
  balanceRefreshEvery?: number;
}

export function buildModelGateway(env: ModelGatewayEnv, opts: BuildModelGatewayOptions): ModelGateway {
  const store = opts.ledgerStore ?? (opts.db ? new PostgresLedgerStore(opts.db) : undefined);
  if (!store) throw new Error('gateway de modelos sem ledger: informe o banco PostgreSQL (ADR-020)');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = env.OPENROUTER_API_KEY?.trim() || undefined;

  const client = selectClient({ policy: opts.policy, flags: opts.flags, mode: opts.mode ?? 'production', ...(apiKey ? { apiKey } : {}) }, fetchImpl);
  const real = !(client instanceof SimulatedOpenRouterClient);
  const gate = new BudgetGate(gateConfigFromPolicy(opts.policy), store);

  const deps: GatewayDeps = { policy: opts.policy, gate, client, ...(opts.flags ? { flags: opts.flags } : {}) };
  let generationReader: GenerationReader | undefined;
  if (real) {
    // `selectClient` já recusou real sem chave; aqui a chave existe.
    deps.balance = new BalanceGuard(createOpenRouterCreditsReader(apiKey!, fetchImpl), opts.balanceRefreshEvery);
  }
  if (apiKey) generationReader = createOpenRouterGenerationReader(apiKey, fetchImpl);
  return { deps, real, ...(generationReader ? { generationReader } : {}) };
}
