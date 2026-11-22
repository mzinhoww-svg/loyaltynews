// Orçamento de modelos (ADR-006/015, DP-04): reservas e ledger append-only, em micros de USD.
// Dono: Frente 02 — LN Backend Engineer. Valores inteiros (sem float). Mês no fuso America/Sao_Paulo.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const reservationState = pgEnum('reservation_state', ['reservada', 'conciliada', 'liberada', 'recusada']);
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
  },
  (t) => [
    uniqueIndex('budget_reservations_idem_uq').on(t.idempotencyKey),
    check('budget_reservations_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('budget_reservations_max', sql`${t.maxEstimatedMicrousd} >= 0`),
    check('budget_reservations_provider', sql`${t.provider} IN ('anthropic', 'openai', 'deepseek')`),
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
  },
  (t) => [
    uniqueIndex('budget_ledger_idem_uq').on(t.idempotencyKey),
    index('budget_ledger_month_idx').on(t.monthKey),
    check('budget_ledger_month', sql`${t.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);
