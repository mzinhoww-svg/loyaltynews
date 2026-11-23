// Configuração do site publicada pelo CMS: home, menus, SEO e links internos como DOCUMENTOS VERSIONADOS, e redirects.
// Um documento por tipo tem no máximo UM rascunho e UM agendamento; versões publicadas ficam para rollback (que gera
// versão nova, nunca reescreve o passado). A versão efetiva é a de maior data efetiva (publicadoEm ou publicarEm) já vencida.
// Dono: Frente 02 — LN Backend Engineer. Sem dado pessoal.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const siteDocumentos = pgTable(
  'site_documentos',
  {
    id: text('id').primaryKey(),
    tipo: text('tipo').notNull(),
    /** Nulo no rascunho; atribuída ao publicar ou agendar (sequência por tipo). */
    versao: integer('versao'),
    estado: text('estado').notNull(),
    conteudo: jsonb('conteudo').notNull(),
    publicarEm: timestamp('publicar_em', { withTimezone: true }),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    nota: text('nota'),
    criadoPor: text('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('site_documentos_tipo', sql`${t.tipo} IN ('home', 'menu_principal', 'menu_rodape', 'seo_global', 'links_internos')`),
    check('site_documentos_estado', sql`${t.estado} IN ('rascunho', 'agendado', 'publicado', 'substituido')`),
    check('site_documentos_versao', sql`(${t.estado} = 'rascunho' AND ${t.versao} IS NULL) OR (${t.estado} <> 'rascunho' AND ${t.versao} IS NOT NULL AND ${t.versao} > 0)`),
    check('site_documentos_agendado', sql`${t.estado} <> 'agendado' OR ${t.publicarEm} IS NOT NULL`),
    check('site_documentos_publicado', sql`${t.estado} NOT IN ('publicado', 'substituido') OR ${t.publicadoEm} IS NOT NULL`),
    uniqueIndex('site_documentos_versao_uq').on(t.tipo, t.versao),
    uniqueIndex('site_documentos_rascunho_uq').on(t.tipo).where(sql`${t.estado} = 'rascunho'`),
    uniqueIndex('site_documentos_agendado_uq').on(t.tipo).where(sql`${t.estado} = 'agendado'`),
    index('site_documentos_tipo_estado_idx').on(t.tipo, t.estado),
  ],
);

export const siteRedirects = pgTable(
  'site_redirects',
  {
    id: text('id').primaryKey(),
    origem: text('origem').notNull(),
    destino: text('destino').notNull(),
    codigo: integer('codigo').notNull().default(301),
    ativo: boolean('ativo').notNull().default(true),
    criadoPor: text('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('site_redirects_codigo', sql`${t.codigo} IN (301, 302)`),
    check('site_redirects_origem', sql`${t.origem} ~ '^/[^/?#]'`),
    check('site_redirects_diferentes', sql`${t.origem} <> ${t.destino}`),
    uniqueIndex('site_redirects_origem_uq').on(t.origem),
  ],
);
