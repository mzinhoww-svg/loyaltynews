// Módulo comercial (Frente 10): catálogo e inventário, CRM, campanhas, reservas, criativos, entrega diária e métricas do mídia kit.
// Incorporado pelo Chief Architect a partir de ft/commercial 0330bdf (packages/commercial/src/db-schema.proposto.ts).
// Substitui as versões do scaffold de ad_formats, ad_slots e campaigns. Regras e comentários da proposta preservados.
// Limite de cotas por posição NÃO cabe em CHECK: reservar = transação com SELECT ... FOR UPDATE em ad_slots (InventoryBook.reserve).
// Impressões/cliques: só agregado diário por criativo. Nenhum dado de leitor.
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { disponibilidade } from './enums';

export const precoTipo = pgEnum('preco_tipo', ['fixo', 'a_partir_de', 'verba_mais_taxa']);
export const precoUnidade = pgEnum('preco_unidade', ['mes', 'dia', 'unidade', 'verba']);
export const slotPosicao = pgEnum('slot_posicao', ['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER', 'ARTICLE_INLINE', 'HOME_BETWEEN', 'AGENDA', 'DATA']);
export const reservaStatus = pgEnum('reserva_status', ['held', 'confirmed', 'cancelled']);
export const campanhaStatus = pgEnum('campanha_status', ['draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled']);
export const leadStatus = pgEnum('lead_status', ['novo', 'qualificado', 'descartado', 'convertido']);
export const oportunidadeEstagio = pgEnum('oportunidade_estagio', ['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido']);
export const metricaStatus = pgEnum('metrica_status', ['available', 'unavailable', 'stale']);

// ---------- catálogo e inventário ----------
export const adFormats = pgTable('ad_formats', {
  id: text('id').primaryKey(), // `secao--slug`, igual a contracts/AD_FORMATS
  secao: text('secao').notNull(),
  nome: text('nome').notNull(),
  referenciaBrl: text('referencia_brl').notNull(),
  escopo: text('escopo').notNull(),
  disponibilidade: disponibilidade('disponibilidade').notNull().default('indisponivel'),
  // NOVAS
  precoTipo: precoTipo('preco_tipo').notNull(),
  precoValorBrl: numeric('preco_valor_brl', { precision: 12, scale: 2 }), // null em verba_mais_taxa
  unidade: precoUnidade('unidade').notNull(),
  taxaPct: numeric('taxa_pct', { precision: 5, scale: 2 }),
  motivoDisponibilidade: text('motivo_disponibilidade').notNull().default('Sem capacidade operacional declarada.'),
  fonteLinha: integer('fonte_linha'),
}, (t) => [
  check('ad_formats_preco_coerente', sql`(${t.precoTipo} = 'verba_mais_taxa' AND ${t.precoValorBrl} IS NULL AND ${t.taxaPct} IS NOT NULL) OR (${t.precoTipo} <> 'verba_mais_taxa' AND ${t.precoValorBrl} IS NOT NULL AND ${t.precoValorBrl} >= 0)`),
  check('ad_formats_motivo_se_nao_disponivel', sql`${t.disponibilidade} = 'disponivel' OR length(${t.motivoDisponibilidade}) > 0`),
  index('ad_formats_secao_idx').on(t.secao),
]);

export const adSlots = pgTable('ad_slots', {
  id: text('id').primaryKey(),
  posicao: slotPosicao('posicao').notNull(),
  formatoId: text('formato_id').notNull().references(() => adFormats.id),
  dimensaoDesktop: text('dimensao_desktop').notNull(), // '1280×150' ou 'parametrizavel'
  variantesMobile: jsonb('variantes_mobile').notNull().default(sql`'[]'::jsonb`),
  limiteCotas: integer('limite_cotas'), // null = parametrizável, não reservável
  pesoMaxKb: integer('peso_max_kb'),
  contratoMinimoDias: integer('contrato_minimo_dias'),
  tiposPermitidos: jsonb('tipos_permitidos').notNull().default(sql`'["JPG","PNG","GIF","HTML5-sandbox"]'::jsonb`),
}, (t) => [
  uniqueIndex('ad_slots_posicao_uq').on(t.posicao),
  check('ad_slots_limite_positivo', sql`${t.limiteCotas} IS NULL OR ${t.limiteCotas} > 0`),
  check('ad_slots_reservavel_completo', sql`${t.limiteCotas} IS NULL OR ${t.contratoMinimoDias} IS NOT NULL`),
]);

// ---------- CRM ----------
export const crmAccounts = pgTable('crm_accounts', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('crm_accounts_nome_uq').on(sql`lower(${t.nome})`)]);

