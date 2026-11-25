import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CATALOG, buildCatalog, getFormat, priceLabel, PACKAGES,
  InventoryBook, InventoryError, POSITIONS, theoreticalGrossCapacity,
  AdServer, CampaignBook, CampaignError, Crm, CrmError,
  MetricStore, displayMetric, unavailable, generateMediaKit, renderMediaKitHtml,
  evaluateActivation, confirmedCoverage, type Reservation, type ActivationEvidence,
} from './index';

import { realContent } from './real-creative.mock';

const NOW = '2026-11-22T12:00:00-03:00';

// ---------- catálogo ----------
test('catálogo tem 47 formatos únicos em 9 famílias, com 8 pacotes fora da contagem', () => {
  assert.equal(CATALOG.length, 47);
  assert.equal(new Set(CATALOG.map((f) => f.id)).size, 47);
  assert.equal(new Set(CATALOG.map((f) => f.section)).size, 9);
  assert.equal(PACKAGES.length, 8);
});
test('preços de referência batem com o Blueprint', () => {
  assert.equal(getFormat('banners--banner-topo')!.fromBRL, 3000);
  assert.equal(priceLabel(getFormat('banners--banner-topo')!), 'R$ 3.000/mês');
  assert.equal(priceLabel(getFormat('banners--takeover-do-portal')!), 'R$ 5.000/dia');
  assert.equal(priceLabel(getFormat('eventos--cota-master')!), 'a partir de R$ 30.000');
  assert.match(priceLabel(getFormat('impulsionamento--linkedin')!), /verba \+ 20%/);
  assert.equal(getFormat('conteudo-patrocinado--materia-publicitaria')!.fromBRL, 3500);
});
test('nenhum formato nasce disponivel sem capacidade declarada; só a liberação explícita do proprietário promove (inclusive indisponível, com ressalva)', () => {
  assert.equal(CATALOG.filter((f) => f.status === 'disponivel').length, 0);
  assert.ok(CATALOG.every((f) => f.statusReason.length > 0));
  assert.equal(buildCatalog().filter((f) => f.status === 'disponivel').length, 0);
  const c = buildCatalog({ 'banners--banner-topo': true, 'the-loyal--banner-meio': true });
  assert.equal(getFormat('banners--banner-topo', c)!.status, 'disponivel');
  assert.equal(getFormat('the-loyal--banner-meio', c)!.status, 'disponivel');
  assert.match(getFormat('the-loyal--banner-meio', c)!.statusReason, /Ressalva/);
  assert.equal(getFormat('the-loyal--banner-meio')!.status, 'indisponivel'); // o catálogo base não mudou
  assert.equal(CATALOG.find((f) => f.id === 'banners--banner-topo')!.status, 'sob_consulta');
});

