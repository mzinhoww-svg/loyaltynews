// Tabelas editoriais que a API precisa e que não estão no schema do scaffold: recibos de publicação,
// histórico de transições, mídia e agenda. Alinhadas aos contratos PublicationReceipt, MediaAsset e
// AgendaEvent (packages/contracts/src/workflow-editorial.ts). PROPOSTA da Frente 02 Backend: o Chief
// Architect pode substituir. Sem dado pessoal; sem métrica fictícia.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { articles, companies, editorias, evidences, sources } from '../schema';

/** Recibo de publicação (ADR-008): liga a versão e o hash do corpo às checagens que a aprovaram. */
export const publicationReceipts = pgTable(
  'publication_receipts',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id').notNull().references(() => articles.id),
    versao: integer('versao').notNull(),
    conteudoSha256: text('conteudo_sha256').notNull(),
    checagens: jsonb('checagens').notNull(),
    aprovador: text('aprovador').notNull(),
    identidadePublicacao: text('identidade_publicacao').notNull(),
    emitidoEm: timestamp('emitido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('publication_receipts_version_uq').on(t.articleId, t.versao),
    check('publication_receipts_sha', sql`${t.conteudoSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Histórico de transições de estado da matéria. */
export const articleTransitions = pgTable(
  'article_transitions',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id').notNull().references(() => articles.id),
    de: text('de').notNull(),
    para: text('para').notNull(),
    actorId: text('actor_id').notNull(),
    nota: text('nota'),
    receiptId: text('receipt_id').references(() => publicationReceipts.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('article_transitions_article_idx').on(t.articleId)],
);

export const media = pgTable(
  'media',
  {
    id: text('id').primaryKey(),
    tipo: text('tipo').notNull(),
    direitos: jsonb('direitos').notNull(), // ImageRights (origem, crédito, base de direito, texto alternativo)
    sha256: text('sha256').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('media_tipo', sql`${t.tipo} IN ('imagem', 'video', 'documento')`),
    check('media_sha', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const agendaEvents = pgTable(
  'agenda_events',
  {
    id: text('id').primaryKey(),
    titulo: text('titulo').notNull(),
    inicio: date('inicio').notNull(),
    fim: date('fim').notNull(),
    local: text('local').notNull(),
    url: text('url'),
    editorias: jsonb('editorias').notNull().default(sql`'[]'::jsonb`),
    patrocinado: boolean('patrocinado').notNull().default(false),
    fonteUrl: text('fonte_url').notNull(),
  },
  (t) => [check('agenda_periodo', sql`${t.fim} >= ${t.inicio}`)],
);

/** Contrato Source.editorias (min 1): as editorias que a fonte cobre. */
export const sourceEditorias = pgTable(
  'source_editorias',
  {
    sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
    editoria: text('editoria').notNull().references(() => editorias.slug),
  },
  (t) => [uniqueIndex('source_editorias_pk').on(t.sourceId, t.editoria)],
);

/** Contrato Company.fontes (min 1): evidências que sustentam a empresa. */
export const companyEvidences = pgTable(
  'company_evidences',
  {
    companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    evidenceId: text('evidence_id').notNull().references(() => evidences.id),
  },
  (t) => [uniqueIndex('company_evidences_pk').on(t.companyId, t.evidenceId)],
);