/** Lead do mídia kit: dado pessoal (classe `personal`, contracts/Lead). Opt-in da newsletter é separado e NUNCA default true. */
export const crmLeads = pgTable('crm_leads', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  empresa: text('empresa').notNull(),
  email: text('email').notNull(),
  whatsapp: text('whatsapp'),
  formatoIds: jsonb('formato_ids').notNull().default(sql`'[]'::jsonb`),
  objetivo: text('objetivo').notNull(),
  mensagem: text('mensagem'),
  optInNewsletter: boolean('opt_in_newsletter').notNull().default(false),
  consentimentoEm: timestamp('consentimento_em', { withTimezone: true }).notNull(),
  classeDeDado: text('classe_de_dado').notNull().default('personal'),
  status: leadStatus('status').notNull().default('novo'),
  contaId: text('conta_id').references(() => crmAccounts.id),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('crm_leads_classe', sql`${t.classeDeDado} = 'personal'`),
  index('crm_leads_status_idx').on(t.status, t.criadoEm),
  index('crm_leads_email_idx').on(sql`lower(${t.email})`),
]);

export const crmOpportunities = pgTable('crm_opportunities', {
  id: text('id').primaryKey(),
  contaId: text('conta_id').notNull().references(() => crmAccounts.id),
  leadId: text('lead_id').references(() => crmLeads.id),
  titulo: text('titulo').notNull(),
  formatoIds: jsonb('formato_ids').notNull().default(sql`'[]'::jsonb`),
  estagio: oportunidadeEstagio('estagio').notNull().default('novo'),
  motivoPerda: text('motivo_perda'),
  proximaAcao: text('proxima_acao'),
  proximaAcaoPrazo: date('proxima_acao_prazo'),
  valorBrl: numeric('valor_brl', { precision: 14, scale: 2 }), // null = ainda não propostado; nunca estimar
  versoesProposta: integer('versoes_proposta').notNull().default(0),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('crm_opp_perda_exige_motivo', sql`${t.estagio} <> 'perdido' OR (${t.motivoPerda} IS NOT NULL AND length(trim(${t.motivoPerda})) > 0)`),
  check('crm_opp_valor_nao_negativo', sql`${t.valorBrl} IS NULL OR ${t.valorBrl} >= 0`),
  index('crm_opp_estagio_idx').on(t.estagio),
]);

export const crmOpportunityHistory = pgTable('crm_opportunity_history', {
  id: text('id').primaryKey(),
  oportunidadeId: text('oportunidade_id').notNull().references(() => crmOpportunities.id),
  de: oportunidadeEstagio('de'),
  para: oportunidadeEstagio('para').notNull(),
  em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('crm_opp_hist_idx').on(t.oportunidadeId, t.em)]);

// ---------- campanhas, reservas, criativos ----------
export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  nome: text('nome').notNull(),
  contaId: text('conta_id').notNull().references(() => crmAccounts.id),
  oportunidadeId: text('oportunidade_id').references(() => crmOpportunities.id),
  formatoId: text('formato_id').notNull().references(() => adFormats.id),
  slotId: text('slot_id').references(() => adSlots.id),
  inicio: date('inicio').notNull(),
  fim: date('fim').notNull(),
  status: campanhaStatus('status').notNull().default('draft'),
  rotulada: boolean('rotulada').notNull().default(true), // F-074: conteúdo pago sempre rotulado
  historico: jsonb('historico').notNull().default(sql`'[]'::jsonb`),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('campaigns_periodo', sql`${t.fim} >= ${t.inicio}`),
  check('campaigns_rotulada', sql`${t.rotulada}`),
  index('campaigns_status_idx').on(t.status),
]);

/** Posições da campanha (várias por campanha; ordem = a do domínio). `campaigns.slot_id` continua = a PRIMEIRA, para leitores antigos.
 *  Backend 3, a pedido do Commercial (ft/commercial 4ea7404). Linha legada sem posições aqui: a posição é a de `campaigns.slot_id`. */
export const campaignPositions = pgTable('campaign_positions', {
  campanhaId: text('campanha_id').notNull().references(() => campaigns.id),
  slotId: text('slot_id').notNull().references(() => adSlots.id),
  ordem: integer('ordem').notNull(),
}, (t) => [
  uniqueIndex('campaign_positions_pk').on(t.campanhaId, t.slotId),
  uniqueIndex('campaign_positions_ordem_uq').on(t.campanhaId, t.ordem),
  check('campaign_positions_ordem', sql`${t.ordem} >= 0`),
]);

