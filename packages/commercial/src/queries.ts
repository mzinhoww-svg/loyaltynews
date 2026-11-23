// Consultas que alimentam as telas: mídia kit público (Portal) e Studio comercial. Funções puras sobre o contexto.
// Nenhuma consulta inventa número: sem dado => null/lista vazia/estado vazio explícito.
import { isEnabled } from '@ln/contracts';
import { priceLabel } from './catalog';
import { auditabilityOf, campaignPeriodMs } from './audit';
import { generateMediaKit, portalAudience, portalCoverage, type MediaKit, type PortalAudience, type PortalMetric } from './mediakit';
import { POSITIONS } from './inventory';
import type { CommercialCtx } from './state';
import type { FormatStatus } from './types';
import type { OpportunityStage } from './crm';
import type { CampaignStatus } from './campaigns';

// ---------- Portal: página do mídia kit ----------
export interface MediaKitPage extends MediaKit {
  /** O que a tela pode oferecer. Instagram e The Loyal seguem desligados até P-01/P-02. */
  capabilities: { adServerVendas: boolean; instagram: boolean; theLoyal: boolean; retargeting: boolean };
  /** Integridade da entrega de anúncios: lacunas em que o dedupe perdeu estado. Vazio = nenhuma lacuna registrada. */
  /** Audiência no formato do portal (origem, janela e horário em cada número; sem coleta = indisponível). */
  audience: PortalAudience;
  /** Cobertura do CMS coletada (matérias em 30/90 dias, eventos futuros), com origem, janela e data; sem coleta = indisponível. */
  coverage: PortalMetric[];
  deliveryIntegrity: { gaps: readonly import('./audit').AuditGap[]; note: string | null };
}
export function mediaKitPage(ctx: CommercialCtx): MediaKitPage {
  return {
    ...generateMediaKit({ store: ctx.metrics, now: ctx.now, catalog: ctx.catalog }),
    capabilities: {
      adServerVendas: isEnabled('adServerVendas', ctx.flags), instagram: isEnabled('instagram', ctx.flags),
      theLoyal: isEnabled('theLoyal', ctx.flags), retargeting: isEnabled('retargeting', ctx.flags),
    },
    audience: portalAudience(ctx.metrics, ctx.now),
    coverage: portalCoverage(ctx.metrics, ctx.now),
    deliveryIntegrity: { gaps: ctx.ads.audit.list(), note: ctx.ads.audit.list().length ? 'Há período(s) não auditável(is) na entrega de anúncios: os números desses períodos são mínimos, não totais.' : null },
  };
}

export function formatCatalogView(ctx: CommercialCtx, filter: { section?: string; status?: FormatStatus } = {}) {
  const rows = ctx.catalog.filter((f) => (!filter.section || f.section === filter.section) && (!filter.status || f.status === filter.status));
  return {
    total: rows.length,
    sections: [...new Set(ctx.catalog.map((f) => f.section))],
    formats: rows.map((f) => ({ id: f.id, section: f.section, name: f.name, price: priceLabel(f), priceBRL: f.fromBRL, priceType: f.priceType, unit: f.unit, scope: f.scope, status: f.status, statusReason: f.statusReason })),
    note: 'Preço é referência comercial, não oferta; disponibilidade é real.',
  };
}

// ---------- Studio: inventário ----------
export function inventoryOverview(ctx: CommercialCtx, from: string, to: string) {
  return POSITIONS.map((p) => {
    const a = ctx.inventory.availability(p.id, from, to);
    return {
      positionId: p.id, name: p.name, desktop: p.desktop, mobile: p.mobile, slotLimit: a.slotLimit, peakUsed: a.peakUsed, free: a.free,
      occupancy: a.slotLimit === null ? null : a.peakUsed / a.slotLimit, // null = posição não configurada (não é 0%)
      configured: a.configured, blockedByTakeover: a.blockedByTakeover, note: a.note ?? null,
    };
  });
}
export function inventoryCalendar(ctx: CommercialCtx, positionId: string, from: string, to: string) {
  const p = ctx.inventory.position(positionId);
  return { positionId, name: p.name, slotLimit: p.slotLimit, days: ctx.inventory.dailyUsage(positionId, from, to) };
}

