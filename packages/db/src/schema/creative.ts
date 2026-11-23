// Creative Studio: cards sociais gerados por código (renderSocialCard do @ln/growth) a partir de uma matéria, com revisão.
// Dono: Frente 02 — Backend. Contrato: fast-track/contratos/creative-studio-api.md. "aprovado" = pronto para o pacote da Integration;
// NADA aqui publica, agenda ou chama o mLabs. O SVG fica gravado (fonte da verdade do PNG): mudar a matéria não muda um card já criado.
// Idempotência: (matéria, formato, sha256 do SVG). Migração reversível: drizzle/down/<NNNN>_creative_cards.down.sql.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { articles } from '../schema';

export const creativeCards = pgTable(
  'creative_cards',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id').notNull().references(() => articles.id),
    kind: text('kind').notNull(),
    format: text('format').notNull(),
    autoralFormato: text('autoral_formato'),
    estado: text('estado').notNull().default('rascunho'),
    svg: text('svg').notNull(),
    svgSha256: text('svg_sha256').notNull(),
    altText: text('alt_text').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    mock: boolean('mock').notNull(),
    brandStatus: text('brand_status').notNull(),
    criadoPor: text('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull(),
    revisadoPor: text('revisado_por'),
    revisadoEm: timestamp('revisado_em', { withTimezone: true }),
    motivo: text('motivo'),
  },
  (t) => [
    uniqueIndex('creative_cards_idem_uq').on(t.articleId, t.format, t.svgSha256),
    index('creative_cards_estado_idx').on(t.estado, t.criadoEm),
    check('creative_cards_kind', sql`${t.kind} in ('materia', 'analise')`),
    check('creative_cards_format', sql`${t.format} in ('linkedin_landscape', 'square')`),
    check('creative_cards_autoral', sql`${t.autoralFormato} IS NULL OR ${t.autoralFormato} in ('analise', 'explicador', 'comparativo')`),
    check('creative_cards_estado', sql`${t.estado} in ('rascunho', 'em_revisao', 'aprovado', 'rejeitado')`),
    check('creative_cards_sha', sql`${t.svgSha256} ~ '^[0-9a-f]{64}$'`),
    check('creative_cards_rejeitado_motivo', sql`${t.estado} <> 'rejeitado' OR char_length(btrim(${t.motivo})) BETWEEN 1 AND 500`),
    check('creative_cards_revisado', sql`${t.estado} NOT IN ('aprovado', 'rejeitado') OR (${t.revisadoPor} IS NOT NULL AND ${t.revisadoEm} IS NOT NULL)`),
  ],
);
