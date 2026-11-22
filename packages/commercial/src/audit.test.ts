import { describe, expect, it } from 'vitest';
import {
  AdServer, DeliveryAudit, ImpressionLedger, IMPRESSION_TTL_MS, VIEW_TTL_MS, SnapshotError, auditabilityOf, campaignPeriodMs, createCommercialState,
  loadState, makeCtx, mediaKitPage, snapshotState, studioDashboard, campaignDetail, type Creative,
} from './index';
import * as h from './api/index';

const T0 = Date.parse('2026-12-05T12:00:00-03:00');
const MIN = 60_000;
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const cr = (id: string, campaignId: string, positionId = 'TOP'): Creative => ({ id, campaignId, positionId, weight: 1, startDate: '2026-12-01', endDate: '2027-02-28', approved: true, campaignActive: true });
const serve = (s: AdServer, pv: string, nowMs: number) => s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: pv, nowMs });
function server() { const s = new AdServer(); s.addCreative(cr('c1', 'k1')); return s; }

describe('perda do dedupe: sub-contar, nunca inflar', () => {
  it('SEM mitigação o cenário inflaria: a mesma visualização, depois de o livro ser perdido, conta duas vezes', () => {
    const s = server();
    const r1 = serve(s, 'pv1', T0);
    s.ledger.clear(); // equivale ao Redis restaurado sem as chaves
    const r2 = serve(s, 'pv1', T0 + 5 * MIN);
    expect([r1.counted, r2.counted]).toEqual([true, true]);
    expect(s.delivery('c1').served).toBe(2); // inflado: era um leitor só
  });

  it('COM a lacuna aberta: o mesmo cenário não conta; o criativo continua sendo servido', () => {
    const s = server();
    serve(s, 'pv1', T0);
    s.ledger.clear();
    s.audit.reportLoss({ detectedAtMs: T0 + 2 * MIN, reason: 'dedupe_perdido', lastHealthyAtMs: T0 + MIN });
    const r2 = serve(s, 'pv1', T0 + 5 * MIN);
    expect(r2).toMatchObject({ kind: 'creative', creativeId: 'c1', counted: false, reason: 'dedupe_suspenso', impressionId: null });
    expect(s.delivery('c1').served).toBe(1); // só a original
    expect(s.audit.list()[0]!.uncountedServes).toBe(1);
  });

  it('a contagem volta depois do TTL da visualização, e o visível/clique só depois do TTL da impressão', () => {
    const s = server();
    const det = T0;
    s.audit.reportLoss({ detectedAtMs: det, reason: 'dedupe_perdido' });
    expect(serve(s, 'a', det + VIEW_TTL_MS - 1).counted).toBe(false);
    const depois = serve(s, 'b', det + VIEW_TTL_MS);
    expect(depois.counted).toBe(true);
    // visível/clique ainda suspensos (a impressão 'b' foi criada, mas o evento chega dentro da janela de eventos)
    expect(s.recordVisible(depois.impressionId!, det + VIEW_TTL_MS + MIN)).toBe(false);
    expect(s.recordClick(depois.impressionId!, det + IMPRESSION_TTL_MS - 1)).toBe(false);
    expect(s.audit.list()[0]!.ignoredEvents).toBe(2);
    expect(s.recordVisible(depois.impressionId!, det + IMPRESSION_TTL_MS)).toBe(true);
    expect(s.recordClick(depois.impressionId!, det + IMPRESSION_TTL_MS)).toBe(true);
  });

  it('antes da detecção nada muda; bots e internos seguem fora da contagem como sempre', () => {
    const s = server();
    s.audit.reportLoss({ detectedAtMs: T0 + 10 * MIN, reason: 'dedupe_perdido' });
    expect(serve(s, 'cedo', T0).counted).toBe(true); // instante anterior à detecção
    expect(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'bot', isBot: true, nowMs: T0 + 11 * MIN })).toMatchObject({ kind: 'ignored', counted: false });
    expect(s.audit.list()[0]!.uncountedServes).toBe(0); // bot não é atribuído à lacuna
  });

  it('sem criativo elegível durante a lacuna: house ad, sem registrar contagem', () => {
    const s = new AdServer();
    s.audit.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    expect(serve(s, 'p', T0 + MIN)).toMatchObject({ kind: 'house', counted: false });
    expect(s.audit.list()[0]!.uncountedServes).toBe(0);
  });

  it('rotação continua distribuindo durante a lacuna (a suspensão não congela um criativo)', () => {
    const s = new AdServer();
    s.addCreative(cr('c1', 'k1')); s.addCreative(cr('c2', 'k2'));
    s.audit.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    const seen = new Set<string | null>();
    for (let i = 0; i < 6; i++) seen.add(serve(s, `p${i}`, T0 + MIN).creativeId);
    expect(seen).toEqual(new Set(['c1', 'c2']));
  });
});

