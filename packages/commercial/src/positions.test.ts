import { describe, expect, it } from 'vitest';
import { ApiError } from '@ln/contracts';
import { CampaignBook, CampaignError, buildCatalog, buildCampaignReport, createCommercialState, makeCtx, DeliveryAudit, type CommercialCtx, type Reservation } from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-12-05T12:00:00-03:00';
const studio = { id: 'u', canManageCommercial: true };
const code = (r: h.HttpResult) => ApiError.parse(r.body).error.code;
// Banners disponíveis para venda: sem capacidade declarada o formato é 'sob_consulta' e a ativação recusa.
const READY = buildCatalog({ 'banners--banner-rodape': true, 'banners--retangulo-sidebar': true, 'banners--banner-topo': true });

function setup(over: { catalog?: ReturnType<typeof buildCatalog>; flags?: CommercialCtx['flags'] } = {}) {
  const state = { ...createCommercialState(), catalog: over.catalog ?? READY };
  const acc = state.crm.createAccount('Acme Fidelidade', NOW);
  const ctx = makeCtx(state, { now: NOW, today: '2026-12-10', flags: over.flags ?? { adServerVendas: true }, actor: studio });
  const mk = (extra: Record<string, unknown> = {}) => h.createCampaign(ctx, { name: 'Multi', accountId: acc.id, formatId: 'banners--banner-rodape', startDate: '2026-12-01', endDate: '2027-01-31', ...extra });
  return { state, ctx, acc, mk };
}
const idOf = (r: h.HttpResult) => (r.body as { id: string }).id;

describe('campanha com várias posições: criação', () => {
  it('positionIds (várias, sem repetição) e positionId como apelido; positionId = primeira posição', () => {
    const { mk } = setup();
    const a = mk({ positionIds: ['FOOTER', 'SIDEBAR_1', 'FOOTER'] });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ positionIds: ['FOOTER', 'SIDEBAR_1'], positionId: 'FOOTER' });
    const b = mk({ positionId: 'TOP' });
    expect(b.body).toMatchObject({ positionIds: ['TOP'], positionId: 'TOP' });
    const c = mk({});
    expect(c.body).toMatchObject({ positionIds: [], positionId: null });
  });
  it('posição desconhecida => 400; vazia => 400; mais de 9 => 400', () => {
    const { mk } = setup();
    expect(mk({ positionIds: ['NOPE'] }).status).toBe(400);
    expect(mk({ positionIds: [] }).status).toBe(400);
    expect(mk({ positionIds: new Array(10).fill('TOP') }).status).toBe(400);
  });
  it('posição sem dimensão/limite (AGENDA, DATA...) => 422 POSITION_NOT_CONFIGURED; formato indisponível não vira posição', () => {
    const { mk } = setup();
    expect(code(mk({ positionIds: ['FOOTER', 'AGENDA'] }))).toBe('POSITION_NOT_CONFIGURED');
    expect(code(mk({ positionIds: ['DATA'] }))).toBe('POSITION_NOT_CONFIGURED');
  });
});

