// DP-43: aprovar cada imagem (criativo) e cada campanha é só do proprietário (papel admin). O comercial prepara e envia; não aprova.
import { describe, expect, it } from 'vitest';
import { buildCatalog, createCommercialState, makeCtx, type Actor } from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-12-05T12:00:00-03:00';
const comercial: Actor = { id: 'ana', canManageCommercial: true };
const comercialExplicito: Actor = { id: 'ana', canManageCommercial: true, canApprove: false };
const proprietario: Actor = { id: 'dono', canManageCommercial: true, canApprove: true };
const semModulo: Actor = { id: 'x', canManageCommercial: false, canApprove: true }; // aprovar não substitui o acesso ao módulo

function setup() {
  const state = { ...createCommercialState(), catalog: buildCatalog({ 'banners--banner-rodape': true }) };
  const as = (actor?: Actor) => makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true }, actor });
  const acc = state.crm.createAccount('Acme Fidelidade', NOW);
  const camp = state.campaigns.create({ name: 'Rodapé', accountId: acc.id, formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
  const res = state.inventory.reserve({ positionId: 'FOOTER', advertiserId: acc.id, campaignId: camp.id, startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' });
  const cid = (h.addCreative(as(comercial), { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER') }).body as { id: string }).id;
  return { state, as, camp, res, cid };
}
const approved = (s: ReturnType<typeof setup>) => s.state.ads.listCreatives().find((c) => c.id === s.cid)!.approved;
const status = (s: ReturnType<typeof setup>) => s.state.campaigns.get(s.camp.id).status;
const code = (r: { body: unknown }) => (r.body as { error?: { code?: string } }).error?.code;

describe('aprovar imagem (criativo)', () => {
  it('o comercial NÃO aprova: 403 APPROVAL_FORBIDDEN e o criativo continua sem aprovação', () => {
    const s = setup();
    for (const actor of [comercial, comercialExplicito]) {
      const r = h.approveCreative(s.as(actor), { creativeId: s.cid });
      expect([r.status, code(r)]).toEqual([403, 'APPROVAL_FORBIDDEN']);
      expect(JSON.stringify(r.body)).toContain('DP-43');
    }
    expect(approved(s)).toBe(false);
  });
  it('o proprietário aprova', () => {
    const s = setup();
    expect(h.approveCreative(s.as(proprietario), { creativeId: s.cid })).toMatchObject({ status: 200, body: { id: s.cid, approved: true } });
    expect(approved(s)).toBe(true);
  });
  it('falha fechada: sem ator 401; sem acesso ao módulo 403 FORBIDDEN (mesmo com canApprove); canApprove que não seja exatamente true não aprova', () => {
    const s = setup();
    expect(h.approveCreative(s.as(undefined), { creativeId: s.cid }).status).toBe(401);
    const sem = h.approveCreative(s.as(semModulo), { creativeId: s.cid });
    expect([sem.status, code(sem)]).toEqual([403, 'FORBIDDEN']);
    for (const bad of ['true', 1, 'admin', {}, null]) {
      const r = h.approveCreative(s.as({ ...comercial, canApprove: bad } as unknown as Actor), { creativeId: s.cid });
      expect([r.status, code(r)], JSON.stringify(bad)).toEqual([403, 'APPROVAL_FORBIDDEN']);
    }
    expect(approved(s)).toBe(false);
  });
  it('a permissão vem antes de qualquer outra resposta: criativo inexistente e entrada inválida não vazam para quem não aprova', () => {
    const s = setup();
    expect(code(h.approveCreative(s.as(comercial), { creativeId: 'cr-999' }))).toBe('APPROVAL_FORBIDDEN');
    expect(code(h.approveCreative(s.as(comercial), {}))).toBe('APPROVAL_FORBIDDEN');
    expect(h.approveCreative(s.as(proprietario), { creativeId: 'cr-999' }).status).toBe(404);
  });
  it('o comercial continua preparando: cria o criativo, troca o conteúdo; trocar o conteúdo revoga a aprovação do proprietário', () => {
    const s = setup();
    h.approveCreative(s.as(proprietario), { creativeId: s.cid });
    expect(approved(s)).toBe(true);
    expect(h.setCreativeContent(s.as(comercial), { creativeId: s.cid, altText: 'Texto novo' }).status).toBe(200);
    expect(approved(s)).toBe(false); // volta a depender do proprietário
    expect(h.approveCreative(s.as(comercial), { creativeId: s.cid }).status).toBe(403);
  });
});

describe('aprovar campanha (transição para approved)', () => {
  const reservar = (s: ReturnType<typeof setup>) => h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'reserved', reservationIds: [s.res.id] });
  it('o comercial NÃO leva a campanha a approved: 403 APPROVAL_FORBIDDEN e o status não muda', () => {
    const s = setup();
    expect(reservar(s).status).toBe(200); expect(status(s)).toBe('reserved');
    for (const actor of [comercial, comercialExplicito]) {
      const r = h.transitionCampaign(s.as(actor), { campaignId: s.camp.id, to: 'approved' });
      expect([r.status, code(r)]).toEqual([403, 'APPROVAL_FORBIDDEN']);
    }
    expect(status(s)).toBe('reserved');
  });
  it('o proprietário aprova a campanha', () => {
    const s = setup(); reservar(s);
    expect(h.transitionCampaign(s.as(proprietario), { campaignId: s.camp.id, to: 'approved' }).status).toBe(200);
    expect(status(s)).toBe('approved');
  });
  it('a permissão é checada antes da transição: o comercial recebe 403 mesmo em campanha inexistente ou em estado errado', () => {
    const s = setup();
    expect(code(h.transitionCampaign(s.as(comercial), { campaignId: 'cmp-999', to: 'approved' }))).toBe('APPROVAL_FORBIDDEN');
    expect(code(h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'approved' }))).toBe('APPROVAL_FORBIDDEN'); // ainda em draft
    expect(status(s)).toBe('draft');
  });
  it('as outras transições seguem com o comercial (reservar, ativar já aprovada, pausar, retomar, cancelar) — a DP-43 só trata a aprovação', () => {
    const s = setup(); reservar(s);
    h.transitionCampaign(s.as(proprietario), { campaignId: s.camp.id, to: 'approved' });
    h.approveCreative(s.as(proprietario), { creativeId: s.cid });
    const ativar = h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'active' });
    expect(ativar.status).toBe(200); expect(status(s)).toBe('active');
    expect(h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'paused' }).status).toBe(200);
    expect(h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'active' }).status).toBe(200);
    expect(h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'cancelled' }).status).toBe(200);
  });
  it('sem aprovação do proprietário a campanha não ativa, mesmo com tudo o mais pronto (não há atalho de reserved para active)', () => {
    const s = setup(); reservar(s);
    h.approveCreative(s.as(proprietario), { creativeId: s.cid });
    const r = h.transitionCampaign(s.as(comercial), { campaignId: s.camp.id, to: 'active' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(status(s)).toBe('reserved');
  });
});
