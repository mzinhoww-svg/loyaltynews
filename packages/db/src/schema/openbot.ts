// Adaptador OpenBot (ADR-003) no PostgreSQL: fila com lease e rota de contas, dedupe de callback, custos por faixa, saúde, trilha e estado do piloto
// e armazém do conteúdo (TaskIo). Dono: Frente 02 — LN Backend Engineer. Valores em micro-USD INTEIROS. A fila nunca guarda conteúdo editorial: só ids
// de linha de negócio (`ref_id`) e limites; o conteúdo vive em `openbot_io`, lido e gravado só por API autenticada e presa ao lease.
// Migração reversível: `drizzle/down/0022_openbot_fila_custos.down.sql` (ver o teste `openbot-migracao.test.ts`).
import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const openbotTasks = pgTable(
  'openbot_tasks',
  {
    id: text('id').primaryKey(),
    /** Ordem de chegada (desempate estável do `claim`). */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    profileId: text('profile_id').notNull(),
    refId: text('ref_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    dataClass: text('data_class').notNull(),
    maxCostMicro: bigint('max_cost_micro', { mode: 'number' }).notNull(),
    maxAttempts: integer('max_attempts').notNull().default(5),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    leaseId: text('lease_id'),
    leaseHolder: text('lease_holder'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Só puxável a partir daqui (a conta bateu o limite e a tarefa espera a janela). */
    availableAt: timestamp('available_at', { withTimezone: true }),
    resultRef: text('result_ref'),
    lastError: text('last_error'),
    /** Rota de contas já resolvida pelo despachante e a posição atual (a via que executa agora). */
    route: jsonb('route').notNull().default(sql`'["claude"]'::jsonb`),
    routeIndex: integer('route_index').notNull().default(0),
    /** Quantas vezes uma conta bateu o limite (não conta como tentativa falha) e o histórico dessas vias. */
    limitHits: integer('limit_hits').notNull().default(0),
    accountsLimited: jsonb('accounts_limited').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex('openbot_tasks_idem_uq').on(t.idempotencyKey),
    index('openbot_tasks_claim_idx').on(t.status, t.seq),
    check('openbot_tasks_status', sql`${t.status} IN ('pending', 'leased', 'completed', 'failed', 'dead')`),
    check('openbot_tasks_data_class', sql`${t.dataClass} IN ('public', 'internal')`),
    check('openbot_tasks_cost', sql`${t.maxCostMicro} >= 1`),
    check('openbot_tasks_attempts', sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 10 AND ${t.limitHits} >= 0`),
    check('openbot_tasks_route', sql`jsonb_typeof(${t.route}) = 'array' AND jsonb_array_length(${t.route}) BETWEEN 1 AND 4 AND ${t.routeIndex} >= 0 AND ${t.routeIndex} < jsonb_array_length(${t.route})`),
    // lease coerente: tarefa 'leased' sempre tem id, detentor e validade
    check('openbot_tasks_lease', sql`${t.status} <> 'leased' OR (${t.leaseId} IS NOT NULL AND ${t.leaseHolder} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`),
  ],
);

/** Dedupe de `callbackId`: a primeira inserção vence (chave primária); repetição não tem efeito. */
export const openbotCallbacks = pgTable('openbot_callbacks', {
  callbackId: text('callback_id').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
});

/** Custo relatado pelo OpenBot, deduplicado por `execution_id`. Nunca apagado (trilha de custo). Faixa gratuita: custo 0 e tokens/geração opcionais. */
export const openbotCostEntries = pgTable(
  'openbot_cost_entries',
  {
    executionId: text('execution_id').primaryKey(),
    taskId: text('task_id').notNull().references(() => openbotTasks.id),
    leaseId: text('lease_id').notNull(),
    lane: text('lane').notNull().default('api'),
    account: text('account'),
    model: text('model').notNull(),
    generationIds: jsonb('generation_ids'),
    /** Nulo = não medido (o OpenBot não expõe tokens nas faixas gratuitas): nunca um zero inventado. */
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    costMicro: bigint('cost_micro', { mode: 'number' }).notNull(),
    /** Passou do teto da tarefa: registrado mesmo assim (nunca esconder estouro). */
    overrun: boolean('overrun').notNull(),
    monthKey: text('month_key').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('openbot_cost_month_idx').on(t.monthKey),
    check('openbot_cost_lane', sql`${t.lane} IN ('api', 'subscription', 'opencode', 'antigravity')`),
    check('openbot_cost_account', sql`${t.account} IS NULL OR ${t.account} IN ('claude', 'codex', 'opencode', 'antigravity')`),
    check('openbot_cost_nonneg', sql`${t.costMicro} >= 0 AND (${t.promptTokens} IS NULL OR ${t.promptTokens} >= 0) AND (${t.completionTokens} IS NULL OR ${t.completionTokens} >= 0) AND (${t.cacheReadTokens} IS NULL OR ${t.cacheReadTokens} >= 0) AND (${t.cacheWriteTokens} IS NULL OR ${t.cacheWriteTokens} >= 0)`),
    // faixa gratuita nunca tem custo: o piloto só vale com custo 0 fora da faixa `api`
    check('openbot_cost_free_lane', sql`${t.lane} = 'api' OR ${t.costMicro} = 0`),
    check('openbot_cost_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/** Último pull recebido (linha única `pull`): é o que diz se o OpenBot está vivo. */
export const openbotHealth = pgTable(
  'openbot_health',
  {
    id: text('id').primaryKey(),
    workerId: text('worker_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [check('openbot_health_id', sql`${t.id} = 'pull'`)],
);

/** Trilha do piloto: UMA linha por execução (a da planilha do AgentOps). `row` guarda a PilotRow inteira; as colunas soltas servem a índices e filtros. */
export const openbotPilotRows = pgTable(
  'openbot_pilot_rows',
  {
    taskId: text('task_id').notNull(),
    attempt: integer('attempt').notNull(),
    stage: text('stage').notNull(),
    account: text('account').notNull(),
    outcome: text('outcome').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    row: jsonb('row').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.attempt] }),
    index('openbot_pilot_rows_started_idx').on(t.startedAt, t.taskId, t.attempt),
    check('openbot_pilot_rows_outcome', sql`${t.outcome} IN ('completed', 'failed', 'retryable', 'pending_limit')`),
    check('openbot_pilot_rows_attempt', sql`${t.attempt} >= 0`),
  ],
);

/** Estado do piloto: linha única `pilot`. Existe = piloto em PARADA IMEDIATA, com os motivos (acumulados); sem linha = liberado. */
export const openbotPilotState = pgTable(
  'openbot_pilot_state',
  {
    id: text('id').primaryKey(),
    reasons: jsonb('reasons').notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('openbot_pilot_state_id', sql`${t.id} = 'pilot'`), check('openbot_pilot_state_reasons', sql`jsonb_typeof(${t.reasons}) = 'array' AND jsonb_array_length(${t.reasons}) >= 1`)],
);

/** Armazém do CONTEÚDO (TaskIo): a entrada de cada tarefa (por `ref_id`) e o resultado (por `result_ref`), lidos e gravados só por API autenticada e presa ao lease. */
export const openbotIo = pgTable(
  'openbot_io',
  {
    ref: text('ref').primaryKey(),
    direction: text('direction').notNull(),
    content: jsonb('content').notNull(),
    taskClass: text('task_class'),
    promptVersion: text('prompt_version'),
    /** Só na entrada: metadados que o agente precisa (ex.: `reviewedDraftTaskId` da checagem/revisão). */
    meta: jsonb('meta'),
    /** Só no resultado: a tarefa e a tentativa que o gravaram. */
    taskId: text('task_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('openbot_io_direction', sql`${t.direction} IN ('input', 'result')`),
    // o teto de tamanho também vale no banco (a rota recusa antes, com 413): entrada até 512 KB (rascunho + evidências), resultado até 256 KB
    check('openbot_io_size', sql`octet_length(${t.content}::text) <= CASE WHEN ${t.direction} = 'input' THEN 524288 ELSE 262144 END`),
  ],
);

/**
 * Violações do piloto TRATADAS por um admin (decisão PM-2026-11-23-D): libera o despacho e a retomada, mas NÃO apaga nem edita a linha da planilha e a violação continua
 * contando no critério de 0 violações da avaliação final (a planilha a mostra como "tratada por X em Y, motivo Z"). Uma resolução por (tarefa, tentativa).
 * Migração reversível: `drizzle/down/0028_openbot_pilot_resolutions.down.sql`.
 */
export const openbotPilotResolutions = pgTable(
  'openbot_pilot_resolutions',
  {
    taskId: text('task_id').notNull(),
    attempt: integer('attempt').notNull(),
    resolvidoPor: text('resolvido_por').notNull(),
    resolvidoEm: timestamp('resolvido_em', { withTimezone: true }).notNull(),
    motivo: text('motivo').notNull(),
    acaoTomada: text('acao_tomada').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.attempt] }),
    foreignKey({ columns: [t.taskId, t.attempt], foreignColumns: [openbotPilotRows.taskId, openbotPilotRows.attempt], name: 'openbot_pilot_resolutions_row_fk' }),
    check('openbot_pilot_resolutions_motivo', sql`char_length(btrim(${t.motivo})) BETWEEN 10 AND 500`),
    check('openbot_pilot_resolutions_acao', sql`char_length(btrim(${t.acaoTomada})) BETWEEN 1 AND 200`),
  ],
);