// ---------- Studio: CRM ----------
const STAGES: OpportunityStage[] = ['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
export function opportunityBoard(ctx: CommercialCtx) {
  const all = [...ctx.crm.opportunities.values()];
  return STAGES.map((stage) => ({
    stage,
    items: all.filter((o) => o.stage === stage).map((o) => ({
      id: o.id, title: o.title, accountId: o.accountId, accountName: ctx.crm.accounts.get(o.accountId)?.name ?? null,
      amountBRL: o.amountBRL, nextAction: o.nextAction, nextActionDue: o.nextActionDue, proposalVersions: o.proposalVersions, lostReason: o.lostReason,
      overdue: o.nextActionDue !== null && o.nextActionDue < ctx.today && stage !== 'ganho' && stage !== 'perdido',
    })),
  }));
}
/** Caixa de entrada de leads (dado pessoal: só para Studio autorizado). Mais recentes primeiro. */
export function leadInbox(ctx: CommercialCtx, filter: { status?: string } = {}) {
  return [...ctx.crm.leads.values()]
    .filter((l) => !filter.status || l.status === filter.status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((l) => ({ id: l.id, name: l.name, company: l.company, email: l.email, whatsapp: l.whatsapp, formatIds: l.formatIds, objective: l.objective, message: l.message, newsletterOptIn: l.newsletterOptIn, consentAt: l.consentAt, status: l.status, createdAt: l.createdAt, accountId: l.accountId }));
}

// ---------- Studio: campanhas ----------
export function campaignDetail(ctx: CommercialCtx, campaignId: string) {
  const c = ctx.campaigns.get(campaignId);
  const delivery = ctx.ads.campaignDelivery(campaignId);
  return {
    campaign: c,
    format: ctx.catalog.find((f) => f.id === c.formatId) ?? null,
    position: c.positionId ? ctx.inventory.position(c.positionId) : null,
    reservations: ctx.inventory.list().filter((r) => r.campaignId === campaignId),
    creatives: ctx.ads.creativesOf(campaignId),
    report: {
      ...delivery,
      auditability: auditabilityOf(ctx.ads.audit, ...campaignPeriodMs(c.startDate, c.endDate)),
      daysTotal: Math.round((Date.parse(c.endDate + 'T00:00:00Z') - Date.parse(c.startDate + 'T00:00:00Z')) / 86_400_000) + 1,
      visibleRate: delivery.served > 0 ? delivery.visible / delivery.served : null,
      methodology: 'Impressões servidas e visíveis são separadas; cliques válidos contam uma vez por impressão; bots, tráfego interno e auto-refresh são excluídos. Visitas por UTM, leitura de matérias e cliques de newsletter dependem de analytics e não estão disponíveis.',
      utmVisits: null, // sem analytics conectado: não disponível, nunca 0
    },
  };
}

// ---------- Studio: painel ----------
export function studioDashboard(ctx: CommercialCtx, from: string, to: string) {
  const formatsByStatus: Record<FormatStatus, number> = { disponivel: 0, sob_consulta: 0, indisponivel: 0 };
  for (const f of ctx.catalog) formatsByStatus[f.status]++;
  const campaignsByStatus: Record<CampaignStatus, number> = { draft: 0, reserved: 0, approved: 0, active: 0, paused: 0, completed: 0, cancelled: 0 };
  for (const c of ctx.campaigns.list()) campaignsByStatus[c.status]++;
  const attention: { kind: string; ref: string; message: string }[] = [];
  for (const c of ctx.campaigns.list()) {
    if (c.status === 'active' && !ctx.ads.creativesOf(c.id).some((x) => x.approved)) attention.push({ kind: 'campanha_sem_criativo_aprovado', ref: c.id, message: `Campanha ${c.name} ativa sem criativo aprovado.` });
  }
  for (const p of POSITIONS) if (p.slotLimit === null) attention.push({ kind: 'posicao_nao_configurada', ref: p.id, message: `${p.id} sem limite/dimensões: não reservável.` });
  for (const g of ctx.ads.audit.list()) attention.push({ kind: 'periodo_nao_auditavel', ref: g.id, message: `Entrega não auditável de ${g.from} a ${g.to} (${g.reason}); ${g.uncountedServes} impressões e ${g.ignoredEvents} eventos sem contagem.` });
  const metrics = ctx.metrics.all().map((m) => ({ ...ctx.metrics.get({ source: m.source, metric: m.metric }, ctx.now), }));
  return {
    period: { from, to },
    formatsByStatus,
    leads: { novos: [...ctx.crm.leads.values()].filter((l) => l.status === 'novo').length, total: ctx.crm.leads.size },
    pipeline: ctx.crm.pipeline(),
    campaignsByStatus,
    inventory: inventoryOverview(ctx, from, to),
    metrics, metricsEmpty: metrics.length === 0,
    attention,
    sellingEnabled: isEnabled('adServerVendas', ctx.flags),
  };
}
