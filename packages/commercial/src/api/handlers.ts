// Handlers de API do módulo comercial: funções puras (ctx, entrada não validada) => HttpResult.
// O Backend monta as rotas (ver ROUTES em index.ts): autentica, calcula ctx.actor, hidrata/persiste o estado e traduz HttpResult.
import { z } from 'zod';
import { IsoDate, Id, Lead as LeadContract, isEnabled } from '@ln/contracts';
import { CATALOG } from '../catalog';
import { define, fail, ok } from './http';
import {
  campaignDetail, formatCatalogView, inventoryCalendar, inventoryOverview, leadInbox, mediaKitPage, opportunityBoard, studioDashboard,
} from '../queries';
import type { FormatStatus } from '../types';
import { adPlan, ALLOWED_MIME, resolveClickDestination, validateCreative } from '../creative';
import type { ServeResult } from '../rotation';

const formatIds = (ids: string[]) => ids.filter((id) => !CATALOG.some((f) => f.id === id));
const PositionId = z.enum(['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER', 'ARTICLE_INLINE', 'HOME_BETWEEN', 'AGENDA', 'DATA']);
const FormatStatusSchema = z.enum(['disponivel', 'sob_consulta', 'indisponivel']);

// ---------- público (Portal) ----------
export const getMediaKit = define({ auth: 'public', schema: z.object({}).default({}) }, (ctx) => ok(mediaKitPage(ctx)));

export const listFormats = define({ auth: 'public', schema: z.object({ section: z.string().optional(), status: FormatStatusSchema.optional() }) },
  (ctx, i) => ok(formatCatalogView(ctx, { section: i.section, status: i.status as FormatStatus | undefined })));

export const getAvailability = define({ auth: 'public', schema: z.object({ positionId: PositionId, from: IsoDate, to: IsoDate }) },
  (ctx, i) => ok(ctx.inventory.availability(i.positionId, i.from, i.to)));

/** Lead do mídia kit. Não cria reserva. Consentimento é gravado com o horário do servidor; opt-in da newsletter nunca vem marcado. */
export const submitLead = define({
  auth: 'public',
  schema: LeadContract.omit({ id: true, consentimentoEm: true, classeDeDado: true }).strict(),
}, (ctx, i) => {
  const unknown = formatIds(i.formatosInteresse);
  if (unknown.length) return fail(422, 'UNKNOWN_FORMAT', 'Formato de interesse desconhecido.', { formatIds: unknown });
  const lead = ctx.crm.captureLead({
    name: i.nome, company: i.empresa, email: i.email, whatsapp: i.whatsapp, formatIds: i.formatosInteresse,
    objective: i.objetivo, message: i.mensagem, newsletterOptIn: i.optInNewsletter,
  }, ctx.now);
  // Resposta mínima: o visitante não recebe de volta dado pessoal além do protocolo.
  return ok({ id: lead.id, status: lead.status, consentimentoEm: lead.consentAt }, 201);
});

// ---------- ad server público ----------
const ServeInput = z.object({ positionId: PositionId, pageViewId: z.string().min(1).max(128), isBot: z.boolean().optional(), isInternal: z.boolean().optional() });
/** Serve o anúncio da posição. Com a flag `adServerVendas` desligada nada é servido (house) e nada é contado. */
export const serveAd = define({ auth: 'public', schema: ServeInput }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return ok<ServeResult>({ kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'ad server desligado (flag adServerVendas)' });
  return ok(ctx.ads.serve({ positionId: i.positionId, today: ctx.today, pageViewId: i.pageViewId, isBot: i.isBot, isInternal: i.isInternal, nowMs: Date.parse(ctx.now) }));
});
export const recordAdEvent = define({ auth: 'public', schema: z.object({ impressionId: z.string().min(1), event: z.enum(['visible', 'click']) }) }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return ok({ counted: false });
  return ok({ counted: i.event === 'visible' ? ctx.ads.recordVisible(i.impressionId, Date.parse(ctx.now)) : ctx.ads.recordClick(i.impressionId, Date.parse(ctx.now)) });
});

const csv = (v: unknown) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v);
/**
 * Plano das posições para o portal renderizar: quais posições têm criativo real elegível hoje. NÃO conta impressão.
 * Posição sem criativo real => available:false e o portal a oculta. Com a flag adServerVendas desligada, nenhuma está disponível.
 */
