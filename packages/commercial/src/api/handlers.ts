// Handlers de API do módulo comercial: funções puras (ctx, entrada não validada) => HttpResult.
// O Backend monta as rotas (ver ROUTES em index.ts): autentica, calcula ctx.actor, hidrata/persiste o estado e traduz HttpResult.
import { z } from 'zod';
import { IsoDate, Id, Lead as LeadContract, isEnabled } from '@ln/contracts';
import { CATALOG } from '../catalog.js';
import { define, fail, ok } from './http.js';
import {
  campaignDetail, formatCatalogView, inventoryCalendar, inventoryOverview, leadInbox, mediaKitPage, opportunityBoard, studioDashboard,
} from '../queries.js';
import type { FormatStatus } from '../types.js';

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
  if (!isEnabled('adServerVendas', ctx.flags)) return ok({ kind: 'house' as const, creativeId: null, impressionId: null, counted: false, reason: 'ad server desligado (flag adServerVendas)' });
  return ok(ctx.ads.serve({ positionId: i.positionId, today: ctx.today, pageViewId: i.pageViewId, isBot: i.isBot, isInternal: i.isInternal }));
});
export const recordAdEvent = define({ auth: 'public', schema: z.object({ impressionId: z.string().min(1), event: z.enum(['visible', 'click']) }) }, (ctx, i) => {
  if (!isEnabled('adServerVendas', ctx.flags)) return ok({ counted: false });
  return ok({ counted: i.event === 'visible' ? ctx.ads.recordVisible(i.impressionId) : ctx.ads.recordClick(i.impressionId) });
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
  ctx.inventory.cancel(i.reservationId);
  return ok({ id: i.reservationId, status: 'cancelled' as const });
});
export const reserveTakeover = define({ auth: 'studio', schema: z.object({ date: IsoDate, accountId: Id, agreedCampaignIds: z.array(Id).default([]) }) },
  (ctx, i) => ok(ctx.inventory.reserveTakeover({ date: i.date, advertiserId: i.accountId, agreedCampaignIds: i.agreedCampaignIds }), 201));

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

export const addCreative = define({
  auth: 'studio',
  schema: z.object({ campaignId: Id, positionId: PositionId, weight: z.number().positive().finite().default(1), startDate: IsoDate, endDate: IsoDate }),
}, (ctx, i) => {
  const c = ctx.campaigns.get(i.campaignId);
  const id = `cr-${ctx.ads.listCreatives().length + 1}`;
  ctx.ads.addCreative({ id, campaignId: c.id, positionId: i.positionId, weight: i.weight, startDate: i.startDate, endDate: i.endDate, approved: false, campaignActive: c.status === 'active', label: 'publicidade' });
  return ok({ id, approved: false }, 201);
});
export const approveCreative = define({ auth: 'studio', schema: z.object({ creativeId: Id }) }, (ctx, i) => {
  if (!ctx.ads.listCreatives().some((c) => c.id === i.creativeId)) return fail(404, 'NOT_FOUND', 'Criativo não existe.');
  ctx.ads.setCreative(i.creativeId, { approved: true });
  return ok({ id: i.creativeId, approved: true });
});

const ACTIVE_LIKE = new Set(['active']);
export const transitionCampaign = define({
  auth: 'studio',
  schema: z.object({ campaignId: Id, to: z.enum(['reserved', 'approved', 'active', 'paused', 'completed', 'cancelled']), reservationIds: z.array(Id).optional(), note: z.string().optional() }),
}, (ctx, i) => {
  if (i.to === 'active' && !isEnabled('adServerVendas', ctx.flags)) return fail(409, 'SALE_NOT_ENABLED', 'Ativar campanha exige a flag adServerVendas ligada.');
  const hasApproved = ctx.ads.creativesOf(i.campaignId).some((c) => c.approved);
  const c = ctx.campaigns.transition(i.campaignId, i.to, ctx.now, { reservationIds: i.reservationIds, hasApprovedCreative: hasApproved, note: i.note });
  for (const cr of ctx.ads.creativesOf(c.id)) ctx.ads.setCreative(cr.id, { campaignActive: ACTIVE_LIKE.has(c.status) });
  return ok(c);
});

export const getCampaignReport = getCampaignDetail;

/** Entrada de métrica real (conectores GA4/ESP/CMS). Recusa valor sem origem, período e horário. */
export const ingestMetric = define({
  auth: 'studio',
  schema: z.object({ source: z.string().min(1), metric: z.string().min(1), value: z.number().finite(), period_start: z.iso.datetime({ offset: true }), period_end: z.iso.datetime({ offset: true }), fetched_at: z.iso.datetime({ offset: true }), methodology_version: z.string().optional() }),
}, (ctx, i) => ok(ctx.metrics.ingest(i), 201));