describe('criativo e reserva só nas posições da campanha', () => {
  it('criativo em posição fora da campanha => 422 POSITION_NOT_IN_CAMPAIGN; campanha sem posições também recusa', () => {
    const { ctx, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER'] }));
    const ok = h.addCreative(ctx, { campaignId: id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER') });
    expect(ok.status).toBe(201);
    const fora = h.addCreative(ctx, { campaignId: id, positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('TOP') });
    expect([fora.status, code(fora)]).toEqual([422, 'POSITION_NOT_IN_CAMPAIGN']);
    const semPos = idOf(mk({}));
    const r = h.addCreative(ctx, { campaignId: semPos, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER') });
    expect(code(r)).toBe('POSITION_NOT_IN_CAMPAIGN');
    expect(JSON.stringify(r.body)).toMatch(/Defina as posições/);
  });
  it('reserva ligada à campanha em posição de fora => 422; sem campanha ou em posição da campanha => ok', () => {
    const { ctx, acc, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER'] }));
    const fora = h.createReservation(ctx, { positionId: 'SIDEBAR_1', accountId: acc.id, campaignId: id, startDate: '2026-12-01', endDate: '2026-12-31' });
    expect([fora.status, code(fora)]).toEqual([422, 'POSITION_NOT_IN_CAMPAIGN']);
    expect(h.createReservation(ctx, { positionId: 'FOOTER', accountId: acc.id, campaignId: id, startDate: '2026-12-01', endDate: '2027-01-31' }).status).toBe(201);
    expect(h.createReservation(ctx, { positionId: 'SIDEBAR_2', accountId: acc.id, startDate: '2026-12-01', endDate: '2026-12-31' }).status).toBe(201); // sem campanha: livre
  });
  it("transição para 'reserved' só aceita reservas das posições da campanha", () => {
    const { ctx, acc, state, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER'] }));
    const other = state.inventory.reserve({ positionId: 'SIDEBAR_1', advertiserId: acc.id, campaignId: id, startDate: '2026-12-01', endDate: '2026-12-31' });
    const r = h.transitionCampaign(ctx, { campaignId: id, to: 'reserved', reservationIds: [other.id] });
    expect([r.status, code(r)]).toEqual([422, 'INVALID_RESERVATION']);
  });
});

describe('ativação exige cobertura confirmada EM CADA posição', () => {
  const R = (id: string, positionId: string, over: Partial<Reservation> = {}): Reservation => ({ id, positionId, advertiserId: 'a', campaignId: 'cmp-1', startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed', ...over });
  const EV = (over: Record<string, unknown> = {}) => ({ saleEnabled: true, formatStatus: 'disponivel' as const, reservations: [R('r1', 'FOOTER'), R('r2', 'SIDEBAR_1')], approvedCreativeCount: 1, creativePositions: ['FOOTER'], ...over });
  function approved(positionIds: string[]) {
    const cb = new CampaignBook();
    const c = cb.create({ name: 'M', accountId: 'a', formatId: 'banners--banner-rodape', positionIds, startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    cb.transition(c.id, 'reserved', NOW, { reservations: positionIds.map((p, i) => R(`r${i + 1}`, p, { status: 'held' })) });
    cb.transition(c.id, 'approved', NOW);
    return { cb, id: c.id };
  }
  const refuses = (cb: CampaignBook, id: string, ev: ReturnType<typeof EV>, c: string, msg?: RegExp) => {
    try { cb.transition(id, 'active', NOW, { activation: ev }); expect.unreachable('deveria recusar'); }
    catch (e) { expect((e as CampaignError).code).toBe(c); if (msg) expect((e as Error).message).toMatch(msg); }
    expect(cb.get(id).status).toBe('approved');
  };

  it('duas posições, as duas cobertas: ativa', () => {
    const { cb, id } = approved(['FOOTER', 'SIDEBAR_1']);
    cb.transition(id, 'active', NOW, { activation: EV() });
    expect(cb.get(id).status).toBe('active');
  });
  it('só uma coberta: recusa e a mensagem lista a posição sem cobertura', () => {
    const { cb, id } = approved(['FOOTER', 'SIDEBAR_1']);
    refuses(cb, id, EV({ reservations: [R('r1', 'FOOTER')] }), 'NO_CONFIRMED_RESERVATION', /em: SIDEBAR_1\./);
  });
  it('uma posição com cobertura parcial do período, em pré-reserva ou cancelada: recusa', () => {
    const { cb, id } = approved(['FOOTER', 'SIDEBAR_1']);
    refuses(cb, id, EV({ reservations: [R('r1', 'FOOTER'), R('r2', 'SIDEBAR_1', { endDate: '2027-01-30' })] }), 'NO_CONFIRMED_RESERVATION', /SIDEBAR_1/);
    refuses(cb, id, EV({ reservations: [R('r1', 'FOOTER'), R('r2', 'SIDEBAR_1', { status: 'held' })] }), 'NO_CONFIRMED_RESERVATION', /SIDEBAR_1/);
    refuses(cb, id, EV({ reservations: [R('r1', 'FOOTER'), R('r2', 'SIDEBAR_1', { status: 'cancelled' })] }), 'NO_CONFIRMED_RESERVATION', /SIDEBAR_1/);
  });
  it('reserva de OUTRA posição não cobre a posição da campanha', () => {
    const { cb, id } = approved(['FOOTER']);
    refuses(cb, id, EV({ reservations: [R('r1', 'TOP')], creativePositions: ['FOOTER'] }), 'NO_CONFIRMED_RESERVATION', /em: FOOTER\./);
  });
  it('campanha sem posições nunca ativa (NO_POSITIONS)', () => {
    const cb = new CampaignBook();
    const c = cb.create({ name: 'M', accountId: 'a', formatId: 'banners--banner-rodape', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    cb.transition(c.id, 'reserved', NOW, { reservations: [R('r1', 'FOOTER', { status: 'held' })] });
    cb.transition(c.id, 'approved', NOW);
    refuses(cb, c.id, EV(), 'NO_POSITIONS');
  });
  it('criativo aprovado em posição fora da campanha: recusa (POSITION_NOT_IN_CAMPAIGN)', () => {
    const { cb, id } = approved(['FOOTER']);
    refuses(cb, id, EV({ reservations: [R('r1', 'FOOTER')], creativePositions: ['FOOTER', 'TOP'] }), 'POSITION_NOT_IN_CAMPAIGN', /TOP/);
  });
  it('todas as falhas aparecem juntas na mensagem', () => {
    const { cb, id } = approved(['FOOTER', 'SIDEBAR_1']);
    try { cb.transition(id, 'active', NOW, { activation: EV({ saleEnabled: false, reservations: [], approvedCreativeCount: 0, creativePositions: ['TOP'] }) }); expect.unreachable('x'); }
    catch (e) { for (const k of ['adServerVendas', 'FOOTER, SIDEBAR_1', 'fora da campanha', 'criativo aprovado']) expect((e as Error).message, k).toContain(k); }
  });
});

describe('ativação pelo handler: formato de CADA posição precisa estar disponível', () => {
  function ready(catalog: ReturnType<typeof buildCatalog>) {
    const { ctx, state, acc, mk } = setup({ catalog });
    const id = idOf(mk({ positionIds: ['FOOTER', 'SIDEBAR_1'] }));
    for (const pos of ['FOOTER', 'SIDEBAR_1']) {
      const r = state.inventory.reserve({ positionId: pos, advertiserId: acc.id, campaignId: id, startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' });
      void r;
    }
    const resIds = state.inventory.list().map((r) => r.id);
    expect(h.transitionCampaign(ctx, { campaignId: id, to: 'reserved', reservationIds: resIds }).status).toBe(200);
    expect(h.transitionCampaign(ctx, { campaignId: id, to: 'approved' }).status).toBe(200);
    for (const pos of ['FOOTER', 'SIDEBAR_1']) {
      const cr = h.addCreative(ctx, { campaignId: id, positionId: pos as 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent(pos) }).body as { id: string };
      h.approveCreative(ctx, { creativeId: cr.id });
    }
    return { ctx, id, state };
  }
  it('as duas posições disponíveis e cobertas: ativa e as DUAS passam a servir', () => {
    const { ctx, id, state } = ready(READY);
    expect(h.transitionCampaign(ctx, { campaignId: id, to: 'active' }).status).toBe(200);
    for (const pos of ['FOOTER', 'SIDEBAR_1'] as const) expect(h.serveAd(ctx, { positionId: pos, pageViewId: `pv-${pos}` }).body).toMatchObject({ kind: 'creative', counted: true });
    expect(state.ads.campaignDelivery(id).served).toBe(2);
  });
  it("uma das posições com formato 'sob_consulta': 409 FORMAT_NOT_AVAILABLE, mesmo com a outra disponível", () => {
    const { ctx, id } = ready(buildCatalog({ 'banners--banner-rodape': true })); // sidebar fica sob consulta
    const r = h.transitionCampaign(ctx, { campaignId: id, to: 'active' });
    expect([r.status, code(r)]).toEqual([409, 'FORMAT_NOT_AVAILABLE']);
  });
});

describe('editar posições (só em rascunho)', () => {
  it('troca em rascunho, registra no histórico; depois de reservada => 409 BAD_STATE', () => {
    const { ctx, state, acc, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER'] }));
    const r = h.setCampaignPositions(ctx, { campaignId: id, positionIds: ['SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_1'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ positionIds: ['SIDEBAR_1', 'SIDEBAR_2'], positionId: 'SIDEBAR_1' });
    expect(state.campaigns.get(id).history.at(-1)).toMatchObject({ note: 'posições: SIDEBAR_1, SIDEBAR_2' });
    const rs = state.inventory.reserve({ positionId: 'SIDEBAR_1', advertiserId: acc.id, campaignId: id, startDate: '2026-12-01', endDate: '2026-12-31', status: 'held' });
    h.transitionCampaign(ctx, { campaignId: id, to: 'reserved', reservationIds: [rs.id] });
    const late = h.setCampaignPositions(ctx, { campaignId: id, positionIds: ['TOP'] });
    expect([late.status, code(late)]).toEqual([409, 'BAD_STATE']);
  });
  it('recusas: vazio e desconhecida => 400; não configurada => 422; campanha inexistente => 404; sem sessão => 401', () => {
    const { ctx, state, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER'] }));
    expect(h.setCampaignPositions(ctx, { campaignId: id, positionIds: [] }).status).toBe(400);
    expect(h.setCampaignPositions(ctx, { campaignId: id, positionIds: ['NOPE'] }).status).toBe(400);
    expect(code(h.setCampaignPositions(ctx, { campaignId: id, positionIds: ['AGENDA'] }))).toBe('POSITION_NOT_CONFIGURED');
    expect(h.setCampaignPositions(ctx, { campaignId: 'nope', positionIds: ['FOOTER'] }).status).toBe(404);
    expect(h.setCampaignPositions(makeCtx(state, { now: NOW }), { campaignId: id, positionIds: ['FOOTER'] }).status).toBe(401);
    expect(state.campaigns.get(id).positionIds).toEqual(['FOOTER']);
  });
  it('rota na tabela: POST, só Studio', () => {
    expect(h.ROUTES.find((r) => r.path === '/api/commercial/studio/campaigns/positions')).toMatchObject({ method: 'POST', auth: 'studio' });
  });
});

describe('snapshot e relatório com várias posições', () => {
  it('ida e volta por JSON preserva positionIds; snapshot antigo (só positionId) vira positionIds', () => {
    const a = new CampaignBook();
    const c = a.create({ name: 'M', accountId: 'a', formatId: 'f', positionIds: ['FOOTER', 'TOP'], startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    const b = new CampaignBook(); b.load(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.get(c.id)).toMatchObject({ positionIds: ['FOOTER', 'TOP'], positionId: 'FOOTER' });

    const old = JSON.parse(JSON.stringify(a.snapshot())) as { campaigns: Record<string, unknown>[] };
    for (const x of old.campaigns) delete x.positionIds; // snapshot do formato anterior
    old.campaigns[0]!.positionId = 'SIDEBAR_3';
    const d = new CampaignBook(); d.load(old as never);
    expect(d.get(c.id)).toMatchObject({ positionIds: ['SIDEBAR_3'], positionId: 'SIDEBAR_3' });
    delete old.campaigns[0]!.positionId; old.campaigns[0]!.positionId = null;
    const e = new CampaignBook(); e.load(old as never);
    expect(e.get(c.id)).toMatchObject({ positionIds: [], positionId: null });
  });
  it('carga normaliza duplicatas e mantém positionId = primeira posição', () => {
    const a = new CampaignBook();
    a.create({ name: 'M', accountId: 'a', formatId: 'f', positionIds: ['FOOTER'], startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as { campaigns: { positionIds: string[]; positionId: string | null }[] };
    snap.campaigns[0]!.positionIds = ['TOP', 'TOP', 'FOOTER']; snap.campaigns[0]!.positionId = 'FOOTER';
    const b = new CampaignBook(); b.load(snap as never);
    expect(b.list()[0]).toMatchObject({ positionIds: ['TOP', 'FOOTER'], positionId: 'TOP' });
  });
  it('o relatório lista TODAS as posições da campanha, mesmo sem reserva nem criativo', () => {
    const cb = new CampaignBook();
    const c = cb.create({ name: 'M', accountId: 'a', formatId: 'banners--banner-rodape', positionIds: ['SIDEBAR_2', 'FOOTER'], startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    const r = buildCampaignReport({ campaign: c, advertiserName: 'A', creatives: [], reservations: [], delivery: [], audit: new DeliveryAudit(), now: NOW });
    expect(r.positions.map((p) => p.positionId)).toEqual(['FOOTER', 'SIDEBAR_2']);
  });
  it('detalhe da campanha traz positions (todas) e position (a primeira, compatibilidade)', () => {
    const { ctx, mk } = setup();
    const id = idOf(mk({ positionIds: ['FOOTER', 'SIDEBAR_1'] }));
    const d = h.getCampaignDetail(ctx, { campaignId: id }).body as { position: { id: string }; positions: { id: string }[] };
    expect(d.position.id).toBe('FOOTER'); expect(d.positions.map((p) => p.id)).toEqual(['FOOTER', 'SIDEBAR_1']);
  });
});
