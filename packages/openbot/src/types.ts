// Tipos do adaptador OpenBot (ADR-003). O OpenBot executa e coordena os agentes; estado, filas, outbox e orçamento
// ficam no banco do projeto. O adaptador funciona por PULL com lease, iniciado pelo OpenBot (só conexão de saída),
// com callback assinado e idempotente. Redis/fila guardam só IDs: nenhum conteúdo editorial no payload.

/** Tarefas que podem ir ao OpenBot. Espelha o catálogo do modelops, MENOS as determinísticas de publicação. */
export const DISPATCHABLE_KINDS = [
  'editorial_draft',
  'editorial_review',
  'fact_check',
  'classification',
  'daily',
  'entity_resolution',
  'monthly_board',
  'complex_analysis',
  'concept_image',
  'ritual',
  /** Texto social (rascunho de LinkedIn) da etapa `social_pack` da Fábrica. É texto, não publicação: a publicação segue só do `publisher_social`. */
  'social_copy',
] as const;
export type TaskKind = (typeof DISPATCHABLE_KINDS)[number];

/**
 * Nunca vão ao OpenBot: a publicação é só do serviço determinista `publisher_social` (ADR-008, F-044).
 * Mesmo que alguém acrescente um destes à lista acima, o despacho recusa.
 */
export const NEVER_DISPATCH_KINDS = ['social_publish', 'publish', 'create_post', 'creative_composition', 'source_ingestion'] as const;

/** Classes de dado que o OpenBot recebe. Pessoal, sigiloso e restrito ficam bloqueados até haver lastro contratual (Blueprint §5). */
export const ALLOWED_DATA_CLASSES = ['public', 'internal'] as const;
export type AllowedDataClass = (typeof ALLOWED_DATA_CLASSES)[number];

export type TaskStatus = 'pending' | 'leased' | 'completed' | 'failed' | 'dead';

export interface NewTask {
  kind: TaskKind;
  /** Perfil (dos 64) que executa; a configuração vem do registro versionado, não do agente. */
  profileId: string;
  /** Id da linha de negócio (matéria, fonte, ritual). Nunca conteúdo. */
  refId: string;
  /** A mesma chave produz no máximo uma tarefa. */
  idempotencyKey: string;
  dataClass: AllowedDataClass;
  /** Teto de custo desta tarefa, em micro-USD (inteiro). */
  maxCostMicro: number;
  maxAttempts?: number;
  /** Rota de contas já resolvida pelo despachante (padrão por tipo). */
  route?: Account[];
}

export interface Task extends NewTask {
  id: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  leaseId?: string;
  leaseHolder?: string;
  leaseExpiresAt?: string;
  /** Só puxável a partir deste instante (limite da conta atingido: a tarefa espera a janela voltar; sem fallback). */
  availableAt?: string;
  resultRef?: string;
  lastError?: string;
  /** Rota de contas e posição atual (a via que deve executar agora). Redação tem rota de uma só via. */
  route: Account[];
  routeIndex: number;
  /** Quantas vezes uma conta bateu o limite (não conta como tentativa falha). */
  limitHits: number;
  /** Histórico de vias que bateram o limite: a conta usada fica registrada. */
  accountsLimited: { account: Account; at: string }[];
}

/** O que o OpenBot recebe ao puxar: IDs, o lease e os limites. */
export interface LeasedTask {
  id: string;
  kind: TaskKind;
  profileId: string;
  refId: string;
  dataClass: AllowedDataClass;
  maxCostMicro: number;
  attempt: number;
  leaseId: string;
  leaseExpiresAt: string;
  /** A via (conta) que deve executar esta entrega. Executar por outra conta é recusado no callback. */
  account: Account;
}

/**
 * Faixa de custo da execução. `api`: tarifada (OpenRouter/gateway), exige ids de geração e custo conhecido. `subscription`
 * (conta Claude ou Codex) e `opencode` (modelo gratuito): sem geração do OpenRouter, custo SEMPRE 0, modelo declarado.
 */
export const LANES = ['api', 'subscription', 'opencode', 'antigravity'] as const;
export type Lane = (typeof LANES)[number];
export const ACCOUNTS = ['claude', 'codex', 'opencode', 'antigravity'] as const;
export type Account = (typeof ACCOUNTS)[number];

/** Provedor do autor, derivado da conta (para provar independência redator × checador). */
export const PROVIDER_OF_ACCOUNT: Record<Account, string> = { claude: 'anthropic', codex: 'openai', opencode: 'opencode', antigravity: 'antigravity' };

/**
 * Autor (família do modelo) pelo id DECLARADO no UsageReport; cai na conta quando o id não permite concluir. A via Antigravity
 * hospeda modelos de várias famílias (Gemini, Claude, GPT-OSS): só o modelo declarado diz quem é o autor.
 */
export function providerOfModel(model: string | null | undefined, account: Account | 'deterministic'): string {
  const m = (model ?? '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gpt') || m.includes('codex') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('gemini')) return 'google';
  if (m.includes('deepseek')) return 'deepseek';
  if (account === 'deterministic') return 'deterministic';
  return PROVIDER_OF_ACCOUNT[account];
}

/**
 * Rota padrão de contas por tipo de tarefa (decisão do PM no piloto, 23/11): a primeira é a via preferida; se ela bate o limite,
 * a tarefa passa à próxima. Redação NUNCA troca de via (uma só). Substituível por `deps.routes`, com as mesmas invariantes.
 */
export const DEFAULT_ROUTES: Record<string, readonly Account[]> = {
  classification: ['opencode', 'claude', 'antigravity'],
  fact_check: ['codex', 'antigravity'],
  editorial_review: ['codex', 'antigravity'],
  editorial_draft: ['claude'],
  entity_resolution: ['claude'],
  social_copy: ['claude'],
};
export const FALLBACK_ROUTE: readonly Account[] = ['claude'];
/** Tipos que nunca trocam de via, mesmo que alguém configure outra rota. */
export const NEVER_SWITCH_KINDS = ['editorial_draft'] as const;

export interface UsageReport {
  /** Padrão `api`. Em `subscription`/`opencode` valem as regras da faixa gratuita (custo 0, sem geração obrigatória). */
  lane?: Lane;
  /** Obrigatória em `subscription` (claude|codex) e `opencode` (opencode). */
  account?: Account;
  /** Id da execução no OpenBot: dedupe do custo. */
  executionId: string;
  taskId: string;
  leaseId: string;
  model: string;
  /** Ids de geração no gateway/OpenRouter; base da conciliação. Obrigatório em `api` quando houve gasto; opcional nas faixas gratuitas. */
  generationIds?: string[];
  /** Tokens: obrigatórios em `api`; nas faixas gratuitas o OpenBot não os expõe (omitir = não medido, nunca zero inventado). */
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Custo em micro-USD (inteiro). Custo ausente ou desconhecido é recusado (bloqueio por preço desconhecido). */
  costMicro: number;
}

export const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
