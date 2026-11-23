// Tabelas editoriais que a API precisa e que não estão no schema do scaffold: recibos de publicação,
// histórico de transições, mídia e agenda. Alinhadas aos contratos PublicationReceipt, MediaAsset e
// AgendaEvent (packages/contracts/src/workflow-editorial.ts). PROPOSTA da Frente 02 Backend: o Chief
// Architect pode substituir. Sem dado pessoal; sem métrica fictícia.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { articles, editorias, sources } from '../schema';

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
    // Arquivo no Blob S3 compatível (ausente = só metadados). A chave é por conteúdo: `midia/{sha256}`.
    blobKey: text('blob_key'),
    mime: text('mime'),
    bytes: integer('bytes'),
    // Licença: expiração e evidência (ADR-008/D08). Matéria nunca publica com licença vencida.
    licencaExpiraEm: date('licenca_expira_em'),
    licencaEvidencia: jsonb('licenca_evidencia'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('media_tipo', sql`${t.tipo} IN ('imagem', 'video', 'documento')`),
    check('media_sha', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('media_arquivo_completo', sql`${t.blobKey} IS NULL OR (${t.mime} IS NOT NULL AND ${t.bytes} > 0)`),
    uniqueIndex('media_sha256_uq').on(t.sha256), // deduplicação: um registro por conteúdo
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
    // Moderação: evento criado pela redação nasce aprovado; sugestão pública nasce pendente (nada vai ao público sem decisão humana).
    moderacao: text('moderacao').notNull().default('aprovado'),
    origem: text('origem').notNull().default('interno'),
    motivoRejeicao: text('motivo_rejeicao'),
    moderadoPor: text('moderado_por'),
    moderadoEm: timestamp('moderado_em', { withTimezone: true }),
    /** Só em sugestão pública: sha256(titulo minúsculo|início). Impede sugestões idênticas pendentes ao mesmo tempo. */
    chaveDedupe: text('chave_dedupe'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agenda_periodo', sql`${t.fim} >= ${t.inicio}`),
    check('agenda_moderacao', sql`${t.moderacao} IN ('pendente', 'aprovado', 'rejeitado')`),
    check('agenda_origem', sql`${t.origem} IN ('interno', 'publico')`),
    check('agenda_rejeicao_com_motivo', sql`${t.moderacao} <> 'rejeitado' OR (${t.motivoRejeicao} IS NOT NULL AND length(trim(${t.motivoRejeicao})) > 0)`),
    check('agenda_publico_aprovado_por_humano', sql`${t.origem} <> 'publico' OR ${t.moderacao} = 'pendente' OR ${t.moderadoPor} IS NOT NULL`),
    check('agenda_publico_nao_patrocinado', sql`${t.origem} <> 'publico' OR NOT ${t.patrocinado}`),
    uniqueIndex('agenda_sugestao_pendente_uq').on(t.chaveDedupe).where(sql`${t.moderacao} = 'pendente' AND ${t.chaveDedupe} IS NOT NULL`),
    index('agenda_moderacao_idx').on(t.moderacao, t.inicio),
  ],
);

/**
 * Revisão de correção de matéria do CMS já publicada (ADR-019 §c.5). A página pública continua com o conteúdo publicado até a
 * revisão ser aprovada (recibo) e registrada pela rota oficial de publicação; só então `articles` troca de versão e vira `corrigido`.
 * `corpo` guarda o texto SEM o aviso; o texto final é `corpo + aviso`, e é ele que entra no hash do recibo.
 */
export const articleRevisions = pgTable(
  'article_revisions',
  {
    id: text('id').primaryKey(),
    articleId: text('article_id').notNull().references(() => articles.id),
    /** Versão publicada em que a revisão se baseia; a publicação só vale se a matéria ainda estiver nela. */
    baseVersao: integer('base_versao').notNull(),
    /** Versão que `articles` terá depois de publicada (recibo desta versão). */
    versao: integer('versao').notNull(),
    /** Caso de correção (editorial_correction) aceito que autoriza a revisão. Sem FK: o caso vive no CMS editorial (ADR-019 §3). */
    casoId: text('caso_id').notNull(),
    titulo: text('titulo').notNull(),
    subtitulo: text('subtitulo'),
    resumo: text('resumo'),
    corpo: text('corpo').notNull(),
    imagem: jsonb('imagem'),
    /** Aviso de errata ou de resposta (público, datado), no fim do corpo. */
    aviso: text('aviso').notNull(),
    estado: text('estado').notNull().default('rascunho'),
    conteudoSha256: text('conteudo_sha256'),
    receiptId: text('receipt_id'),
    criadoPor: text('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
  },
  (t) => [
    check('article_revisions_estado', sql`${t.estado} IN ('rascunho', 'aprovada', 'publicada', 'descartada')`),
    check('article_revisions_versao', sql`${t.versao} > ${t.baseVersao}`),
    check('article_revisions_aprovada_com_recibo', sql`${t.estado} NOT IN ('aprovada', 'publicada') OR (${t.receiptId} IS NOT NULL AND ${t.conteudoSha256} ~ '^[0-9a-f]{64}$')`),
    uniqueIndex('article_revisions_aberta_uq').on(t.articleId).where(sql`${t.estado} IN ('rascunho', 'aprovada')`),
    uniqueIndex('article_revisions_versao_uq').on(t.articleId, t.versao).where(sql`${t.estado} <> 'descartada'`),
  ],
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
