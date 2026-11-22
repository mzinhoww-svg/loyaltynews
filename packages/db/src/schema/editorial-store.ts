// Persistência do CMS editorial (porta EditorialStore do @ln/editorial; contrato em
// packages/editorial/docs/editorial-store-contract.md). O registro inteiro vive em `record json` (não jsonb: preserva o texto e a ordem das chaves) (a porta troca o
// registro por inteiro); as colunas escalares existem só para índice/filtro. Dono: Frente 02 — LN Backend Engineer
// (proposta; o Chief Architect pode regenerar a migração no merge). `editorial_correction.record` contém DADO PESSOAL
// (contato e nome do requerente): classe `personal`, acesso restrito, o contato nunca sai em API.
import { bigserial, boolean, index, json, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const editorialArticle = pgTable(
  'editorial_article',
  {
    articleId: text('article_id').primaryKey(),
    status: text('status').notNull(),
    editoria: text('editoria').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    record: json('record').notNull(),
  },
  (t) => [index('editorial_article_status_idx').on(t.status, t.editoria, t.updatedAt)],
);

export const editorialCorrection = pgTable(
  'editorial_correction',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id').notNull(),
    state: text('state').notNull(),
    kind: text('kind').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    record: json('record').notNull(),
  },
  (t) => [index('editorial_correction_state_idx').on(t.state, t.receivedAt), index('editorial_correction_article_idx').on(t.articleId)],
);

export const editorialSourceState = pgTable('editorial_source_state', {
  sourceId: text('source_id').primaryKey(),
  enabled: boolean('enabled').notNull(),
  termsStatus: text('terms_status').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  record: json('record').notNull(),
});

/** Somente-acréscimo (trigger na migração); listAudit = ORDER BY id. */
export const editorialAudit = pgTable('editorial_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: text('at').notNull(),
  record: json('record').notNull(),
});
