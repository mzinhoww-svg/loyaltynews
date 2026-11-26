import { describe, expect, it } from 'vitest';
import { realContent } from './real-creative.mock';
import { createCommercialState, makeCtx } from './state';
import {
  campaignDetail, formatCatalogView, inventoryCalendar, inventoryOverview, leadInbox, mediaKitPage, opportunityBoard, studioDashboard,
} from './queries';

const NOW = '2026-11-22T12:00:00-03:00';
const mk = (flags = {}) => { const s = createCommercialState(); return { s, c: makeCtx(s, { now: NOW, today: '2026-12-05', flags }) }; };

describe('consultas do mídia kit (Portal)', () => {
  it('sem dados: capacidades desligadas, nenhum número de audiência, 47 formatos', () => {
    const { c } = mk();
    const p = mediaKitPage(c);
    expect(p.capabilities).toEqual({ adServerVendas: false, instagram: false, theLoyal: false, retargeting: false });
    expect(p.blocks.catalogo.total).toBe(47);
    expect(p.blocks.audiencia.emptyState).toBeTruthy();
    expect(p.blocks.audiencia.metrics.every((m) => m.display === '— / não disponível')).toBe(true);
  });
  it('flags ligadas refletem em capabilities', () => {
    expect(mediaKitPage(mk({ adServerVendas: true, theLoyal: true }).c).capabilities).toMatchObject({ adServerVendas: true, theLoyal: true, instagram: false });
  });
  it('catálogo: filtros por seção e estado, seções distintas', () => {
    const { c } = mk();
    expect(formatCatalogView(c).sections).toHaveLength(9);
    expect(formatCatalogView(c, { section: 'Eventos' }).total).toBe(7);
    expect(formatCatalogView(c, { status: 'disponivel' }).total).toBe(0);
    expect(formatCatalogView(c, { section: 'Banners' }).formats[0]).toMatchObject({ name: 'Banner topo', price: 'R$ 1.200/mês', priceBRL: 1200, status: 'sob_consulta' });
  });
});

describe('consultas do Studio comercial', () => {
  it('inventário: ocupação null (não 0%) em posição não configurada; calendário por dia', () => {
    const { s, c } = mk();
    s.inventory.reserve({ positionId: 'TOP', advertiserId: 'a', startDate: '2026-12-01', endDate: '2027-02-28' });
    s.inventory.reserve({ positionId: 'TOP', advertiserId: 'b', startDate: '2026-12-10', endDate: '2027-03-09' });
    const ov = inventoryOverview(c, '2026-12-01', '2026-12-31');
    expect(ov.find((p) => p.positionId === 'TOP')).toMatchObject({ peakUsed: 2, free: 2, occupancy: 0.5, configured: true });
    expect(ov.find((p) => p.positionId === 'AGENDA')).toMatchObject({ occupancy: null, free: null, configured: false });
    const cal = inventoryCalendar(c, 'TOP', '2026-12-08', '2026-12-11');
    expect(cal.days.map((d) => d.used)).toEqual([1, 1, 2, 2]);
    expect(() => inventoryCalendar(c, 'TOP', '2026-01-01', '2027-12-31')).toThrow();
  });
  it('CRM: quadro por estágio com conta e atraso de próxima ação; caixa de leads ordenada, filtro por status', () => {
    const { s, c } = mk();
    s.crm.captureLead({ name: 'A', company: 'Acme', email: 'a@acme.com' }, '2026-11-20T10:00:00-03:00');
    const l2 = s.crm.captureLead({ name: 'B', company: 'Beta', email: 'b@beta.com' }, '2026-11-21T10:00:00-03:00');
    expect(leadInbox(c).map((l) => l.name)).toEqual(['B', 'A']);
    const { opportunity } = s.crm.convertLead(l2.id, NOW);
    s.crm.moveStage(opportunity.id, 'qualificado', NOW, { nextAction: 'ligar', nextActionDue: '2026-12-01' });
    expect(leadInbox(c, { status: 'convertido' })).toHaveLength(1);
    const board = opportunityBoard(c);
    expect(board.map((b) => b.stage)).toEqual(['novo', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido']);
    expect(board.find((b) => b.stage === 'qualificado')!.items[0]).toMatchObject({ accountName: 'Beta', overdue: true, amountBRL: null });
  });
  it('detalhe de campanha: relatório sem analytics traz utmVisits null e visibleRate null sem entrega', () => {
    const { s, c } = mk();
    const camp = s.campaigns.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2026-12-31' }, NOW);
    const d = campaignDetail(c, camp.id);
    expect(d.report).toMatchObject({ served: 0, ctr: null, visibleRate: null, utmVisits: null, daysTotal: 31 });
    expect(d.format?.name).toBe('Banner topo');
    expect(() => campaignDetail(c, 'nope')).toThrow();
  });
  it('painel: contagens reais, alertas de campanha ativa sem criativo aprovado e de posições não configuradas, métricas vazias', () => {
    const { s, c } = mk({ adServerVendas: true });
    const camp = s.campaigns.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2026-12-31' }, NOW);
    const res = s.inventory.reserve({ positionId: 'FOOTER', advertiserId: 'acc-1', campaignId: camp.id, startDate: '2026-12-01', endDate: '2026-12-31', status: 'confirmed' });
    s.campaigns.transition(camp.id, 'reserved', NOW, { reservations: [res] }); s.campaigns.transition(camp.id, 'approved', NOW);
    s.ads.addCreative({ id: 'cr1', campaignId: camp.id, positionId: 'FOOTER', weight: 1, startDate: '2026-12-01', endDate: '2026-12-31', approved: true, campaignActive: true, ...realContent('FOOTER') });
    s.campaigns.transition(camp.id, 'active', NOW, { activation: { saleEnabled: true, formatStatus: 'disponivel', reservations: [res], approvedCreativeCount: 1, creativePositions: ['FOOTER'] } });
    s.ads.setCreative('cr1', { approved: false }); // criativo desaprovado depois da ativação => alerta
    const d = studioDashboard(c, '2026-12-01', '2026-12-31');
    expect(d.formatsByStatus.disponivel + d.formatsByStatus.sob_consulta + d.formatsByStatus.indisponivel).toBe(47);
    expect(d.campaignsByStatus.active).toBe(1);
    expect(d.attention.some((a) => a.kind === 'campanha_sem_criativo_aprovado' && a.ref === camp.id)).toBe(true);
    expect(d.attention.filter((a) => a.kind === 'posicao_nao_configurada')).toHaveLength(4);
    expect(d.metricsEmpty).toBe(true);
    expect(d.sellingEnabled).toBe(true);
    expect(d.leads).toEqual({ novos: 0, total: 0 });
  });
});