export const getAdPlan = define({ auth: 'public', schema: z.object({ positions: z.preprocess(csv, z.array(PositionId).max(9).optional()) }) }, (ctx, i) => {
  const slots = isEnabled('adServerVendas', ctx.flags) ? adPlan(ctx.ads.listCreatives(), ctx.today, i.positions) : adPlan([], ctx.today, i.positions);
  return ok({ today: ctx.today, slots });
});

/**
 * Destino do clique: sai do criativo cadastrado, nunca de URL do cliente (sem redirecionamento aberto). O Backend registra o clique
 * (quando há impressionId) e responde 302 para destination. Desconhecido, pausado ou inválido => 404.
 */
export const resolveAdClick = define({ auth: 'public', schema: z.object({ ref: z.string().min(1).max(160) }) }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return fail(404, 'NOT_FOUND', 'Anúncio indisponível.');
  const r = resolveClickDestination(i.ref, ctx.ads.listCreatives().filter((c) => c.campaignActive), (imp) => ctx.ads.ledger.byImpressionId(imp)?.creativeId);
  return r ? ok(r) : fail(404, 'NOT_FOUND', 'Anúncio indisponível.');
});

/** Arquivo do criativo para a entrega pública: só de criativo real, aprovado, em campanha ativa e dentro do período. */
export const resolveCreativeImage = define({ auth: 'public', schema: z.object({ id: Id }) }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return fail(404, 'NOT_FOUND', 'Arquivo indisponível.');
  const c = ctx.ads.listCreatives().find((x) => x.id === i.id);
  const live = c && c.asset && c.approved && c.campaignActive && c.startDate <= ctx.today && ctx.today <= c.endDate && validateCreative(c).length === 0;
  return live ? ok({ key: c.asset!.key, mime: c.asset!.mime, sizeKB: c.asset!.sizeKB, sha256: c.asset!.sha256 ?? null }) : fail(404, 'NOT_FOUND', 'Arquivo indisponível.');
});

// ---------- Studio (exige ctx.actor.canManageCommercial) ----------
export const getStudioDashboard = define({ auth: 'studio', schema: z.object({ from: IsoDate, to: IsoDate }) }, (ctx, i) => ok(studioDashboard(ctx, i.from, i.to)));
export const getInventoryOverview = define({ auth: 'studio', schema: z.object({ from: IsoDate, to: IsoDate }) }, (ctx, i) => ok(inventoryOverview(ctx, i.from, i.to)));
export const getInventoryCalendar = define({ auth: 'studio', schema: z.object({ positionId: PositionId, from: IsoDate, to: IsoDate }) }, (ctx, i) => ok(inventoryCalendar(ctx, i.positionId, i.from, i.to)));
export const getLeadInbox = define({ auth: 'studio', schema: z.object({ status: z.enum(['novo', 'qualificado', 'descartado', 'convertido']).optional() }) }, (ctx, i) => ok(leadInbox(ctx, i)));
export const getOpportunityBoard = define({ auth: 'studio', schema: z.object({}).default({}) }, (ctx) => ok(opportunityBoard(ctx)));
export const getCampaignDetail = define({ auth: 'studio', schema: z.object({ campaignId: Id }) }, (ctx, i) => ok(campaignDetail(ctx, i.campaignId)));

export const qualifyLead = define({ auth: 'studio', schema: z.object({ leadId: Id }) }, (ctx, i) => ok(ctx.crm.qualifyLead(i.leadId)));
export const discardLead = define({ auth: 'studio', schema: z.object({ leadId: Id }) }, (ctx, i) => ok(ctx.crm.discardLead(i.leadId)));
export const convertLead = define({ auth: 'studio', schema: z.object({ leadId: Id, title: z.string().min(1).optional() }) }, (ctx, i) => ok(ctx.crm.convertLead(i.leadId, ctx.now, i.title), 201));
export const moveOpportunityStage = define({
  auth: 'studio',
  schema: z.object({
    opportunityId: Id, to: z.enum(['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido']),
    lostReason: z.string().optional(), nextAction: z.string().optional(), nextActionDue: IsoDate.optional(), amountBRL: z.number().nonnegative().finite().optional(),
  }),
}, (ctx, i) => ok(ctx.crm.moveStage(i.opportunityId, i.to, ctx.now, i)));

