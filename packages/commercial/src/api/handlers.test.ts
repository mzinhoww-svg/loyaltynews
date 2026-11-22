import { describe, expect, it } from 'vitest';
import { ApiError } from '@ln/contracts';
import { createCommercialState, makeCtx, type CommercialCtx } from '../state.js';
import * as h from './index.js';

const NOW = '2026-11-22T12:00:00-03:00';
const studio = { id: 'u1', canManageCommercial: true };
function ctx(over: Partial<{ flags: CommercialCtx['flags']; actor: CommercialCtx['actor']; today: string }> = {}, state = createCommercialState()) {
  return makeCtx(state, { now: NOW, today: over.today ?? '2026-12-05', flags: over.flags, actor: 'actor' in over ? over.actor : studio });
}
const code = (r: h.HttpResult) => ApiError.parse(r.body).error.code;

describe('contrato dos handlers', () => {
  it('toda rota tem handler, caminho único e auth declarada', () => {
    expect(new Set(h.ROUTES.map((r) => `${r.method} ${r.path}`)).size).toBe(h.ROUTES.length);
    for (const r of h.ROUTES) { expect(typeof r.handler).toBe('function'); expect(r.path.startsWith('/api/commercial/')).toBe(true); }
    expect(h.ROUTES.filter((r) => r.path.includes('/studio/')).every((r) => r.auth === 'studio')).toBe(true);
  });
  it('erros usam o envelope ApiError do contrato', () => {
    const r = h.submitLead(ctx(), { nome: 'x' });
    expect(r.status).toBe(400);
    expect(ApiError.safeParse(r.body).success).toBe(true);
  });
  it('handlers de Studio: 401 sem ator, 403 sem permissão, nunca executam', () => {
    const c0 = ctx({ actor: undefined });
    const r0 = h.getLeadInbox(c0, {});
    expect([r0.status, code(r0)]).toEqual([401, 'UNAUTHENTICATED']);
    const r1 = h.getLeadInbox(ctx({ actor: { id: 'x', canManageCommercial: false } }), {});
    expect([r1.status, code(r1)]).toEqual([403, 'FORBIDDEN']);
    const r2 = h.createCampaign(c0, { name: 'x' });
    expect(r2.status).toBe(401); // auth antes da validação: não revela o schema
  });
});

describe('público', () => {
  it('mídia kit sem analytics: estado vazio honesto, nenhuma audiência', () => {
    const r = h.getMediaKit(ctx({ actor: undefined }), undefined);
    expect(r.status).toBe(200);
    const kit = r.body as ReturnType<typeof import('../queries.js').mediaKitPage>;
    expect(kit.blocks.catalogo.total).toBe(47);
    expect(kit.blocks.audiencia.metrics.every((m) => m.record.value === null)).toBe(true);
    expect(kit.capabilities).toEqual({ adServerVendas: false, instagram: false, theLoyal: false, retargeting: false });
  });
  it('lista formatos com filtros; filtro inválido => 400', () => {
    const all = h.listFormats(ctx({ actor: undefined }), {}).body as { total: number };
    expect(all.total).toBe(47);
    const ban = h.listFormats(ctx({ actor: undefined }), { section: 'Banners' }).body as { total: number };
    expect(ban.total).toBe(8);
    const ind = h.listFormats(ctx({ actor: undefined }), { status: 'indisponivel' }).body as { formats: { status: string }[] };
    expect(ind.formats.every((f) => f.status === 'indisponivel')).toBe(true);
    expect(h.listFormats(ctx({ actor: undefined }), { status: 'ativo' }).status).toBe(400);
  });
  it('disponibilidade: posição inexistente => 400 (schema); período inválido => 400; ok => cotas', () => {
    const c = ctx({ actor: undefined });
    expect(h.getAvailability(c, { positionId: 'NOPE', from: '2026-12-01', to: '2026-12-31' }).status).toBe(400);
    expect(h.getAvailability(c, { positionId: 'TOP', from: '2026-12-31', to: '2026-12-01' }).status).toBe(422);
    expect((h.getAvailability(c, { positionId: 'TOP', from: '2026-12-01', to: '2026-12-31' }).body as { free: number }).free).toBe(4);
    expect((h.getAvailability(c, { positionId: 'AGENDA', from: '2026-12-01', to: '2026-12-31' }).body as { free: null }).free).toBeNull();
  });
  it('lead: válido => 201 só com protocolo; opt-in default false; formato desconhecido => 422; campo extra => 400; não cria reserva', () => {
    const c = ctx({ actor: undefined });
    const base = { nome: 'Ana', empresa: 'Acme', email: 'ana@acme.com', objetivo: 'marca', formatosInteresse: ['banners--banner-topo'] };
    const r = h.submitLead(c, base);
    expect(r.status).toBe(201);
    expect(Object.keys(r.body as object).sort()).toEqual(['consentimentoEm', 'id', 'status']);
    const stored = [...c.crm.leads.values()][0]!;
    expect(stored.newsletterOptIn).toBe(false);
    expect(stored.consentAt).toBe(NOW);
    expect(c.inventory.list()).toHaveLength(0);
    expect(code(h.submitLead(c, { ...base, formatosInteresse: ['banners--nao-existe'] }))).toBe('UNKNOWN_FORMAT');
    expect(h.submitLead(c, { ...base, email: 'invalido' }).status).toBe(400);
    expect(h.submitLead(c, { ...base, classeDeDado: 'public' }).status).toBe(400);
    expect(h.submitLead(c, { ...base, optInNewsletter: true }).status).toBe(201);
  });
});