// ---------- inventário ----------
test('TOP aceita 4 cotas e recusa a quinta; mínimo de 90 dias', () => {
  const b = new InventoryBook();
  assert.throws(() => b.reserve({ positionId: 'TOP', advertiserId: 'a', startDate: '2026-12-01', endDate: '2026-12-31' }), (e: InventoryError) => e.code === 'MIN_CONTRACT');
  for (let i = 1; i <= 4; i++) b.reserve({ positionId: 'TOP', advertiserId: `a${i}`, startDate: '2026-12-01', endDate: '2027-02-28' });
  assert.equal(b.availability('TOP', '2026-12-01', '2027-02-28').free, 0);
  assert.throws(() => b.reserve({ positionId: 'TOP', advertiserId: 'a5', startDate: '2026-12-15', endDate: '2027-03-15' }), (e: InventoryError) => e.code === 'NO_SLOT');
  // depois de terminar, volta a ter vaga
  assert.equal(b.availability('TOP', '2027-03-01', '2027-03-31').free, 4);
});
test('cancelar libera cota; sidebar tem 10 por posição, independentes', () => {
  const b = new InventoryBook();
  const rs = Array.from({ length: 10 }, (_, i) => b.reserve({ positionId: 'SIDEBAR_1', advertiserId: `s${i}`, startDate: '2026-12-01', endDate: '2026-12-30' }));
  assert.throws(() => b.reserve({ positionId: 'SIDEBAR_1', advertiserId: 'x', startDate: '2026-12-01', endDate: '2026-12-30' }));
  assert.equal(b.availability('SIDEBAR_2', '2026-12-01', '2026-12-30').free, 10);
  b.cancel(rs[0]!.id);
  assert.equal(b.availability('SIDEBAR_1', '2026-12-01', '2026-12-30').free, 1);
});
test('posições parametrizáveis sem configuração não são reserváveis (e disponibilidade é null, não zero)', () => {
  const b = new InventoryBook();
  assert.throws(() => b.reserve({ positionId: 'AGENDA', advertiserId: 'a', startDate: '2026-12-01', endDate: '2026-12-30' }), (e: InventoryError) => e.code === 'POSITION_NOT_CONFIGURED');
  const av = b.availability('AGENDA', '2026-12-01', '2026-12-30');
  assert.equal(av.free, null); assert.equal(av.configured, false);
  assert.throws(() => b.position('NOPE'), (e: InventoryError) => e.code === 'POSITION_UNKNOWN');
  assert.throws(() => b.availability('TOP', '2026-12-31', '2026-12-01'), (e: InventoryError) => e.code === 'INVALID_PERIOD');
});
test('takeover bloqueia reserva concorrente e exige acordo das campanhas existentes', () => {
  const b = new InventoryBook();
  b.reserve({ positionId: 'FOOTER', advertiserId: 'a', campaignId: 'cmp-9', startDate: '2026-12-01', endDate: '2026-12-31' });
  assert.throws(() => b.reserveTakeover({ date: '2026-12-10', advertiserId: 'big' }), (e: InventoryError) => e.code === 'TAKEOVER_CONFLICT');
  b.reserveTakeover({ date: '2026-12-10', advertiserId: 'big', agreedCampaignIds: ['cmp-9'] });
  assert.throws(() => b.reserveTakeover({ date: '2026-12-10', advertiserId: 'other' }), (e: InventoryError) => e.code === 'TAKEOVER_BLOCK');
  assert.throws(() => b.reserve({ positionId: 'SIDEBAR_3', advertiserId: 'c', startDate: '2026-12-05', endDate: '2027-01-04' }), (e: InventoryError) => e.code === 'TAKEOVER_BLOCK');
  assert.equal(b.availability('SIDEBAR_3', '2026-12-05', '2027-01-04').blockedByTakeover, true);
});
test('capacidade teórica = R$72.000/mês a 100% e é rotulada como cenário, não previsão', () => {
  const c = theoreticalGrossCapacity();
  assert.equal(c.grossBRLMonth, 72000);
  assert.equal(theoreticalGrossCapacity(undefined, 0.25).grossBRLMonth, 18000);
  assert.match(c.label, /não é previsão/);
  assert.equal(POSITIONS.length, 9);
});