export const createReservation = define({
  auth: 'studio',
  schema: z.object({ positionId: PositionId, accountId: Id, campaignId: Id.optional(), startDate: IsoDate, endDate: IsoDate, confirm: z.boolean().default(false) }),
}, (ctx, i) => {
  const slot = ctx.inventory.position(i.positionId);
  const fmt = ctx.catalog.find((f) => f.id === slot.formatId);
  if (!fmt || fmt.status === 'indisponivel') return fail(422, 'FORMAT_UNAVAILABLE', `Formato de ${i.positionId} indisponível: ${fmt?.statusReason ?? 'desconhecido'}`);
  // Confirmar reserva (venda) só com formato disponível e ad server liberado (CP-12). Sem isso, apenas pré-reserva (held).
  if (i.confirm && (fmt.status !== 'disponivel' || !isEnabled('adServerVendas', ctx.flags))) {
    return fail(409, 'SALE_NOT_ENABLED', 'Confirmação exige formato disponível e flag adServerVendas ligada; use pré-reserva.');
  }
  return ok(ctx.inventory.reserve({ positionId: i.positionId, advertiserId: i.accountId, campaignId: i.campaignId, startDate: i.startDate, endDate: i.endDate, status: i.confirm ? 'confirmed' : 'held' }), 201);
});
export const cancelReservation = define({ auth: 'studio', schema: z.object({ reservationId: Id }) }, (ctx, i) => {
  if (!ctx.inventory.list().some((r) => r.id === i.reservationId)) return fail(404, 'NOT_FOUND', 'Reserva não existe.');
  const res = ctx.inventory.list().find((r) => r.id === i.reservationId)!;
  const camp = res.campaignId ? ctx.campaigns.list().find((c) => c.id === res.campaignId) : undefined;
  if (camp && camp.status === 'active') return fail(409, 'RESERVATION_IN_USE', 'Reserva de campanha ativa: pause ou encerre a campanha antes de cancelar.');
  ctx.inventory.cancel(i.reservationId);
  return ok({ id: i.reservationId, status: 'cancelled' as const });
});
/** Takeover bloqueia o portal para os demais no dia: é compromisso comercial, não preparação. Exige flag ligada e formato 'disponivel'. */
export const reserveTakeover = define({ auth: 'studio', schema: z.object({ date: IsoDate, accountId: Id, agreedCampaignIds: z.array(Id).default([]) }) }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return fail(409, 'SALE_NOT_ENABLED', 'Takeover exige a flag adServerVendas ligada.');
  const fmt = ctx.catalog.find((f) => f.id === 'banners--takeover-do-portal');
  if (!fmt || fmt.status !== 'disponivel') return fail(409, 'FORMAT_NOT_AVAILABLE', `Takeover do portal está '${fmt?.status ?? 'desconhecido'}', não 'disponivel'.`);
  if (!ctx.crm.accounts.has(i.accountId)) return fail(422, 'UNKNOWN_ACCOUNT', 'Conta inexistente.');
  return ok(ctx.inventory.reserveTakeover({ date: i.date, advertiserId: i.accountId, agreedCampaignIds: i.agreedCampaignIds }), 201);
});

export const createCampaign = define({
  auth: 'studio',
  schema: z.object({ name: z.string().min(1), accountId: Id, opportunityId: Id.optional(), formatId: z.string().min(1), positionId: PositionId.optional(), startDate: IsoDate, endDate: IsoDate, sponsoredLabel: z.boolean().optional() })
    .refine((c) => c.endDate >= c.startDate, { message: 'endDate anterior a startDate', path: ['endDate'] }),
}, (ctx, i) => {
  const fmt = ctx.catalog.find((f) => f.id === i.formatId);
  if (!fmt) return fail(422, 'UNKNOWN_FORMAT', 'Formato desconhecido.');
  if (fmt.status === 'indisponivel') return fail(422, 'FORMAT_UNAVAILABLE', fmt.statusReason);
  if (!ctx.crm.accounts.has(i.accountId)) return fail(422, 'UNKNOWN_ACCOUNT', 'Conta inexistente.');
  return ok(ctx.campaigns.create(i, ctx.now), 201);
});

const AssetSchema = z.object({ key: z.string().min(1).max(300), mime: z.enum(ALLOWED_MIME), width: z.number().int().positive(), height: z.number().int().positive(), sizeKB: z.number().positive().finite(), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() });
const CreativeContent = { asset: AssetSchema.optional(), altText: z.string().max(200).optional(), destinationUrl: z.string().max(2000).optional(), advertiserName: z.string().max(80).optional() };