describe('lacunas: registro e fusão', () => {
  it('limites da lacuna: início = último estado saudável; fim = detecção + TTL da impressão', () => {
    const a = new DeliveryAudit();
    const g = a.reportLoss({ detectedAtMs: T0, lastHealthyAtMs: T0 - 7 * MIN, reason: 'dedupe_regrediu' });
    expect(Date.parse(g.from)).toBe(T0 - 7 * MIN);
    expect(Date.parse(g.servedUntil)).toBe(T0 + VIEW_TTL_MS);
    expect(Date.parse(g.to)).toBe(T0 + IMPRESSION_TTL_MS);
    // último saudável no futuro (relógio torto) nunca vira início depois da detecção
    expect(Date.parse(new DeliveryAudit().reportLoss({ detectedAtMs: T0, lastHealthyAtMs: T0 + 99 * MIN, reason: 'dedupe_perdido' }).from)).toBe(T0);
  });
  it('nova perda durante a suspensão funde com a anterior e reinicia a janela', () => {
    const a = new DeliveryAudit();
    const g1 = a.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    const g2 = a.reportLoss({ detectedAtMs: T0 + 20 * MIN, reason: 'dedupe_regrediu' });
    expect(a.list()).toHaveLength(1);
    expect(g2).toBe(g1);
    expect(Date.parse(g1.servedUntil)).toBe(T0 + 20 * MIN + VIEW_TTL_MS);
    expect(Date.parse(g1.to)).toBe(T0 + 20 * MIN + IMPRESSION_TTL_MS);
    expect(g1.reason).toBe('dedupe_regrediu');
    expect(a.servingSuspended(T0 + 20 * MIN + VIEW_TTL_MS - 1)).toBe(true);
    expect(a.servingSuspended(T0 + 20 * MIN + VIEW_TTL_MS)).toBe(false);
  });
  it('perdas distantes viram lacunas separadas', () => {
    const a = new DeliveryAudit();
    a.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    a.reportLoss({ detectedAtMs: T0 + IMPRESSION_TTL_MS + 10 * MIN, reason: 'dedupe_perdido' });
    expect(a.list().map((g) => g.id)).toEqual(['gap-1', 'gap-2']);
  });
  it('ida e volta por JSON preserva lacunas e contadores; ids novos não colidem; dado inválido é recusado', () => {
    const a = new DeliveryAudit();
    a.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' }); a.noteUncountedServe(T0 + MIN);
    const b = new DeliveryAudit(); b.load(wire(a.snapshot()));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.reportLoss({ detectedAtMs: T0 + 5 * 3_600_000, reason: 'dedupe_perdido' }).id).toBe('gap-2');
    const bad = wire(a.snapshot());
    expect(() => new DeliveryAudit().load({ ...bad, version: 3 } as never)).toThrow(SnapshotError);
    expect(() => new DeliveryAudit().load({ ...bad, gaps: [{ ...bad.gaps[0]!, to: 'xx' }] })).toThrow(/inválido/);
  });
  it('AdServer.snapshot inclui a lacuna e a suspensão continua depois de reiniciar o processo', () => {
    const a = server();
    a.audit.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    const b = new AdServer(); b.load(wire(a.snapshot()));
    expect(serve(b, 'p', T0 + MIN)).toMatchObject({ counted: false, reason: 'dedupe_suspenso' });
  });
  it('snapshot antigo sem o campo audit ainda carrega', () => {
    const a = server(); const old = wire(a.snapshot()); delete old.audit;
    const b = new AdServer(); b.load(old);
    expect(b.audit.list()).toEqual([]);
  });
  it('o livro injetado e o relógio do ledger são usados quando a requisição não traz o instante', () => {
    let t = T0;
    const L = new ImpressionLedger({ now: () => t });
    const s = new AdServer(L); s.addCreative(cr('c1', 'k1'));
    s.audit.reportLoss({ detectedAtMs: T0, reason: 'dedupe_perdido' });
    expect(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'p' }).counted).toBe(false);
    t = T0 + VIEW_TTL_MS + 1;
    expect(s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: 'q' }).counted).toBe(true);
  });
});

