// @ln/db — schema Drizzle (PostgreSQL 18, SQL padrão, sem extensões fora da lista trusted; sem pgvector).
// Dono: Frente 02 — LN Chief Architect. Tabelas de autenticação, outbox/effect_ledger e budget_ledger:
// Frente 02 Backend (arquivos próprios em src/schema/ após merge), conforme combinado.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const articleStatus = pgEnum('article_status', [
  'rascunho',
  'em_checagem',
  'bloqueado',
  'aprovado',
  'publicado',
  'despublicado',
  'corrigido',
]);
export const contentType = pgEnum('content_type', ['noticia', 'flash', 'analise', 'entrevista', 'opiniao', 'estudo', 'patrocinado', 'cobertura_evento']);
export const linkOrigin = pgEnum('link_origin', ['declarado', 'inferido']);
// Enum compartilhado com o módulo comercial; definido em arquivo próprio para evitar ciclo de carga.
export { disponibilidade } from './schema/enums';

export const editorias = pgTable('editorias', {
  slug: text('slug').primaryKey(),
  nome: text('nome').notNull(),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  url: text('url').notNull(),
  tipo: text('tipo').notNull(),
  acesso: text('acesso').notNull().default('publico'),
  termosRevisados: boolean('termos_revisados').notNull().default(false),
  ativo: boolean('ativo').notNull().default(false),
  /** ADR-019 §d: 'fabrica' = linha projetada do registro da Fábrica (somente leitura no CMS); 'cms' = cadastro manual de citação. */
  origem: text('origem').notNull().default('cms'),
}, (t) => [
  check('sources_acesso_publico', sql`${t.acesso} = 'publico'`),
  check('sources_origem', sql`${t.origem} in ('fabrica', 'cms')`),
]);

export const evidences = pgTable('evidences', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => sources.id),
  url: text('url').notNull(),
  capturadoEm: timestamp('capturado_em', { withTimezone: true }).notNull(),
  sha256: text('sha256').notNull(),
}, (t) => [check('evidences_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`)]);

export const articles = pgTable('articles', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  titulo: text('titulo').notNull(),
  subtitulo: text('subtitulo'),
  resumo: text('resumo'),
  tipoConteudo: contentType('tipo_conteudo').notNull().default('noticia'),
  editoria: text('editoria').notNull().references(() => editorias.slug),
  status: articleStatus('status').notNull().default('rascunho'),
  assinatura: text('assinatura').notNull().default('Redação Loyalty News'),
  corpo: text('corpo').notNull(),
  imagem: jsonb('imagem'),
  classeDeDado: text('classe_de_dado').notNull().default('public'),
  patrocinado: boolean('patrocinado').notNull().default(false),
  rotuloPublieditorial: text('rotulo_publieditorial'),
  versao: integer('versao').notNull().default(1),
  publicadoEm: timestamp('publicado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('articles_slug_uq').on(t.slug),
  index('articles_editoria_status_idx').on(t.editoria, t.status),
  check('articles_assinatura', sql`${t.assinatura} = 'Redação Loyalty News'`),
  check('articles_publieditorial_rotulado', sql`NOT ${t.patrocinado} OR ${t.rotuloPublieditorial} IS NOT NULL`),
  check('articles_tipo_patrocinado', sql`${t.tipoConteudo} <> 'patrocinado' OR ${t.patrocinado}`),
  check('articles_publicada_com_resumo', sql`${t.status} <> 'publicado' OR (${t.resumo} IS NOT NULL AND length(${t.resumo}) BETWEEN 1 AND 300)`),
]);

export const articleSources = pgTable('article_sources', {
  articleId: text('article_id').notNull().references(() => articles.id),
  evidenceId: text('evidence_id').notNull().references(() => evidences.id),
}, (t) => [uniqueIndex('article_sources_pk').on(t.articleId, t.evidenceId)]);

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  nomeLegal: text('nome_legal'),
  site: text('site'),
  setor: text('setor'),
});

/** P4: só nome, cargo e empresa, com evidência. Nenhuma outra coluna de dado pessoal. */
export const people = pgTable('people', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  cargo: text('cargo').notNull(),
  empresaId: text('empresa_id').notNull().references(() => companies.id),
  evidenceId: text('evidence_id').notNull().references(() => evidences.id),
});

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  cargo: text('cargo').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  evidenceId: text('evidence_id').notNull().references(() => evidences.id),
  origem: linkOrigin('origem').notNull(),
  observadoEm: timestamp('observado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('roles_vigencia', sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`)]);

export const moves = pgTable('moves', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  deCompanyId: text('de_company_id').references(() => companies.id),
  paraCompanyId: text('para_company_id').notNull().references(() => companies.id),
  cargoNovo: text('cargo_novo').notNull(),
  data: date('data').notNull(),
  evidenceId: text('evidence_id').notNull().references(() => evidences.id),
  origem: linkOrigin('origem').notNull(),
});

// Frente 02 Backend: auth, outbox, orçamento, recibos/mídia/agenda (arquivos em ./schema/).
export * from './schema/auth';
export * from './schema/outbox';
export * from './schema/budget';
export * from './schema/editorial-api';

// Frente 10 Comercial: catálogo, inventário, CRM, campanhas e métricas (./schema/commercial.ts).
export * from './schema/commercial';

// Frente 07 AgentOps: memória setorial e rituais (./schema/agents.ts).
export * from './schema/agents';

export * from './schema/editorial-store';
export * from './schema/social';
export * from './schema/ad-flush';
export * from './schema/site';
export * from './schema/openbot';
export * from './schema/growth';
