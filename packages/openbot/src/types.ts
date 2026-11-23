// Tipos do adaptador OpenBot (ADR-003). O OpenBot executa e coordena os agentes; estado, filas, outbox e orçamento
// ficam no banco do projeto. O adaptador funciona por PULL com lease, iniciado pelo OpenBot (só conexão de saída),
// com callback assinado e idempotente. Redis/fila guardam só IDs: nenhum conteúdo editorial no payload.

/** Tarefas que podem ir ao OpenBot. Espelha o catálogo do modelops, MENOS as determinísticas de publicação. */
export const DISPATCHABLE_KINDS = [
  'editorial_draft',
  'fact_check',
  'classification',
  'daily',
  'entity_resolution',
  'monthly_board',
  'complex_analysis',
  'concept_image',
  'ritual',
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
  resultRef?: string;
  lastError?: string;
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
}

export interface UsageReport {
  /** Id da execução no OpenBot: dedupe do custo. */
  executionId: string;
  taskId: string;
  leaseId: string;
  model: string;
  /** Ids de geração no gateway/OpenRouter; base da conciliação. */
  generationIds: string[];
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Custo em micro-USD (inteiro). Custo ausente ou desconhecido é recusado (bloqueio por preço desconhecido). */
  costMicro: number;
}

export const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
