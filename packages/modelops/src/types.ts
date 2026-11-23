// Tipos da política de modelos (model.policy v4, DP-02/DP-04/DP-05).
// Somente tipos e constantes: o pacote roda com type stripping do Node (sem enum, sem namespace).

export type Provider = 'anthropic' | 'openai' | 'deepseek';

// Classes de tarefa e teto de gasto. Cada classe só entra enquanto o gasto projetado
// do mês (todas as bolsas) fica abaixo do degrau dela (DP-04 / ADR-015).
export type TaskClass = 'essential' | 'non_essential' | 'premium' | 'reserve';

// Bolsa de gasto: 'allocation' = verbas dos provedores (42); 'reserve' = reserva de 8 (exclusiva).
// 'qualification' = pool próprio do modo de qualificação (ADR-021): teto de US$ 5, sem a reserva de auditoria; conta no teto de US$ 50.
export type Pool = 'allocation' | 'reserve' | 'qualification';

export type DataClass =
  | 'public'
  | 'internal'
  | 'personal'
  | 'commercial_confidential'
  | 'restricted'
  | 'secret';

// Tarefas de auditoria que podem usar a reserva de 8 (DP-02 v5): correção, resposta/retratação e
// auditoria pós-publicação. Nomes = chaves de routing_by_task da política v5.
export const AUDIT_RESERVE_TASK_KEYS: readonly string[] = [
  'wf08_correction',
  'wf18_response_retraction',
  'postpublication_audit',
];

// Ordem do mais permissivo para o mais restrito. Classe de saída = a mais restrita das entradas.
export const DATA_CLASS_ORDER: readonly DataClass[] = [
  'public',
  'internal',
  'commercial_confidential',
  'personal',
  'restricted',
  'secret',
];

export interface PriceTier {
  min_prompt_tokens?: number;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  cache_write_1h?: number;
}

export interface ModelBinding {
  access_path: string;
  openrouter_id: string;
  canonical_slug: string;
  price_source: string;
  price_as_of: string;
  price_usd_per_mtok: PriceTier;
  long_context_overrides?: PriceTier[];
  structured_outputs?: boolean;
}

export interface ModelEntry {
  id: string;
  provider: string;
  capabilities: string[];
  input_peak: number | null;
  output_peak: number | null;
  candidate_only?: boolean;
  allowed_tasks?: string[];
  budget_allocation_usd?: number;
  binding?: ModelBinding;
  price_matches_openrouter_listing?: boolean;
  qualification?: string;
}

export interface PolicyRules {
  production_enabled: boolean;
  block_unknown_cost: boolean;
  max_attempts: number;
  max_escalations: number;
  soft_budget_fraction: number;
  price_expiry_days: number;
  hard_monthly_budget_usd: number;
  prompt_cache_required: boolean;
  budget_allocation_usd: BudgetAllocation;
  budget_steps_usd: Record<string, string>;
  [key: string]: unknown;
}

export interface BudgetAllocation {
  openai: number;
  anthropic: number;
  /** v5 (Opus e Fable). */
  anthropic_escalation_opus_fable_included?: number;
  /** v6/DP-26 (só Opus; Fable fora). */
  anthropic_escalation_opus_included?: number;
  images: number;
  /** Só na v5: a v6 (DP-26) remove o DeepSeek da divisão (ausente = 0). */
  deepseek?: number;
  audit_errata_reserve: number;
}

/** Modo de qualificação (T6, ADR-021). Desligado por padrão; exige production_enabled=false. */
export interface QualificationModeCfg {
  name: 'qualification';
  enabled: boolean;
  requires_production_enabled: false;
  task: 'model_qualification';
  data_class: 'public';
  candidates: string[];
  excluded: string[];
  provider_zdr_per_call: true;
  allow_fallbacks: false;
  cap_usd: number;
  uses_audit_reserve: false;
  [key: string]: unknown;
}

export interface ModelPolicy {
  version: string;
  rate_card_as_of: string;
  models: ModelEntry[];
  routes: Record<string, string[]>;
  rules: PolicyRules;
  routing_by_task: Record<string, string>;
  data_classes: Record<string, unknown>;
  qualification?: { mode?: QualificationModeCfg; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PolicyCheck {
  ok: boolean;
  errors: string[];
  policy?: ModelPolicy;
}