describe('ad server', () => {
  function setup(flags: CommercialCtx['flags']) {
    const c = ctx({ flags });
    c.ads.addCreative({ id: 'cr1', campaignId: 'k1', positionId: 'TOP', weight: 1, startDate: '2026-12-01', endDate: '2026-12-31', approved: true, campaignActive: true });
    return c;
  }
  it('flag adServerVendas desligada: serve house, não conta, eventos ignorados', () => {
    const c = setup({});
    const r = h.serveAd(c, { positionId: 'TOP', pageViewId: 'p1' });
    expect(r.body).toMatchObject({ kind: 'house', counted: false });
    expect(c.ads.delivery('cr1').served).toBe(0);
    expect(h.recordAdEvent(c, { impressionId: 'imp-1', event: 'click' }).body).toEqual({ counted: false });
  });
  it('flag ligada: serve, conta uma vez, refresh não infla, visível e clique uma vez', () => {
    const c = setup({ adServerVendas: true });
    const r1 = h.serveAd(c, { positionId: 'TOP', pageViewId: 'p1' }).body as { impressionId: string; counted: boolean };
    expect(r1.counted).toBe(true);
    expect((h.serveAd(c, { positionId: 'TOP', pageViewId: 'p1' }).body as { counted: boolean }).counted).toBe(false);
    expect(h.recordAdEvent(c, { impressionId: r1.impressionId, event: 'visible' }).body).toEqual({ counted: true });
    expect(h.recordAdEvent(c, { impressionId: r1.impressionId, event: 'visible' }).body).toEqual({ counted: false });
    expect(h.recordAdEvent(c, { impressionId: r1.impressionId, event: 'click' }).body).toEqual({ counted: true });
    expect(c.ads.delivery('cr1')).toMatchObject({ served: 1, visible: 1, clicks: 1, refreshSuppressed: 1 });
    expect(h.serveAd(c, { positionId: 'TOP', pageViewId: '' }).status).toBe(400);
  });
});