export const addCreative = define({
  auth: 'studio',
  schema: z.object({ campaignId: Id, positionId: PositionId, weight: z.number().positive().finite().default(1), startDate: IsoDate, endDate: IsoDate, ...CreativeContent }),
}, (ctx, i) => {
  const c = ctx.campaigns.get(i.campaignId);
  const id = `cr-${ctx.ads.listCreatives().length + 1}`;
  const advertiserName = i.advertiserName ?? ctx.crm.accounts.get(c.accountId)?.name;
  ctx.ads.addCreative({
    id, campaignId: c.id, positionId: i.positionId, weight: i.weight, startDate: i.startDate, endDate: i.endDate, approved: false,
    campaignActive: c.status === 'active', label: 'publicidade', asset: i.asset, altText: i.altText, destinationUrl: i.destinationUrl, advertiserName,
  });
  return ok({ id, approved: false, issues: validateCreative(ctx.ads.listCreatives().find((x) => x.id === id)!) }, 201);
});

/** Define/troca o arquivo, o alt e o destino. Qualquer alteração de conteúdo REVOGA a aprovação (precisa aprovar de novo). */
export const setCreativeContent = define({ auth: 'studio', schema: z.object({ creativeId: Id, ...CreativeContent }) }, (ctx, i) => {
  const cr = ctx.ads.listCreatives().find((x) => x.id === i.creativeId);
  if (!cr) return fail(404, 'NOT_FOUND', 'Criativo não existe.');
  const { creativeId, ...patch } = i;
  ctx.ads.setCreative(creativeId, { ...patch, approved: false });
  return ok({ id: creativeId, approved: false, issues: validateCreative(ctx.ads.listCreatives().find((x) => x.id === creativeId)!) });
});

/** Aprovar exige criativo real: arquivo válido para a posição, alt, anunciante e destino https. */
export const approveCreative = define({ auth: 'studio', schema: z.object({ creativeId: Id }) }, (ctx, i) => {
  const cr = ctx.ads.listCreatives().find((x) => x.id === i.creativeId);
  if (!cr) return fail(404, 'NOT_FOUND', 'Criativo não existe.');
  const issues = validateCreative(cr);
  if (issues.length) return fail(422, 'CREATIVE_INVALID', 'Criativo incompleto ou fora da especificação da posição.', issues);
  ctx.ads.setCreative(cr.id, { approved: true });
  return ok({ id: cr.id, approved: true });
});

const ACTIVE_LIKE = new Set(['active']);
/**
 * Transição de campanha. Para 'reserved' as reservas informadas são resolvidas no inventário (devem existir, não canceladas e ser desta campanha).
 * Para 'active' (inclusive retomar de 'paused') a evidência é montada do estado real: flag adServerVendas, estado do formato no catálogo,
 * reservas da campanha e criativos aprovados; o domínio recusa se qualquer condição faltar.
 */
export const transitionCampaign = define({
  auth: 'studio',
  schema: z.object({ campaignId: Id, to: z.enum(['reserved', 'approved', 'active', 'paused', 'completed', 'cancelled']), reservationIds: z.array(Id).optional(), note: z.string().optional() }),
}, (ctx, i) => {
  const camp = ctx.campaigns.get(i.campaignId);
  const all = ctx.inventory.list();
  let reservations;
  if (i.to === 'reserved') {
    const missing = (i.reservationIds ?? []).filter((id) => !all.some((r) => r.id === id));
    if (missing.length) return fail(422, 'INVALID_RESERVATION', 'Reserva inexistente.', { reservationIds: missing });
    reservations = all.filter((r) => i.reservationIds?.includes(r.id));
  }
  const activation = i.to === 'active' ? {
    saleEnabled: isEnabled('adServerVendas', ctx.flags),
    formatStatus: ctx.catalog.find((f) => f.id === camp.formatId)?.status ?? 'indisponivel',
    reservations: all.filter((r) => r.campaignId === camp.id),
    approvedCreativeCount: ctx.ads.creativesOf(camp.id).filter((c) => c.approved).length,
  } : undefined;
  const c = ctx.campaigns.transition(i.campaignId, i.to, ctx.now, { reservations, activation, note: i.note });
  for (const cr of ctx.ads.creativesOf(c.id)) ctx.ads.setCreative(cr.id, { campaignActive: ACTIVE_LIKE.has(c.status) });
  return ok(c);
});

export const getCampaignReport = getCampaignDetail;

/** Entrada de métrica real (conectores GA4/ESP/CMS). Recusa valor sem origem, período e horário. */
export const ingestMetric = define({
  auth: 'studio',
  schema: z.object({ source: z.string().min(1), metric: z.string().min(1), value: z.number().finite(), period_start: z.iso.datetime({ offset: true }), period_end: z.iso.datetime({ offset: true }), fetched_at: z.iso.datetime({ offset: true }), methodology_version: z.string().optional() }),
}, (ctx, i) => ok(ctx.metrics.ingest(i), 201));
