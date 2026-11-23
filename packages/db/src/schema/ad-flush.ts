// Ledger de flush da entrega de anúncios (Redis → ad_delivery_daily). Cada flush grava o seu `flush_id` (o uuid da chave de
// trabalho do Redis) NA MESMA transação que soma o delta: se o commit foi confirmado mas a resposta se perdeu, a próxima
// rodada vê o id aqui e só apaga a chave de trabalho, sem somar de novo (exatamente uma vez). Dono: Frente 02 — LN Backend Engineer
// (proposta; o Arquiteto pode regenerar a migração). Sem dado pessoal.
import { date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const adDeliveryFlushes = pgTable(
  'ad_delivery_flushes',
  {
    flushId: text('flush_id').primaryKey(),
    creativeId: text('creative_id').notNull(),
    day: date('day').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ad_delivery_flushes_at_idx').on(t.at)],
);