describe('fluxo Studio ponta a ponta pelos handlers', () => {
  it('lead → conta/oportunidade → campanha → reserva → criativo → ativação → relatório', () => {
    const state = createCommercialState();
    const pub = makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true } });
    const c = makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true }, actor: studio });
    const lead = h.submitLead(pub, { nome: 'Ana', empresa: 'Acme', email: 'ana@acme.com', objetivo: 'marca', formatosInteresse: ['banners--banner-topo'] }).body as { id: string };
    expect((h.getLeadInbox(c, { status: 'novo' }).body as unknown[]).length).toBe(1);
    h.qualifyLead(c, { leadId: lead.id });
    const conv = h.convertLead(c, { leadId: lead.id }).body as { account: { id: string }; opportunity: { id: string } };
    expect(h.moveOpportunityStage(c, { opportunityId: conv.opportunity.id, to: 'ganho' }).status).toBe(409);
    expect(code(h.moveOpportunityStage(c, { opportunityId: conv.opportunity.id, to: 'perdido' }))).toBe('LOST_REASON_REQUIRED');
    h.moveOpportunityStage(c, { opportunityId: conv.opportunity.id, to: 'qualificado' });
    h.moveOpportunityStage(c, { opportunityId: conv.opportunity.id, to: 'proposta', amountBRL: 9000 });
    h.moveOpportunityStage(c, { opportunityId: conv.opportunity.id, to: 'ganho' });

    const camp = h.createCampaign(c, { name: 'Acme topo', accountId: conv.account.id, opportunityId: conv.opportunity.id, formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' });
    expect(camp.status).toBe(201);
    const campId = (camp.body as { id: string }).id;

    // topo ainda é 'sob_consulta': pode pré-reservar, não confirmar
    expect(code(h.createReservation(c, { positionId: 'TOP', accountId: conv.account.id, campaignId: campId, startDate: '2026-12-01', endDate: '2027-02-28', confirm: true }))).toBe('SALE_NOT_ENABLED');
    expect(code(h.createReservation(c, { positionId: 'TOP', accountId: conv.account.id, startDate: '2026-12-01', endDate: '2026-12-31' }))).toBe('MIN_CONTRACT');
    const res = h.createReservation(c, { positionId: 'TOP', accountId: conv.account.id, campaignId: campId, startDate: '2026-12-01', endDate: '2027-02-28' });
    expect(res.status).toBe(201);
    const resId = (res.body as { id: string }).id;

    expect(code(h.transitionCampaign(c, { campaignId: campId, to: 'active' }))).toBe('BAD_TRANSITION');
    expect(h.transitionCampaign(c, { campaignId: campId, to: 'reserved', reservationIds: [resId] }).status).toBe(200);
    h.transitionCampaign(c, { campaignId: campId, to: 'approved' });
    expect(code(h.transitionCampaign(c, { campaignId: campId, to: 'active' }))).toBe('NO_APPROVED_CREATIVE');
    const cr = h.addCreative(c, { campaignId: campId, positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' }).body as { id: string };
    h.approveCreative(c, { creativeId: cr.id });
    expect(h.transitionCampaign(c, { campaignId: campId, to: 'active' }).status).toBe(200);

    const served = h.serveAd(pub, { positionId: 'TOP', pageViewId: 'pv-1' }).body as { kind: string; impressionId: string };
    expect(served.kind).toBe('creative');
    h.recordAdEvent(pub, { impressionId: served.impressionId, event: 'visible' });
    const detail = h.getCampaignDetail(c, { campaignId: campId }).body as ReturnType<typeof import('../queries.js').campaignDetail>;
    expect(detail.report).toMatchObject({ served: 1, visible: 1, clicks: 0, visibleRate: 1, utmVisits: null });
    expect(detail.reservations).toHaveLength(1);

    h.transitionCampaign(c, { campaignId: campId, to: 'paused' });
    expect((h.serveAd(pub, { positionId: 'TOP', pageViewId: 'pv-2' }).body as { kind: string }).kind).toBe('house'); // pausada não serve
  });
  it('ativar campanha com flag desligada => 409; formato indisponível não vira campanha nem reserva', () => {
    const state = createCommercialState();
    const c = makeCtx(state, { now: NOW, actor: studio });
    const acc = state.crm.createAccount('Acme', NOW);
    expect(code(h.createCampaign(c, { name: 'n', accountId: acc.id, formatId: 'the-loyal--banner-meio', startDate: '2026-12-01', endDate: '2026-12-31' }))).toBe('FORMAT_UNAVAILABLE');
    expect(code(h.createCampaign(c, { name: 'n', accountId: acc.id, formatId: 'x--y', startDate: '2026-12-01', endDate: '2026-12-31' }))).toBe('UNKNOWN_FORMAT');
    expect(code(h.createCampaign(c, { name: 'n', accountId: 'nope', formatId: 'banners--banner-topo', startDate: '2026-12-01', endDate: '2026-12-31' }))).toBe('UNKNOWN_ACCOUNT');
    expect(h.createCampaign(c, { name: 'n', accountId: acc.id, formatId: 'banners--banner-topo', startDate: '2026-12-31', endDate: '2026-12-01' }).status).toBe(400);
    const camp = state.campaigns.create({ name: 'n', accountId: acc.id, formatId: 'banners--banner-topo', startDate: '2026-12-01', endDate: '2027-02-28' }, NOW);
    state.campaigns.transition(camp.id, 'reserved', NOW, { reservationIds: ['r'] }); state.campaigns.transition(camp.id, 'approved', NOW);
    expect(code(h.transitionCampaign(c, { campaignId: camp.id, to: 'active' }))).toBe('SALE_NOT_ENABLED');
  });
  it('reservas e takeover: cancelar libera cota; cancelar inexistente => 404; takeover em dia reservado exige acordo', () => {
    const state = createCommercialState();
    const c = makeCtx(state, { now: NOW, actor: studio });
    const acc = state.crm.createAccount('Acme', NOW);
    const r = h.createReservation(c, { positionId: 'FOOTER', accountId: acc.id, campaignId: 'cmp-x', startDate: '2026-12-01', endDate: '2026-12-31' }).body as { id: string };
    expect(code(h.reserveTakeover(c, { date: '2026-12-10', accountId: 'big' }))).toBe('TAKEOVER_CONFLICT');
    expect(h.reserveTakeover(c, { date: '2026-12-10', accountId: 'big', agreedCampaignIds: ['cmp-x'] }).status).toBe(201);
    expect(code(h.createReservation(c, { positionId: 'SIDEBAR_1', accountId: acc.id, startDate: '2026-12-05', endDate: '2027-01-04' }))).toBe('TAKEOVER_BLOCK');
    expect(h.cancelReservation(c, { reservationId: r.id }).status).toBe(200);
    expect(h.cancelReservation(c, { reservationId: 'nope' }).status).toBe(404);
    expect(code(h.createReservation(c, { positionId: 'AGENDA', accountId: acc.id, startDate: '2026-12-01', endDate: '2026-12-31' }))).toBe('POSITION_NOT_CONFIGURED');
  });
  it('reserva em formato indisponível (The Loyal) é recusada; confirmar com tudo habilitado funciona só para formato disponível', async () => {
    const { buildCatalog } = await import('../catalog.js');
    const state = { ...createCommercialState(), catalog: buildCatalog({ 'banners--banner-rodape': true }) };
    const c = makeCtx(state, { now: NOW, actor: studio, flags: { adServerVendas: true } });
    const acc = state.crm.createAccount('Acme', NOW);
    const r = h.createReservation(c, { positionId: 'FOOTER', accountId: acc.id, startDate: '2026-12-01', endDate: '2026-12-31', confirm: true });
    expect(r.status).toBe(201);
    expect((r.body as { status: string }).status).toBe('confirmed');
    const off = makeCtx(state, { now: NOW, actor: studio });
    expect(code(h.createReservation(off, { positionId: 'FOOTER', accountId: acc.id, startDate: '2027-01-01', endDate: '2027-01-31', confirm: true }))).toBe('SALE_NOT_ENABLED');
  });
});

