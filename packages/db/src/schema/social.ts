// Pacotes do Social Dashboard (Frente 09, @ln/growth). Porta PackageStore sobre PostgreSQL: o registro inteiro em
// `record json` (preserva a ordem das chaves); as colunas escalares existem só para filtro e ordenação.
// Sem segredo, sem credencial do mLabs e sem dado pessoal. Dono: Frente 02 — LN Backend Engineer (proposta; o Arquiteto pode regenerar).
import { index, json, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const socialPackages = pgTable(
  'social_packages',
  {
    id: text('id').primaryKey(), // `${articleId}:${channel}:v${versao}`
    articleId: text('article_id').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    record: json('record').notNull(),
  },
  (t) => [index('social_packages_article_idx').on(t.articleId), index('social_packages_status_idx').on(t.status, t.channel, t.updatedAt)],
);