// ---------- rotação ----------
function server(n: number) {
  const s = new AdServer();
  for (let i = 1; i <= n; i++) s.addCreative({ id: `c${i}`, campaignId: `k${i}`, positionId: 'TOP', weight: 1, startDate: '2026-12-01', endDate: '2026-12-31', approved: true, campaignActive: true, ...realContent() });
  return s;
}
test('rotação com 4 anunciantes iguais dá 25% cada e conta impressões', () => {
  const s = server(4);
  for (let i = 0; i < 400; i++) s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: `pv${i}` });
  for (let i = 1; i <= 4; i++) assert.equal(s.delivery(`c${i}`).served, 100);
});
test('pesos diferentes seguem a proporção', () => {
  const s = new AdServer();
  s.addCreative({ id: 'a', campaignId: 'k1', positionId: 'TOP', weight: 3, startDate: '2026-12-01', endDate: '2026-12-31', approved: true, campaignActive: true, ...realContent() });
  s.addCreative({ id: 'b', campaignId: 'k2', positionId: 'TOP', weight: 1, startDate: '2026-12-01', endDate: '2026-12-31', approved: true, campaignActive: true, ...realContent() });
  for (let i = 0; i < 400; i++) s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: `pv${i}` });
  assert.equal(s.delivery('a').served, 300); assert.equal(s.delivery('b').served, 100);
});
test('auto-refresh na mesma visualização não infla impressões', () => {
  const s = server(2);
  const first = s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'pvX' });
  for (let i = 0; i < 5; i++) { const r = s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'pvX' }); assert.equal(r.counted, false); assert.equal(r.creativeId, first.creativeId); }
  const d = s.delivery(first.creativeId!);
  assert.equal(d.served, 1); assert.equal(d.refreshSuppressed, 5);
});
test('bots e tráfego interno não contam; visível e clique valem uma vez por impressão', () => {
  const s = server(1);
  assert.equal(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'b', isBot: true }).counted, false);
  assert.equal(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'i', isInternal: true }).counted, false);
  const r = s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'real' });
  assert.equal(s.recordVisible(r.impressionId!), true); assert.equal(s.recordVisible(r.impressionId!), false);
  assert.equal(s.recordClick(r.impressionId!), true); assert.equal(s.recordClick(r.impressionId!), false);
  assert.equal(s.recordClick('imp-inexistente'), false);
  const d = s.delivery('c1');
  assert.deepEqual([d.served, d.visible, d.clicks, d.ignoredBotOrInternal, d.ctr], [1, 1, 1, 2, 1]);
});
test('sem criativo elegível usa house ad; CTR é null sem entrega (nunca 0% falso)', () => {
  const s = server(1);
  assert.equal(s.serve({ positionId: 'TOP', today: '2027-01-15', pageViewId: 'p' }).kind, 'house');
  assert.equal(s.serve({ positionId: 'FOOTER', today: '2026-12-05', pageViewId: 'p2' }).kind, 'house');
  assert.equal(s.delivery('c1').ctr, null);
  s.setCreative('c1', { approved: false });
  assert.equal(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'p3' }).kind, 'house');
  assert.throws(() => s.addCreative({ id: 'z', campaignId: 'k', positionId: 'TOP', weight: 0, startDate: '', endDate: '', approved: true, campaignActive: true }));
});
test('relatório por campanha soma criativos da campanha', () => {
  const s = server(2);
  for (let i = 0; i < 4; i++) s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: `p${i}` });
  assert.equal(s.campaignDelivery('k1').served, 2);
});

// ---------- campanhas ----------
const R = (over: Partial<Reservation> = {}): Reservation => ({ id: 'res-1', positionId: 'TOP', advertiserId: 'a', campaignId: 'cmp-1', startDate: '2026-12-01', endDate: '2027-02-28', status: 'confirmed', ...over });
const EV = (over: Partial<ActivationEvidence> = {}): ActivationEvidence => ({ saleEnabled: true, formatStatus: 'disponivel', reservations: [R()], approvedCreativeCount: 1, creativePositions: ['TOP'], ...over });
/** Campanha cmp-1 em 'approved', pronta para tentar ativar. */
function approvedCampaign() {
  const cb = new CampaignBook();
  const c = cb.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' }, NOW);
  cb.transition(c.id, 'reserved', NOW, { reservations: [R()] });
  cb.transition(c.id, 'approved', NOW);
  return { cb, c };
}
const refuses = (cb: CampaignBook, id: string, ev: ActivationEvidence | undefined, code: string) => {
  const before = cb.get(id).status;
  assert.throws(() => cb.transition(id, 'active', NOW, { activation: ev }), (e: CampaignError) => e.code === code, 'esperava ' + code);
  assert.equal(cb.get(id).status, before, 'estado não pode mudar após recusa');
};

