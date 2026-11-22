// Outbox transacional e ledger de efeitos (ADR-002). Dono: Frente 02 — LN Backend Engineer.
// PostgreSQL é a verdade; o Redis leva só IDs. O reconciliador recria jobs a partir daqui.
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const outboxStatus = pgEnum('outbox_status', ['pending', 'enqueued', 'done', 'failed']);

export const outbox = pgTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    queue: text('queue').notNull(),
    refId: text('ref_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('outbox_idempotency_uq').on(t.idempotencyKey), index('outbox_status_idx').on(t.status, t.enqueuedAt)],
);

/** Um efeito por chave de idempotência; gravado na MESMA transação do efeito. */
export const effectLedger = pgTable('effect_ledger', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  effect: text('effect').notNull(),
  refId: text('ref_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