export const adReservations = pgTable('ad_reservations', {
  id: text('id').primaryKey(),
  slotId: text('slot_id').notNull().references(() => adSlots.id),
  contaId: text('conta_id').notNull().references(() => crmAccounts.id),
  campanhaId: text('campanha_id').references(() => campaigns.id),
  inicio: date('inicio').notNull(),
  fim: date('fim').notNull(),
  status: reservaStatus('status').notNull().default('held'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ad_reservations_periodo', sql`${t.fim} >= ${t.inicio}`),
  index('ad_reservations_slot_periodo_idx').on(t.slotId, t.inicio, t.fim),
]);

export const adTakeovers = pgTable('ad_takeovers', {
  id: text('id').primaryKey(),
  dia: date('dia').notNull(),
  contaId: text('conta_id').notNull().references(() => crmAccounts.id),
  campanhasAcordadas: jsonb('campanhas_acordadas').notNull().default(sql`'[]'::jsonb`),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('ad_takeovers_dia_uq').on(t.dia)]); // um takeover por dia

export const adCreatives = pgTable('ad_creatives', {
  id: text('id').primaryKey(),
  campanhaId: text('campanha_id').notNull().references(() => campaigns.id),
  slotId: text('slot_id').notNull().references(() => adSlots.id),
  peso: integer('peso').notNull().default(1),
  inicio: date('inicio').notNull(),
  fim: date('fim').notNull(),
  aprovado: boolean('aprovado').notNull().default(false),
  arquivoRef: text('arquivo_ref'), // chave no Blob S3 da Vertra; nunca URL externa de anunciante
  destinoUrl: text('destino_url'),
  // Arquivo do criativo, MEDIDO NO SERVIDOR no upload (nunca confiado ao cliente). Nulo até o upload; tudo junto ou nada (ad_creatives_arquivo_coerente).
  arquivoMime: text('arquivo_mime'),
  largura: integer('largura'),
  altura: integer('altura'),
  tamanhoKb: integer('tamanho_kb'),
  arquivoSha256: text('arquivo_sha256'),
  textoAlternativo: text('texto_alternativo'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ad_creatives_peso', sql`${t.peso} > 0`),
  check('ad_creatives_periodo', sql`${t.fim} >= ${t.inicio}`),
  check('ad_creatives_destino_https', sql`${t.destinoUrl} IS NULL OR ${t.destinoUrl} ~ '^https://'`),
  check('ad_creatives_arquivo_coerente', sql`(${t.arquivoMime} IS NULL AND ${t.largura} IS NULL AND ${t.altura} IS NULL AND ${t.tamanhoKb} IS NULL AND ${t.arquivoSha256} IS NULL) OR (${t.arquivoRef} IS NOT NULL AND ${t.arquivoMime} IN ('image/jpeg', 'image/png', 'image/gif') AND ${t.largura} > 0 AND ${t.altura} > 0 AND ${t.tamanhoKb} > 0 AND ${t.arquivoSha256} ~ '^[0-9a-f]{64}$')`),
  check('ad_creatives_alt', sql`${t.textoAlternativo} IS NULL OR char_length(btrim(${t.textoAlternativo})) BETWEEN 1 AND 200`),
  // Aprovado só com criativo COMPLETO: arquivo válido com hash, texto alternativo e destino https (a regra do PM: só criativo real aparece).
  check('ad_creatives_aprovado_completo', sql`NOT ${t.aprovado} OR (${t.arquivoRef} IS NOT NULL AND ${t.arquivoMime} IS NOT NULL AND ${t.largura} IS NOT NULL AND ${t.altura} IS NOT NULL AND ${t.tamanhoKb} IS NOT NULL AND ${t.arquivoSha256} IS NOT NULL AND ${t.textoAlternativo} IS NOT NULL AND ${t.destinoUrl} IS NOT NULL)`),
  index('ad_creatives_slot_idx').on(t.slotId, t.aprovado),
]);

/** Entrega agregada por dia. Sem dado pessoal de leitor. Servidas e visíveis são colunas separadas (Blueprint §4). */
export const adDeliveryDaily = pgTable('ad_delivery_daily', {
  id: text('id').primaryKey(),
  criativoId: text('criativo_id').notNull().references(() => adCreatives.id),
  dia: date('dia').notNull(),
  servidas: integer('servidas').notNull().default(0),
  visiveis: integer('visiveis').notNull().default(0),
  cliques: integer('cliques').notNull().default(0),
  ignoradasBotInterno: integer('ignoradas_bot_interno').notNull().default(0),
  refreshSuprimido: integer('refresh_suprimido').notNull().default(0),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('ad_delivery_daily_uq').on(t.criativoId, t.dia),
  check('ad_delivery_nao_negativo', sql`${t.servidas} >= 0 AND ${t.visiveis} >= 0 AND ${t.cliques} >= 0 AND ${t.ignoradasBotInterno} >= 0 AND ${t.refreshSuprimido} >= 0`),
  check('ad_delivery_visivel_le_servida', sql`${t.visiveis} <= ${t.servidas} AND ${t.cliques} <= ${t.servidas}`),
]);

// ---------- métricas do mídia kit ----------
/** Última coleta válida por (origem, métrica). Sem linha = "— / não disponível". Nunca zero falso. */
export const commercialMetrics = pgTable('commercial_metrics', {
  id: text('id').primaryKey(),
  origem: text('origem').notNull(),
  metrica: text('metrica').notNull(),
  valor: numeric('valor', { precision: 20, scale: 4 }),
  periodoInicio: timestamp('periodo_inicio', { withTimezone: true }),
  periodoFim: timestamp('periodo_fim', { withTimezone: true }),
  coletadoEm: timestamp('coletado_em', { withTimezone: true }),
  status: metricaStatus('status').notNull(),
  versaoMetodologia: text('versao_metodologia').notNull(),
}, (t) => [
  uniqueIndex('commercial_metrics_uq').on(t.origem, t.metrica),
  check('commercial_metrics_disponivel_completa', sql`${t.status} = 'unavailable' OR (${t.valor} IS NOT NULL AND ${t.periodoInicio} IS NOT NULL AND ${t.periodoFim} IS NOT NULL AND ${t.coletadoEm} IS NOT NULL AND ${t.periodoFim} >= ${t.periodoInicio})`),
]);

// ---------- integridade do ad server (pedido da Frente 02; packages/commercial/docs/dedupe-persistido.md) ----------
/** Espelho do watermark monotônico `ln:ad:hb` do Redis: gravado com GREATEST a cada batida; valor do Redis menor
 *  que o daqui (ou ausente) = perda/regressão do dedupe → abre lacuna de auditoria. */
export const adRedisWatermark = pgTable('ad_redis_watermark', {
  id: text('id').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('ad_redis_watermark_nao_negativo', sql`${t.value} >= 0`)]);

export const adGapReason = pgEnum('ad_gap_reason', ['dedupe_perdido', 'dedupe_regrediu']);
/** Lacunas de auditoria da entrega (espelham AuditGap de @ln/commercial). Período não auditável: valores mínimos, não totais. */
export const adDeliveryGaps = pgTable('ad_delivery_gaps', {
  id: text('id').primaryKey(),
  reason: adGapReason('reason').notNull(),
  from: timestamp('from', { withTimezone: true }).notNull(),
  servedUntil: timestamp('served_until', { withTimezone: true }).notNull(),
  to: timestamp('to', { withTimezone: true }).notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  uncountedServes: integer('uncounted_serves').notNull().default(0),
  ignoredEvents: integer('ignored_events').notNull().default(0),
}, (t) => [
  check('ad_delivery_gaps_ordem', sql`${t.from} <= ${t.servedUntil} AND ${t.servedUntil} <= ${t.to}`),
  check('ad_delivery_gaps_contadores', sql`${t.uncountedServes} >= 0 AND ${t.ignoredEvents} >= 0`),
  index('ad_delivery_gaps_periodo_idx').on(t.from, t.to),
]);

/** Contato de uma conta do CRM (dado pessoal). Só nasce por ato explícito no Studio; base legal, data e autor gravados pelo servidor.
 *  Backend 3, a pedido do Commercial (ft/commercial 4ea7404). Nunca sai em rota pública nem no mídia kit. */
export const crmContacts = pgTable('crm_contacts', {
  id: text('id').primaryKey(),
  contaId: text('conta_id').notNull().references(() => crmAccounts.id),
  nome: text('nome').notNull(),
  email: text('email').notNull(),
  whatsapp: text('whatsapp'),
  cargo: text('cargo'),
  baseLegal: text('base_legal').notNull(),
  consentimentoEm: timestamp('consentimento_em', { withTimezone: true, precision: 3 }).notNull(),
  registradoPor: text('registrado_por'),
  classeDeDado: text('classe_de_dado').notNull().default('personal'),
  criadoEm: timestamp('criado_em', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('crm_contacts_email_uq').on(t.contaId, sql`lower(${t.email})`),
  index('crm_contacts_conta_idx').on(t.contaId, t.criadoEm),
  check('crm_contacts_base_legal', sql`${t.baseLegal} in ('consentimento', 'legitimo_interesse', 'execucao_de_contrato')`),
  check('crm_contacts_classe', sql`${t.classeDeDado} = 'personal'`),
  check('crm_contacts_nome', sql`char_length(btrim(${t.nome})) BETWEEN 1 AND 120`),
  check('crm_contacts_email', sql`char_length(${t.email}) BETWEEN 3 AND 254 AND ${t.email} LIKE '%_@_%'`),
  check('crm_contacts_cargo', sql`${t.cargo} IS NULL OR char_length(${t.cargo}) <= 80`),
]);
