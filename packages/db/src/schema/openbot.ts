// Adaptador OpenBot (ADR-003): fila com lease, dedupe de callback, custos relatados e saúde, no PostgreSQL (a verdade; o Redis, se houver,
// guarda só IDs). Dono: Frente 02 — LN Backend Engineer. Valores em micro-USD INTEIROS (bigint como number: o teto mensal é de US$ 50).
// A fila nunca guarda conteúdo editorial: só ids de linha de negócio (`ref_id`) e limites.
import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
    resultRef: text('result_ref'),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('openbot_tasks_idem_uq').on(t.idempotencyKey),
    index('openbot_tasks_claim_idx').on(t.status, t.seq),
    check('openbot_tasks_status', sql`${t.status} IN ('pending', 'leased', 'completed', 'failed', 'dead')`),
    check('openbot_tasks_data_class', sql`${t.dataClass} IN ('public', 'internal')`),
    check('openbot_tasks_cost', sql`${t.maxCostMicro} >= 1`),
    check('openbot_tasks_attempts', sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 10`),
    // lease coerente: tarefa 'leased' sempre tem id, detentor e validade
    check('openbot_tasks_lease', sql`${t.status} <> 'leased' OR (${t.leaseId} IS NOT NULL AND ${t.leaseHolder} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`),
  ],
);

/** Dedupe de `callbackId`: a primeira inserção vence (chave primária); repetição não tem efeito. */
export const openbotCallbacks = pgTable('openbot_callbacks', {
  callbackId: text('callback_id').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
});

/** Custo relatado pelo OpenBot, deduplicado por `execution_id`. Nunca apagado (trilha de custo). */
export const openbotCostEntries = pgTable(
  'openbot_cost_entries',
  {
    executionId: text('execution_id').primaryKey(),
    taskId: text('task_id').notNull().references(() => openbotTasks.id),
    leaseId: text('lease_id').notNull(),
    model: text('model').notNull(),
    generationIds: jsonb('generation_ids').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    costMicro: bigint('cost_micro', { mode: 'number' }).notNull(),
    /** Passou do teto da tarefa: registrado mesmo assim (nunca esconder estouro). */
    overrun: boolean('overrun').notNull(),
    monthKey: text('month_key').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('openbot_cost_month_idx').on(t.monthKey),
    check('openbot_cost_nonneg', sql`${t.costMicro} >= 0 AND ${t.promptTokens} >= 0 AND ${t.completionTokens} >= 0 AND ${t.cacheReadTokens} >= 0 AND ${t.cacheWriteTokens} >= 0`),
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