describe('"não auditável" nos relatórios', () => {
  const NOW_ISO = '2026-12-05T12:00:00-03:00';
  function scenario() {
    const state = createCommercialState();
    const camp = state.campaigns.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2026-12-31' }, NOW_ISO);
    const ctx = makeCtx(state, { now: NOW_ISO, today: '2026-12-05', flags: { adServerVendas: true }, actor: { id: 'u', canManageCommercial: true } });
    return { state, camp, ctx };
  }
  it('sem lacuna: auditável, sem nota; mídia kit sem aviso (estado vazio honesto)', () => {
    const { camp, ctx } = scenario();
    expect(campaignDetail(ctx, camp.id).report.auditability).toEqual({ auditable: true, gaps: [], note: null });
    expect(mediaKitPage(ctx).deliveryIntegrity).toEqual({ gaps: [], note: null });
    expect(studioDashboard(ctx, '2026-12-01', '2026-12-31').attention.some((a) => a.kind === 'periodo_nao_auditavel')).toBe(false);
  });
  it('lacuna dentro do período: campanha, painel e mídia kit marcam "não auditável" e dizem que o número é mínimo', () => {
    const { state, camp, ctx } = scenario();
    state.ads.audit.reportLoss({ detectedAtMs: Date.parse('2026-12-10T09:00:00-03:00'), lastHealthyAtMs: Date.parse('2026-12-10T08:30:00-03:00'), reason: 'dedupe_perdido' });
    const rep = campaignDetail(ctx, camp.id).report.auditability;
    expect(rep.auditable).toBe(false);
    expect(rep.gaps).toHaveLength(1);
    expect(rep.note).toMatch(/mínimos, não totais/);
    expect(mediaKitPage(ctx).deliveryIntegrity.note).toMatch(/mínimos/);
    const att = studioDashboard(ctx, '2026-12-01', '2026-12-31').attention.find((a) => a.kind === 'periodo_nao_auditavel');
    expect(att?.message).toMatch(/dedupe_perdido/);
  });
  it('lacuna fora do período da campanha não a afeta (bordas inclusive)', () => {
    const { state, camp, ctx } = scenario();
    state.ads.audit.reportLoss({ detectedAtMs: Date.parse('2026-11-20T09:00:00-03:00'), reason: 'dedupe_perdido' });
    expect(campaignDetail(ctx, camp.id).report.auditability.auditable).toBe(true);
    const [s, e] = campaignPeriodMs('2026-12-01', '2026-12-31');
    const a = new DeliveryAudit();
    a.reportLoss({ detectedAtMs: e - IMPRESSION_TTL_MS + MIN, lastHealthyAtMs: e - 1, reason: 'dedupe_perdido' }); // começa no último ms do período
    expect(auditabilityOf(a, s, e).auditable).toBe(false);
    const b = new DeliveryAudit();
    b.reportLoss({ detectedAtMs: e, reason: 'dedupe_perdido' }); // começa exatamente quando o período termina
    expect(auditabilityOf(b, s, e).auditable).toBe(true);
  });
  it('estado inteiro: a lacuna sobrevive a snapshotState/loadState', () => {
    const { state } = scenario();
    state.ads.audit.reportLoss({ detectedAtMs: T0, reason: 'dedupe_regrediu' });
    const copy = createCommercialState(); loadState(copy, wire(snapshotState(state)));
    expect(copy.ads.audit.list()).toEqual(state.ads.audit.list());
  });
  it('handlers públicos respeitam a suspensão pelo instante do contexto', () => {
    const { state } = scenario();
    state.ads.addCreative(cr('c9', 'cmp-1', 'FOOTER'));
    state.ads.audit.reportLoss({ detectedAtMs: Date.parse(NOW_ISO) - MIN, reason: 'dedupe_perdido' });
    const pub = makeCtx(state, { now: NOW_ISO, today: '2026-12-05', flags: { adServerVendas: true } });
    expect(h.serveAd(pub, { positionId: 'FOOTER', pageViewId: 'p1' }).body).toMatchObject({ kind: 'creative', counted: false, reason: 'dedupe_suspenso' });
    const later = makeCtx(state, { now: new Date(Date.parse(NOW_ISO) + VIEW_TTL_MS + 2 * MIN).toISOString(), today: '2026-12-05', flags: { adServerVendas: true } });
    const ok = h.serveAd(later, { positionId: 'FOOTER', pageViewId: 'p2' }).body as { counted: boolean; impressionId: string };
    expect(ok.counted).toBe(true);
    expect(h.recordAdEvent(later, { impressionId: ok.impressionId, event: 'visible' }).body).toEqual({ counted: false }); // eventos ainda suspensos
  });
});
