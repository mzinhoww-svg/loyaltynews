// Teto da janela do painel do Studio: no máximo MAX_WINDOW_DAYS (366, a mesma dos relatórios) dias de calendário inclusive.
// Acima disso, 400 WINDOW_TOO_LARGE nomeado (nunca 500) em vez de varrer todo o histórico.
import { describe, expect, it } from 'vitest';
import { MAX_WINDOW_DAYS, createCommercialState, makeCtx, buildCampaignReport } from './index';
import * as h from './api/index';

const NOW = '2026-12-05T12:00:00-03:00';
const studio = { id: 'u', canManageCommercial: true };
const ctx = () => makeCtx(createCommercialState(), { now: NOW, today: '2026-12-05', flags: {}, actor: studio });
const maisDias = (de: string, n: number) => new Date(Date.parse(`${de}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const code = (r: { body: unknown }) => (r.body as { error?: { code?: string } }).error?.code;

describe('painel: teto da janela', () => {
  it('o teto é o mesmo dos relatórios (366 dias)', () => {
    expect(MAX_WINDOW_DAYS).toBe(366);
    // o relatório de campanha recusa 367 dias com a mesma regra
    const camp = { id: 'k', name: 'x', accountId: 'a', opportunityId: null, formatId: 'banners--banner-topo', positionIds: ['TOP'], positionId: 'TOP', startDate: '2026-01-01', endDate: '2027-12-31', status: 'draft', reservationIds: [], sponsoredLabel: true, history: [] } as never;
    const base = { campaign: camp, advertiserName: null, creatives: [], reservations: [], delivery: [], audit: createCommercialState().ads.audit, now: NOW };
    expect(() => buildCampaignReport({ ...base, window: { from: '2026-01-01', to: maisDias('2026-01-01', MAX_WINDOW_DAYS - 1) } })).not.toThrow();
    expect(() => buildCampaignReport({ ...base, window: { from: '2026-01-01', to: maisDias('2026-01-01', MAX_WINDOW_DAYS) } })).toThrow(/366/);
  });
  it('na fronteira: 365 e 366 dias passam (200); 367 é recusado com 400 WINDOW_TOO_LARGE', () => {
    const de = '2026-03-01';
    for (const dias of [1, 30, 365, 366]) {
      const r = h.getStudioDashboard(ctx(), { from: de, to: maisDias(de, dias - 1) });
      expect(r.status, `${dias} dias`).toBe(200);
    }
    const r = h.getStudioDashboard(ctx(), { from: de, to: maisDias(de, 366) }); // 367 dias
    expect([r.status, code(r)]).toEqual([400, 'WINDOW_TOO_LARGE']);
    expect(JSON.stringify(r.body)).toContain('"maxDays":366');
    expect(JSON.stringify(r.body)).toContain('"requestedDays":367');
  });
  it('janelas muito maiores também são recusadas (nada de 500)', () => {
    for (const [from, to] of [['2020-01-01', '2026-12-31'], ['1900-01-01', '2999-12-31'], ['2026-01-01', '9999-12-31']] as const) {
      const r = h.getStudioDashboard(ctx(), { from, to });
      expect([r.status, code(r)], `${from}..${to}`).toEqual([400, 'WINDOW_TOO_LARGE']);
    }
  });
  it('a recusa vem depois da autenticação: sem ator 401; sem permissão 403; entrada inválida segue 400 do schema', () => {
    expect(h.getStudioDashboard(makeCtx(createCommercialState(), { now: NOW }), { from: '2020-01-01', to: '2026-12-31' }).status).toBe(401);
    expect(h.getStudioDashboard(makeCtx(createCommercialState(), { now: NOW, actor: { id: 'x', canManageCommercial: false } }), { from: '2020-01-01', to: '2026-12-31' }).status).toBe(403);
    expect(code(h.getStudioDashboard(ctx(), { from: 'ontem', to: '2026-12-31' }))).toBe('VALIDATION_ERROR');
  });
  it('o painel de 30 dias (o que o Studio usa) segue igual', () => {
    const r = h.getStudioDashboard(ctx(), { from: '2026-12-05', to: '2027-01-03' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ period: { from: '2026-12-05', to: '2027-01-03' } });
  });
});