test('campanha: fluxo válido draft→reserved→approved→active→paused→active→completed e transições inválidas', () => {
  const cb = new CampaignBook();
  const c = cb.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' }, NOW);
  assert.throws(() => cb.transition(c.id, 'active', NOW), (e: CampaignError) => e.code === 'BAD_TRANSITION');
  assert.throws(() => cb.transition(c.id, 'reserved', NOW), (e: CampaignError) => e.code === 'NO_RESERVATION');
  cb.transition(c.id, 'reserved', NOW, { reservations: [R()] });
  cb.transition(c.id, 'approved', NOW);
  cb.transition(c.id, 'active', NOW, { activation: EV() });
  cb.transition(c.id, 'paused', NOW); cb.transition(c.id, 'active', NOW, { activation: EV() });
  cb.transition(c.id, 'completed', NOW);
  assert.throws(() => cb.transition(c.id, 'active', NOW, { activation: EV() }), (e: CampaignError) => e.code === 'BAD_TRANSITION');
  assert.equal(c.history.length, 7);
  assert.throws(() => cb.get('nope'), (e: CampaignError) => e.code === 'NOT_FOUND');
});
test('ativação: sem evidência é recusada; cada condição faltando recusa com o código próprio', () => {
  const { cb, c } = approvedCampaign();
  refuses(cb, c.id, undefined, 'SALE_NOT_ENABLED');
  refuses(cb, c.id, EV({ saleEnabled: false }), 'SALE_NOT_ENABLED');                                   // flag desligada
  refuses(cb, c.id, EV({ formatStatus: 'sob_consulta' }), 'FORMAT_NOT_AVAILABLE');                      // formato sob consulta
  refuses(cb, c.id, EV({ formatStatus: 'indisponivel' }), 'FORMAT_NOT_AVAILABLE');                      // formato indisponível
  refuses(cb, c.id, EV({ approvedCreativeCount: 0 }), 'NO_APPROVED_CREATIVE');                          // sem criativo aprovado
  refuses(cb, c.id, EV({ reservations: [] }), 'NO_CONFIRMED_RESERVATION');                              // sem reserva
  refuses(cb, c.id, EV({ reservations: [R({ status: 'held' })] }), 'NO_CONFIRMED_RESERVATION');         // só pré-reserva
  refuses(cb, c.id, EV({ reservations: [R({ status: 'cancelled' })] }), 'NO_CONFIRMED_RESERVATION');    // cancelada
  refuses(cb, c.id, EV({ reservations: [R({ campaignId: 'cmp-9' })] }), 'NO_CONFIRMED_RESERVATION');    // de outra campanha
  refuses(cb, c.id, EV({ reservations: [R({ campaignId: null })] }), 'NO_CONFIRMED_RESERVATION');       // sem vínculo
  refuses(cb, c.id, EV({ reservations: [R({ positionId: 'FOOTER' })] }), 'NO_CONFIRMED_RESERVATION');   // outra posição
  assert.equal(cb.get(c.id).history.length, 3); // nenhuma recusa gravou histórico
});
test('ativação: reserva confirmada precisa cobrir o período inteiro (início, meio e fim)', () => {
  const { cb, c } = approvedCampaign();
  refuses(cb, c.id, EV({ reservations: [R({ startDate: '2026-12-02' })] }), 'NO_CONFIRMED_RESERVATION');   // começa tarde
  refuses(cb, c.id, EV({ reservations: [R({ endDate: '2027-02-27' })] }), 'NO_CONFIRMED_RESERVATION');     // termina cedo
  refuses(cb, c.id, EV({ reservations: [R({ id: 'a', endDate: '2026-12-31' }), R({ id: 'b', startDate: '2027-01-02' })] }), 'NO_CONFIRMED_RESERVATION'); // buraco em 01/01
  assert.equal(confirmedCoverage(c, [R({ id: 'a', endDate: '2026-12-31' }), R({ id: 'b', startDate: '2027-01-01' })], 'TOP'), true);  // adjacentes cobrem
  assert.equal(confirmedCoverage(c, [R({ id: 'a', endDate: '2027-01-15' }), R({ id: 'b', startDate: '2027-01-10' })], 'TOP'), true);  // sobrepostas cobrem
  cb.transition(c.id, 'active', NOW, { activation: EV({ reservations: [R({ id: 'a', endDate: '2026-12-31' }), R({ id: 'b', startDate: '2027-01-01' })] }) });
  assert.equal(cb.get(c.id).status, 'active');
});
test('ativação: mensagem lista todas as condições que faltam; retomar de pausada reconfere tudo', () => {
  const { cb, c } = approvedCampaign();
  try {
    cb.transition(c.id, 'active', NOW, { activation: EV({ saleEnabled: false, formatStatus: 'sob_consulta', reservations: [], approvedCreativeCount: 0 }) });
    assert.fail('deveria recusar');
  } catch (e) {
    const m = (e as CampaignError).message;
    for (const k of ['adServerVendas', 'sob_consulta', 'reserva confirmada', 'criativo aprovado']) assert.ok(m.includes(k), k);
  }
  cb.transition(c.id, 'active', NOW, { activation: EV() });
  cb.transition(c.id, 'paused', NOW);
  refuses(cb, c.id, EV({ saleEnabled: false }), 'SALE_NOT_ENABLED'); // flag desligada enquanto pausada: não retoma
  refuses(cb, c.id, EV({ reservations: [R({ status: 'cancelled' })] }), 'NO_CONFIRMED_RESERVATION');
  assert.equal(evaluateActivation(cb.get(c.id), EV()).length, 0);
});
test('reservar campanha: só aceita reservas não canceladas, desta campanha e desta posição', () => {
  const mk = () => { const cb = new CampaignBook(); return { cb, c: cb.create({ name: 'X', accountId: 'a', formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' }, NOW) }; };
  for (const bad of [R({ status: 'cancelled' }), R({ campaignId: 'cmp-9' }), R({ campaignId: null }), R({ positionId: 'FOOTER' })]) {
    const { cb, c } = mk();
    assert.throws(() => cb.transition(c.id, 'reserved', NOW, { reservations: [bad] }), (e: CampaignError) => e.code === 'INVALID_RESERVATION');
    assert.equal(c.status, 'draft'); assert.deepEqual(c.reservationIds, []);
  }
  const { cb, c } = mk();
  cb.transition(c.id, 'reserved', NOW, { reservations: [R({ status: 'held' })] }); // pré-reserva basta para 'reserved'
  assert.deepEqual(c.reservationIds, ['res-1']);
});

// ---------- CRM ----------
test('lead válido não cria reserva; lead inválido é recusado; opt-in nunca vem marcado', () => {
  const crm = new Crm();
  assert.throws(() => crm.captureLead({ name: 'A', company: 'B', email: 'x' }, NOW), (e: CrmError) => e.code === 'INVALID_LEAD');
  assert.throws(() => crm.captureLead({ name: '', company: 'B', email: 'a@b.com' }, NOW));
  const l = crm.captureLead({ name: 'Ana', company: 'Acme', email: 'ANA@Acme.com', formatIds: ['banners--banner-topo'] }, NOW);
  assert.equal(l.email, 'ana@acme.com'); assert.equal(l.newsletterOptIn, false); assert.equal(l.status, 'novo');
});
test('converter lead cria conta (reaproveita por empresa) e oportunidade; funil e motivo de perda', () => {
  const crm = new Crm();
  const l1 = crm.captureLead({ name: 'Ana', company: 'Acme', email: 'a@acme.com' }, NOW);
  const l2 = crm.captureLead({ name: 'Bia', company: 'ACME', email: 'b@acme.com' }, NOW);
  const r1 = crm.convertLead(l1.id, NOW); const r2 = crm.convertLead(l2.id, NOW);
  assert.equal(r1.account.id, r2.account.id); assert.equal(crm.accounts.size, 1);
  const o = r1.opportunity;
  assert.throws(() => crm.moveStage(o.id, 'ganho', NOW), (e: CrmError) => e.code === 'BAD_STAGE');
  crm.moveStage(o.id, 'qualificado', NOW); crm.moveStage(o.id, 'proposta', NOW, { amountBRL: 9000, nextAction: 'enviar PDF' });
  crm.moveStage(o.id, 'negociacao', NOW); crm.moveStage(o.id, 'proposta', NOW);
  assert.equal(o.proposalVersions, 2);
  assert.throws(() => crm.moveStage(r2.opportunity.id, 'perdido', NOW), (e: CrmError) => e.code === 'LOST_REASON_REQUIRED');
  crm.moveStage(r2.opportunity.id, 'perdido', NOW, { lostReason: 'sem verba' });
  const p = crm.pipeline();
  assert.equal(p.find((x) => x.stage === 'proposta')!.amountKnownBRL, 9000);
  assert.equal(p.find((x) => x.stage === 'perdido')!.withoutAmount, 1);
  assert.equal(crm.leads.get(l1.id)!.status, 'convertido');
});

// ---------- métricas e mídia kit ----------
test('métrica exige origem, período e horário; sem coleta é "— / não disponível"', () => {
  const st = new MetricStore();
  assert.equal(displayMetric(st.get({ source: 'ga4_report', metric: 'sessions_30d' }, NOW)), '— / não disponível');
  assert.throws(() => st.ingest({ source: '', metric: 'm', value: 1, period_start: NOW, period_end: NOW, fetched_at: NOW }));
  assert.throws(() => st.ingest({ source: 's', metric: 'm', value: 1, period_start: 'xx', period_end: NOW, fetched_at: NOW }));
  assert.throws(() => st.ingest({ source: 's', metric: 'm', value: NaN, period_start: NOW, period_end: NOW, fetched_at: NOW }));
  assert.equal(unavailable({ source: 's', metric: 'm' }).value, null);
});
test('métrica envelhece (stale) e falha de coleta preserva última coleta válida marcada como desatualizada', () => {
  const st = new MetricStore();
  st.ingest({ source: 'ga4_realtime', metric: 'active_users_30min', value: 12, period_start: '2026-11-22T11:30:00-03:00', period_end: '2026-11-22T12:00:00-03:00', fetched_at: NOW });
  const k = { source: 'ga4_realtime', metric: 'active_users_30min' };
  assert.equal(st.get(k, '2026-11-22T12:05:00-03:00', 'realtime').status, 'available');
  assert.equal(st.get(k, '2026-11-22T12:30:00-03:00', 'realtime').status, 'stale');
  assert.equal(displayMetric(st.get(k, '2026-11-22T12:30:00-03:00', 'realtime')), '12 (desatualizado)');
  assert.equal(st.markFailure(k).status, 'stale');
  assert.equal(st.markFailure({ source: 'x', metric: 'y' }).status, 'unavailable');
});
test('mídia kit sem analytics: estado vazio honesto, nenhum número de audiência, 8 blocos, 47 formatos', () => {
  const kit = generateMediaKit({ store: new MetricStore(), now: NOW });
  assert.equal(Object.keys(kit.blocks).length, 8);
  assert.equal(kit.blocks.catalogo.total, 47);
  assert.ok(kit.blocks.audiencia.emptyState);
  assert.ok(kit.blocks.audiencia.metrics.every((m) => m.display === '— / não disponível' && m.record.value === null));
  assert.ok(kit.blocks.cobertura.emptyState);
  assert.equal(kit.blocks.decisores.available, false);
  assert.equal(kit.blocks.catalogo.byStatus.disponivel, 0);
  const html = renderMediaKitHtml(kit);
  assert.match(html, /não disponível/); assert.doesNotMatch(html, /<script/i); assert.equal((html.match(/data-status=/g) ?? []).length, 47);
});
test('mídia kit com coleta real mostra valor com origem, período e horário', () => {
  const st = new MetricStore();
  st.ingest({ source: 'ga4_report', metric: 'sessions_30d', value: 1234, period_start: '2026-10-23T00:00:00-03:00', period_end: '2026-11-21T23:59:59-03:00', fetched_at: NOW });
  const kit = generateMediaKit({ store: st, now: NOW });
  const m = kit.blocks.audiencia.metrics.find((x) => x.record.metric === 'sessions_30d')!;
  assert.equal(m.record.status, 'available'); assert.match(m.display, /1\.234/);
  const html = renderMediaKitHtml(kit);
  assert.match(html, /origem ga4_report; período 2026-10-23.*coletado em 2026-11-22T12:00:00-03:00/);
  assert.ok(kit.blocks.audiencia.metrics.filter((x) => x.record.metric !== 'sessions_30d').every((x) => x.record.status === 'unavailable'));
});
test('HTML escapa conteúdo', () => {
  const st = new MetricStore();
  const kit = generateMediaKit({ store: st, now: NOW });
  kit.blocks.tese.text = '<img src=x onerror=1>';
  assert.doesNotMatch(renderMediaKitHtml(kit), /<img/);
});
