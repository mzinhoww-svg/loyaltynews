// Orçamento de modelos (ADR-006/015, DP-04): reservas e ledger append-only, em micros de USD.
// Dono: Frente 02 — LN Backend Engineer. Valores inteiros (sem float). Mês no fuso America/Sao_Paulo.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// 'pendente': resultado incerto depois do envio (conta no teto até conciliação). Migração pendente (ver modelops).
export const reservationState = pgEnum('reservation_state', ['reservada', 'conciliada', 'liberada', 'recusada', 'pendente']);
export const ledgerKind = pgEnum('ledger_kind', ['reserva', 'conciliacao', 'liberacao']);

export const budgetReservations = pgTable(
  'budget_reservations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    monthKey: text('month_key').notNull(),
    route: text('route').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    maxEstimatedMicrousd: integer('max_estimated_microusd').notNull(),
    state: reservationState('state').notNull().default('reservada'),
    actualMicrousd: integer('actual_microusd'),
    generationId: text('generation_id'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
    // Campos para o gate reconstruir o estado (pool de bolsa, classe, faixa e escalonamento).
    pool: text('pool').notNull().default('allocation'),
    taskClass: text('task_class').notNull().default('essential'),
    lane: text('lane').notNull().default('text'),
    escalation: boolean('escalation').notNull().default(false),
    // Ordem real de criação (identidade do banco); a reconstrução do estado segue esta ordem.
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  },
  (t) => [
    uniqueIndex('budget_reservations_idem_uq').on(t.idempotencyKey),
    check('budget_reservations_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('budget_reservations_max', sql`${t.maxEstimatedMicrousd} >= 0`),
    check('budget_reservations_provider', sql`${t.provider} IN ('anthropic', 'openai', 'deepseek')`),
    check('budget_reservations_pool', sql`${t.pool} IN ('allocation', 'reserve', 'qualification')`),
    check('budget_reservations_task_class', sql`${t.taskClass} IN ('essential', 'non_essential', 'premium', 'reserve')`),
    check('budget_reservations_lane', sql`${t.lane} IN ('text', 'image')`),
    check('budget_reservations_actual', sql`${t.actualMicrousd} IS NULL OR ${t.actualMicrousd} >= 0`),
    check(
      'budget_reservations_conciliada',
      sql`${t.state} <> 'conciliada' OR (${t.actualMicrousd} IS NOT NULL AND ${t.generationId} IS NOT NULL)`,
    ),
  ],
);

/** Append-only (triggers na migração bloqueiam UPDATE e DELETE). Gasto do mês = soma de delta_microusd. */
export const budgetLedger = pgTable(
  'budget_ledger',
  {
    id: text('id').primaryKey(),
    monthKey: text('month_key').notNull(),
    reservationId: text('reservation_id').notNull().references(() => budgetReservations.id),
    kind: ledgerKind('kind').notNull(),
    deltaMicrousd: integer('delta_microusd').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    // Evidência de liberação sem cobrança (kind 'liberacao').
    evidence: text('evidence'),
  },
  (t) => [
    uniqueIndex('budget_ledger_idem_uq').on(t.idempotencyKey),
    index('budget_ledger_month_idx').on(t.monthKey),
    check('budget_ledger_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/** Taxa de compra de crédito no provedor (DP-11/P3): registrada à parte, fora do teto. */
export const budgetRefillFees = pgTable(
  'budget_refill_fees',
  {
    id: text('id').primaryKey(),
    monthKey: text('month_key').notNull(),
    amountMicrousd: integer('amount_microusd').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('budget_refill_fees_idem_uq').on(t.idempotencyKey),
    check('budget_refill_fees_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('budget_refill_fees_amount', sql`${t.amountMicrousd} >= 0`),
  ],
);

/** Parada global ('global') e por rota ('route:<nome>'). Lida a cada chamada de modelo. */
export const budgetKillSwitch = pgTable('budget_kill_switch', {
  scope: text('scope').primaryKey(),
  active: boolean('active').notNull(),
  reason: text('reason').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
