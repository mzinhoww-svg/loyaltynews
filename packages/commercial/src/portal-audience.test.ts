import { describe, expect, it } from 'vitest';
import { MetricStore, createCommercialState, getFormat, makeCtx, mediaKitPage, portalAudience, portalCoverage, priceLabel } from './index';

const NOW = '2026-12-05T12:00:00-03:00';

describe('audiência no formato do portal', () => {
  it('sem coleta: tudo indisponível, valor nulo, com a origem de cada métrica e sem janela', () => {
    const a = portalAudience(new MetricStore(), NOW);
    expect(a.realtime).toHaveLength(1);
    expect(a.historical.length).toBeGreaterThanOrEqual(5);
    for (const m of [...a.realtime, ...a.historical]) {
      expect(m).toMatchObject({ value: null, state: 'unavailable' });
      expect(m.window).toBeUndefined(); expect(m.collectedAt).toBeUndefined(); expect(m.source.length).toBeGreaterThan(0);
    }
    expect(a.realtime[0]!.source).toBe('GA4 (tempo real)');
  });
  it('com coleta: valor em pt-BR, janela em datas de São Paulo, horário da coleta; stale marcado; tempo real com janela de 30 min', () => {
    const m = new MetricStore();
    m.ingest({ source: 'ga4_report', metric: 'sessions_30d', value: 12345, period_start: '2026-11-05T00:00:00-03:00', period_end: '2026-12-04T23:59:59-03:00', fetched_at: '2026-12-05T08:00:00-03:00' });
    m.ingest({ source: 'ga4_realtime', metric: 'active_users_30min', value: 7, period_start: '2026-12-05T11:30:00-03:00', period_end: '2026-12-05T12:00:00-03:00', fetched_at: NOW });
    const a = portalAudience(m, NOW);
    const sess = a.historical.find((x) => x.label.startsWith('Sessões'))!;
    expect(sess).toMatchObject({ value: '12.345', state: 'ok', window: '05/11/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00', source: 'GA4' });
    expect(a.realtime[0]).toMatchObject({ value: '7', state: 'ok', window: 'últimos 30 min' });
    const old = portalAudience(m, '2026-12-08T12:00:00-03:00'); // 3 dias depois: histórico e tempo real envelhecem
    expect(old.historical.find((x) => x.label.startsWith('Sessões'))!.state).toBe('stale');
    expect(old.realtime[0]!.state).toBe('stale');
  });
  it('o mídia kit público traz a audiência, os preços de referência como estão e o aviso de integridade vazio', () => {
    const state = createCommercialState();
    const kit = mediaKitPage(makeCtx(state, { now: NOW }));
    expect(kit.audience.realtime[0]!.state).toBe('unavailable');
    expect(priceLabel(getFormat('banners--banner-topo')!)).toBe('R$ 3.000/mês'); // preços mantidos (DP-15)
    expect(kit.blocks.catalogo.total).toBe(47);
    expect(kit.deliveryIntegrity).toEqual({ gaps: [], note: null });
  });
});

describe('cobertura do CMS no formato do portal', () => {
  it('sem coleta: três métricas indisponíveis, com id, origem CMS e sem janela nem data', () => {
    const c = portalCoverage(new MetricStore(), NOW);
    expect(c.map((m) => m.id)).toEqual(['articles_published_30d', 'articles_published_90d', 'upcoming_events']);
    for (const m of c) { expect(m).toMatchObject({ value: null, state: 'unavailable', source: 'CMS' }); expect(m.window).toBeUndefined(); expect(m.collectedAt).toBeUndefined(); }
  });
  it('com coleta: valor, janela e data; só o que foi coletado aparece', () => {
    const s = new MetricStore();
    s.ingest({ source: 'cms', metric: 'articles_published_30d', value: 12, period_start: '2026-11-05T00:00:00-03:00', period_end: '2026-12-04T23:59:59-03:00', fetched_at: '2026-12-05T08:00:00-03:00' });
    const c = portalCoverage(s, NOW);
    expect(c[0]).toEqual({ id: 'articles_published_30d', label: 'Matérias publicadas (30 dias)', value: '12', state: 'ok', source: 'CMS', window: '05/11/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00' });
    expect(c[1]).toMatchObject({ value: null, state: 'unavailable' });
  });
  it('o mídia kit público traz a cobertura; sem coleta nenhuma contagem aparece', () => {
    const kit = mediaKitPage(makeCtx(createCommercialState(), { now: NOW }));
    expect(kit.coverage).toHaveLength(3);
    expect(kit.coverage.every((m) => m.value === null)).toBe(true);
  });
});
