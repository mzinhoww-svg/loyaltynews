import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Crm, InventoryBook, CampaignBook, AdServer, MetricStore, generateMediaKit } from './index';

// Fluxo comercial ponta a ponta (domínio, sem UI/infra): lead -> CRM -> proposta -> reserva -> campanha -> entrega -> relatório -> mídia kit.
test('e2e: do lead do mídia kit à entrega, sem audiência fictícia', () => {
  const now = '2026-11-22T12:00:00-03:00';
  const crm = new Crm(); const inv = new InventoryBook(); const cb = new CampaignBook(); const ads = new AdServer(); const metrics = new MetricStore();

  const lead = crm.captureLead({ name: 'Ana', company: 'Acme', email: 'ana@acme.com', formatIds: ['banners--banner-topo'] }, now);
  assert.equal(inv.list().length, 0, 'lead não cria reserva');
  const { account, opportunity } = crm.convertLead(lead.id, now);
  crm.moveStage(opportunity.id, 'qualificado', now); crm.moveStage(opportunity.id, 'proposta', now, { amountBRL: 9000 }); crm.moveStage(opportunity.id, 'ganho', now);

  const camp = cb.create({ name: 'Acme topo', accountId: account.id, opportunityId: opportunity.id, formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28' }, now);
  const res = inv.reserve({ positionId: 'TOP', advertiserId: account.id, campaignId: camp.id, startDate: camp.startDate, endDate: camp.endDate, status: 'confirmed' });
  cb.transition(camp.id, 'reserved', now, { reservationIds: [res.id] }); cb.transition(camp.id, 'approved', now);
  cb.transition(camp.id, 'active', now, { hasApprovedCreative: true });

  ads.addCreative({ id: 'cr1', campaignId: camp.id, positionId: 'TOP', weight: 1, startDate: camp.startDate, endDate: camp.endDate, approved: true, campaignActive: true });
  const s = ads.serve({ positionId: 'TOP', today: '2026-12-02', pageViewId: 'pv1' });
  ads.recordVisible(s.impressionId!); ads.recordClick(s.impressionId!);
  const rep = ads.campaignDelivery(camp.id);
  assert.deepEqual([rep.served, rep.visible, rep.clicks], [1, 1, 1]);

  const kit = generateMediaKit({ store: metrics, now });
  assert.ok(kit.blocks.audiencia.metrics.every((m) => m.record.value === null), 'entrega de anúncio não vira audiência do portal');
  assert.equal(crm.pipeline().find((p) => p.stage === 'ganho')!.amountKnownBRL, 9000);
});