describe('métricas', () => {
  it('ingestão exige origem, período e horário válidos; aparece no mídia kit com metadados', () => {
    const state = createCommercialState();
    const c = makeCtx(state, { now: NOW, actor: studio });
    expect(h.ingestMetric(c, { source: 'ga4_report', metric: 'sessions_30d', value: 10 }).status).toBe(400);
    expect(h.ingestMetric(c, { source: 'ga4_report', metric: 'sessions_30d', value: 10, period_start: '2026-11-22T00:00:00-03:00', period_end: '2026-10-01T00:00:00-03:00', fetched_at: NOW }).status).toBe(422); // fim < início: erro do domínio
    const ok = h.ingestMetric(c, { source: 'ga4_report', metric: 'sessions_30d', value: 1234, period_start: '2026-10-23T00:00:00-03:00', period_end: '2026-11-21T23:59:59-03:00', fetched_at: NOW });
    expect(ok.status).toBe(201);
    const kit = h.getMediaKit(makeCtx(state, { now: NOW }), undefined).body as ReturnType<typeof import('../queries.js').mediaKitPage>;
    const m = kit.blocks.audiencia.metrics.find((x) => x.record.metric === 'sessions_30d')!;
    expect(m.record).toMatchObject({ source: 'ga4_report', value: 1234, status: 'available', fetched_at: NOW });
  });
});
