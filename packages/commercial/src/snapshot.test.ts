import { describe, expect, it } from 'vitest';
import {
  AdServer, CampaignBook, Crm, ImpressionLedger, InventoryBook, MetricStore, SnapshotError, SNAPSHOT_VERSION,
  createCommercialState, diffCounters, generateMediaKit, loadState, makeCtx, snapshotState, studioDashboard, viewKey,
  type Creative, type Reservation,
} from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-11-22T12:00:00-03:00';
/** Passa por JSON como o banco/Redis fariam: o snapshot precisa sobreviver a isso sem perda. */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const creative = (id: string, campaignId: string, positionId = 'TOP', weight = 1): Creative => ({
  id, campaignId, positionId, weight, startDate: '2026-12-01', endDate: '2027-02-28', approved: true, campaignActive: true, ...realContent(positionId),
});

describe('Crm', () => {
  function populated() {
    const crm = new Crm();
    const l1 = crm.captureLead({ name: 'Ana', company: 'Acme', email: 'ana@acme.com', formatIds: ['banners--banner-topo'], newsletterOptIn: true }, NOW);
    crm.captureLead({ name: 'Bia', company: 'Beta', email: 'bia@beta.com' }, NOW);
    const { opportunity } = crm.convertLead(l1.id, NOW);
    crm.moveStage(opportunity.id, 'qualificado', NOW, { nextAction: 'ligar', nextActionDue: '2026-12-01' });
    crm.moveStage(opportunity.id, 'proposta', NOW, { amountBRL: 9000 });
    return crm;
  }
  it('ida e volta por JSON preserva tudo e é idempotente', () => {
    const a = populated();
    const s = wire(a.snapshot());
    expect(s.version).toBe(SNAPSHOT_VERSION);
    const b = new Crm(); b.load(s);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(wire(b.snapshot())).toEqual(s);
    expect(b.pipeline()).toEqual(a.pipeline());
  });
  it('contador de ids continua depois de carregar: novos ids não colidem', () => {
    const a = populated();
    const b = new Crm(); b.load(wire(a.snapshot()));
    const existing = new Set([...b.leads.keys(), ...b.accounts.keys(), ...b.opportunities.keys()]);
    const novo = b.captureLead({ name: 'Cid', company: 'Gama', email: 'cid@gama.com' }, NOW);
    expect(existing.has(novo.id)).toBe(false);
    const conv = b.convertLead(novo.id, NOW);
    expect(existing.has(conv.account.id) || existing.has(conv.opportunity.id)).toBe(false);
  });
  it('snapshot é cópia: alterar um lado não afeta o outro', () => {
    const a = populated();
    const s = a.snapshot();
    s.leads[0]!.name = 'ALTERADO';
    expect([...a.leads.values()][0]!.name).toBe('Ana');
    const b = new Crm(); b.load(s);
    s.leads[0]!.name = 'DE NOVO';
    expect([...b.leads.values()][0]!.name).toBe('ALTERADO');
  });
  it('carga inválida é recusada e o estado anterior fica intacto', () => {
    const a = populated(); const before = a.snapshot();
    const bad = [
      { ...wire(before), version: 99 },
      { ...wire(before), leads: undefined },
      { ...wire(before), accounts: [...before.accounts, ...before.accounts] },
      null,
    ];
    for (const s of bad) expect(() => a.load(s as never)).toThrow(SnapshotError);
    expect(a.snapshot()).toEqual(before);
  });
  it('carga substitui (não soma) o estado', () => {
    const a = populated();
    const empty = new Crm();
    a.load(empty.snapshot());
    expect(a.leads.size + a.accounts.size + a.opportunities.size).toBe(0);
  });
});

describe('InventoryBook', () => {
  function populated() {
    const inv = new InventoryBook();
    inv.reserve({ positionId: 'TOP', advertiserId: 'a', campaignId: 'cmp-1', startDate: '2026-12-01', endDate: '2027-02-28', status: 'confirmed' });
    inv.reserve({ positionId: 'FOOTER', advertiserId: 'b', campaignId: 'cmp-2', startDate: '2026-12-01', endDate: '2026-12-31' });
    const cancelled = inv.reserve({ positionId: 'SIDEBAR_1', advertiserId: 'c', startDate: '2026-12-01', endDate: '2026-12-31' });
    inv.cancel(cancelled.id);
    inv.reserveTakeover({ date: '2026-12-20', advertiserId: 'big', agreedCampaignIds: ['cmp-1', 'cmp-2'] });
    return inv;
  }
  it('ida e volta por JSON; disponibilidade e uso diário idênticos', () => {
    const a = populated();
    const b = new InventoryBook(); b.load(wire(a.snapshot()));
    expect(b.snapshot()).toEqual(a.snapshot());
    for (const p of ['TOP', 'FOOTER', 'SIDEBAR_1', 'AGENDA']) {
      expect(b.availability(p, '2026-12-01', '2026-12-31')).toEqual(a.availability(p, '2026-12-01', '2026-12-31'));
      expect(b.dailyUsage(p, '2026-12-18', '2026-12-22')).toEqual(a.dailyUsage(p, '2026-12-18', '2026-12-22'));
    }
  });
  it('regras continuam valendo após carregar: cota, takeover e ids sem colisão', () => {
    const b = new InventoryBook(); b.load(wire(populated().snapshot()));
    expect(() => b.reserve({ positionId: 'SIDEBAR_2', advertiserId: 'z', startDate: '2026-12-15', endDate: '2027-01-14' })).toThrow(/Takeover/);
    const ids = new Set(b.list().map((r) => r.id).concat(b.listTakeovers().map((t) => t.id)));
    const r = b.reserve({ positionId: 'FOOTER', advertiserId: 'n', startDate: '2027-02-01', endDate: '2027-03-03' });
    expect(ids.has(r.id)).toBe(false);
    expect(() => b.reserveTakeover({ date: '2026-12-20', advertiserId: 'x' })).toThrow(/Já existe/);
  });
  it('posições customizadas vão e voltam; snapshot sem posições mantém as atuais', () => {
    const custom = [{ ...new InventoryBook().listPositions()[0]!, slotLimit: 2 }];
    const a = new InventoryBook(custom);
    const b = new InventoryBook(); b.load(wire(a.snapshot()));
    expect(b.listPositions()).toEqual(custom);
    const semPosicoes = wire(a.snapshot()); delete semPosicoes.positions;
    const c = new InventoryBook(); c.load(semPosicoes);
    expect(c.listPositions().length).toBe(9);
  });
  it('recusa versão errada e ids duplicados sem alterar o estado', () => {
    const a = populated(); const before = a.snapshot();
    expect(() => a.load({ ...wire(before), version: 2 } as never)).toThrow(SnapshotError);
    expect(() => a.load({ ...wire(before), reservations: [...before.reservations, before.reservations[0]!] })).toThrow(SnapshotError);
    expect(a.snapshot()).toEqual(before);
  });
});

describe('CampaignBook', () => {
  const R = (over: Partial<Reservation> = {}): Reservation => ({ id: 'res-1', positionId: 'TOP', advertiserId: 'a', campaignId: 'cmp-1', startDate: '2026-12-01', endDate: '2027-02-28', status: 'confirmed', ...over });
  function populated() {
    const cb = new CampaignBook();
    const c = cb.create({ name: 'X', accountId: 'acc-1', formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-02-28', sponsoredLabel: true }, NOW);
    cb.transition(c.id, 'reserved', NOW, { reservations: [R()] });
    cb.transition(c.id, 'approved', NOW, { note: 'cliente aprovou' });
    cb.create({ name: 'Y', accountId: 'acc-2', formatId: 'banners--banner-rodape', startDate: '2026-12-01', endDate: '2026-12-31' }, NOW);
    return cb;
  }
  it('ida e volta por JSON preserva estados e histórico; ids continuam', () => {
    const a = populated();
    const b = new CampaignBook(); b.load(wire(a.snapshot()));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.get('cmp-1').history.map((x) => x.to)).toEqual(['draft', 'reserved', 'approved']);
    expect(b.create({ name: 'Z', accountId: 'a', formatId: 'banners--banner-topo', startDate: '2026-12-01', endDate: '2026-12-31' }, NOW).id).toBe('cmp-3');
  });
  it('regras de ativação continuam valendo depois de carregar', () => {
    const b = new CampaignBook(); b.load(wire(populated().snapshot()));
    expect(() => b.transition('cmp-1', 'active', NOW)).toThrow(/Ativação recusada/);
    b.transition('cmp-1', 'active', NOW, { activation: { saleEnabled: true, formatStatus: 'disponivel', reservations: [R()], approvedCreativeCount: 1 } });
    expect(b.get('cmp-1').status).toBe('active');
  });
  it('recusa snapshot inválido; estado anterior intacto', () => {
    const a = populated(); const before = a.snapshot();
    expect(() => a.load({ ...wire(before), campaigns: 'x' } as never)).toThrow(SnapshotError);
    expect(() => a.load({ ...wire(before), campaigns: [before.campaigns[0]!, before.campaigns[0]!] })).toThrow(SnapshotError);
    expect(a.snapshot()).toEqual(before);
  });
});

describe('MetricStore', () => {
  function populated() {
    const m = new MetricStore();
    m.ingest({ source: 'ga4_report', metric: 'sessions_30d', value: 1234, period_start: '2026-10-23T00:00:00-03:00', period_end: '2026-11-21T23:59:59-03:00', fetched_at: NOW });
    m.ingest({ source: 'cms', metric: 'articles_published_30d', value: 12, period_start: '2026-10-23T00:00:00-03:00', period_end: '2026-11-22T00:00:00-03:00', fetched_at: NOW });
    m.markFailure({ source: 'cms', metric: 'articles_published_30d' }); // vira stale
    return m;
  }
  it('ida e volta preserva valor, período, horário, metodologia e o estado stale', () => {
    const a = populated();
    const b = new MetricStore(); b.load(wire(a.snapshot()));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.get({ source: 'cms', metric: 'articles_published_30d' }, NOW).status).toBe('stale');
    expect(b.get({ source: 'ga4_report', metric: 'sessions_30d' }, NOW)).toMatchObject({ value: 1234, fetched_at: NOW, methodology_version: 'mk-1' });
  });
  it('mídia kit gerado antes e depois da carga é idêntico', () => {
    const a = populated(); const b = new MetricStore(); b.load(wire(a.snapshot()));
    expect(generateMediaKit({ store: b, now: NOW })).toEqual(generateMediaKit({ store: a, now: NOW }));
  });
  it('registro sem período/horário/valor é recusado; "unavailable" é descartado (ausência = não disponível)', () => {
    const a = populated(); const before = a.snapshot();
    const rec = (over: object) => ({ version: SNAPSHOT_VERSION, records: [{ ...before.records[0]!, ...over }] });
    for (const over of [{ value: null }, { period_start: null }, { period_end: null }, { fetched_at: null }]) expect(() => a.load(rec(over) as never)).toThrow(/carga recusada/);
    expect(a.snapshot()).toEqual(before);
    a.load(rec({ status: 'unavailable', value: null, period_start: null, period_end: null, fetched_at: null }) as never);
    expect(a.all()).toHaveLength(0);
  });
});

describe('AdServer e ImpressionLedger', () => {
  function server(ledger?: ImpressionLedger) {
    const s = new AdServer(ledger);
    s.addCreative(creative('c1', 'k1', 'TOP', 3)); s.addCreative(creative('c2', 'k2', 'TOP', 1));
    return s;
  }
  const serve = (s: AdServer, pv: string) => s.serve({ positionId: 'TOP', today: '2026-12-05', pageViewId: pv });

  it('ida e volta por JSON: criativos, contadores, crédito e dedupe', () => {
    const a = server();
    const first = serve(a, 'pv0'); a.recordVisible(first.impressionId!);
    for (let i = 1; i < 7; i++) serve(a, `pv${i}`);
    const b = new AdServer(); b.load(wire(a.snapshot()));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.delivery('c1')).toEqual(a.delivery('c1'));
    // dedupe: mesma visualização depois da carga é refresh, não impressão nova
    expect(serve(b, 'pv0')).toMatchObject({ counted: false, reason: 'refresh', impressionId: first.impressionId });
    expect(b.recordVisible(first.impressionId!)).toBe(false); // já contada antes
  });
  it('rotação continua de onde parou: sequência igual à do servidor que nunca reiniciou', () => {
    const a = server();
    for (let i = 0; i < 5; i++) serve(a, `x${i}`);
    const b = new AdServer(); b.load(wire(a.snapshot()));
    const seqA: (string | null)[] = []; const seqB: (string | null)[] = [];
    for (let i = 0; i < 12; i++) { seqA.push(serve(a, `y${i}`).creativeId); seqB.push(serve(b, `y${i}`).creativeId); }
    expect(seqB).toEqual(seqA);
  });
  it('loadCreatives/loadCounters substituem (banco como fonte) e recusam peso inválido e ids repetidos', () => {
    const s = new AdServer();
    s.loadCreatives([creative('c1', 'k1')]); s.loadCounters({ c1: { served: 10, visible: 8, clicks: 1, ignoredBotOrInternal: 2, refreshSuppressed: 3 } });
    expect(s.delivery('c1')).toMatchObject({ served: 10, ctr: 0.1 });
    s.loadCreatives([creative('c9', 'k9')]);
    expect(s.listCreatives().map((c) => c.id)).toEqual(['c9']);
    expect(() => s.loadCreatives([creative('d', 'k', 'TOP', 0)])).toThrow(/weight/);
    expect(() => s.loadCreatives([creative('d', 'k'), creative('d', 'k')])).toThrow(SnapshotError);
    expect(s.listCreatives().map((c) => c.id)).toEqual(['c9']);
  });
  it('diffCounters devolve só o delta do ciclo (base do UPSERT em ad_delivery_daily)', () => {
    const s = server();
    s.loadCounters({ c1: { served: 10, visible: 8, clicks: 1, ignoredBotOrInternal: 0, refreshSuppressed: 0 } });
    const base = s.countersSnapshot();
    const r = serve(s, 'novo'); s.recordClick(r.impressionId!);
    const delta = diffCounters(base, s.countersSnapshot());
    const total = Object.values(delta).reduce((t, d) => t + d.served, 0);
    expect(total).toBe(1);
    expect(Object.values(delta).reduce((t, d) => t + d.clicks, 0)).toBe(1);
    expect(diffCounters(s.countersSnapshot(), s.countersSnapshot())).toEqual({});
  });

  describe('duas instâncias com armazenamento compartilhado (simulado)', () => {
    /** Simula Redis/tabela: guarda entradas por chave de visualização; `commit` é o SET NX/INSERT ON CONFLICT. */
    class SharedStore {
      private rows = new Map<string, import('./ledger').LedgerEntry>();
      read(keys: string[]) { return keys.flatMap((k) => { const e = this.rows.get(k); return e ? [structuredClone(e)] : []; }); }
      readImpression(id: string) { return [...this.rows.values()].filter((e) => e.impressionId === id).map((e) => structuredClone(e)); }
      commit(entries: import('./ledger').LedgerEntry[]) { for (const e of entries) this.rows.set(e.key, structuredClone(e)); }
    }
    let n = 0;
    const instance = () => { const id = ++n; let c = 0; return server(new ImpressionLedger({ newId: () => `imp-i${id}-${++c}` })); };

    it('mesma visualização atendida por instâncias diferentes conta uma vez só', () => {
      const store = new SharedStore();
      const A = instance(); const B = instance();
      const key = viewKey('pvX', 'TOP');
      A.ledger.preload(store.read([key]));
      const r1 = serve(A, 'pvX');
      store.commit(A.ledger.drainChanges());
      B.ledger.preload(store.read([key]));          // B lê o que A gravou antes de servir
      const r2 = serve(B, 'pvX');
      expect(r1.counted).toBe(true);
      expect(r2).toMatchObject({ counted: false, reason: 'refresh', impressionId: r1.impressionId });
      expect(A.delivery(r1.creativeId!).served + B.delivery(r1.creativeId!).served).toBe(1);
    });
    it('visível e clique registrados em outra instância valem uma vez', () => {
      const store = new SharedStore();
      const A = instance(); const B = instance();
      const r = serve(A, 'pvY'); store.commit(A.ledger.drainChanges());
      B.ledger.preload(store.readImpression(r.impressionId!));
      expect(B.recordVisible(r.impressionId!)).toBe(true);
      store.commit(B.ledger.drainChanges());
      A.ledger.preload(store.readImpression(r.impressionId!));
      expect(A.recordVisible(r.impressionId!)).toBe(false); // já visível na outra instância
      expect(A.recordClick(r.impressionId!)).toBe(true);
    });
    it('ids de impressão injetados são únicos entre instâncias (o padrão imp-N colidiria)', () => {
      const A = instance(); const B = instance();
      expect(serve(A, 'p1').impressionId).not.toBe(serve(B, 'p1').impressionId);
      const x = new AdServer(); const y = new AdServer();
      x.addCreative(creative('c', 'k')); y.addCreative(creative('c', 'k'));
      expect(serve(x, 'p').impressionId).toBe(serve(y, 'p').impressionId); // documenta a colisão do padrão local
    });
  });

  it('drainChanges devolve só novidades e zera; preload não marca como alterado', () => {
    const L = new ImpressionLedger();
    const s = server(L);
    const r = serve(s, 'a'); serve(s, 'b');
    expect(L.drainChanges()).toHaveLength(2);
    expect(L.drainChanges()).toHaveLength(0);
    s.recordVisible(r.impressionId!);
    expect(L.drainChanges().map((e) => [e.impressionId, e.visible])).toEqual([[r.impressionId, true]]);
    const M = new ImpressionLedger(); M.preload(L.snapshot().entries);
    expect(M.size).toBe(2); expect(M.drainChanges()).toHaveLength(0);
  });
  it('evict remove só entradas anteriores ao corte (TTL local)', () => {
    let t = 1_000;
    const L = new ImpressionLedger({ now: () => t });
    const s = server(L);
    serve(s, 'antiga'); t = 5_000; serve(s, 'recente');
    expect(L.evict(3_000)).toBe(1);
    expect(L.size).toBe(1);
    expect(L.byViewKey(viewKey('antiga', 'TOP'))).toBeUndefined();
    expect(L.drainChanges().map((e) => e.key)).toEqual([viewKey('recente', 'TOP')]); // a evicta não gera gravação
  });
  it('snapshot do livro recusa versão errada e ids duplicados', () => {
    const L = new ImpressionLedger();
    expect(() => L.load({ version: 7, seq: 0, entries: [] } as never)).toThrow(SnapshotError);
    const e = { impressionId: 'i', key: 'k', creativeId: 'c', at: 1, visible: false, clicked: false };
    expect(() => L.load({ version: SNAPSHOT_VERSION, seq: 0, entries: [e, e] })).toThrow(SnapshotError);
  });
});

describe('estado inteiro', () => {
  function scenario() {
    const state = createCommercialState();
    const c = makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true }, actor: { id: 'u', canManageCommercial: true } });
    const lead = h.submitLead(c, { nome: 'Ana', empresa: 'Acme', email: 'ana@acme.com', objetivo: 'marca', formatosInteresse: ['banners--banner-topo'] }).body as { id: string };
    const conv = h.convertLead(c, { leadId: lead.id }).body as { account: { id: string } };
    const camp = state.campaigns.create({ name: 'Acme', accountId: conv.account.id, formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    state.inventory.reserve({ positionId: 'FOOTER', advertiserId: conv.account.id, campaignId: camp.id, startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' });
    state.metrics.ingest({ source: 'ga4_report', metric: 'sessions_30d', value: 99, period_start: '2026-10-23T00:00:00-03:00', period_end: '2026-11-21T23:59:59-03:00', fetched_at: NOW });
    state.ads.addCreative(creative('cr1', camp.id, 'FOOTER'));
    const imp = state.ads.serve({ positionId: 'FOOTER', today: '2026-12-05', pageViewId: 'pv1' });
    state.ads.recordVisible(imp.impressionId!);
    return { state, camp, account: conv.account.id };
  }
  it('snapshotState/loadState: ida e volta; consultas e mídia kit idênticos', () => {
    const { state } = scenario();
    const copy = createCommercialState();
    loadState(copy, wire(snapshotState(state)));
    expect(snapshotState(copy)).toEqual(snapshotState(state));
    const ctxA = makeCtx(state, { now: NOW, today: '2026-12-05' }); const ctxB = makeCtx(copy, { now: NOW, today: '2026-12-05' });
    expect(studioDashboard(ctxB, '2026-12-01', '2026-12-31')).toEqual(studioDashboard(ctxA, '2026-12-01', '2026-12-31'));
    expect(generateMediaKit({ store: copy.metrics, now: NOW })).toEqual(generateMediaKit({ store: state.metrics, now: NOW }));
  });
  it('handlers funcionam sobre o estado carregado e os ids novos não colidem', () => {
    const { state, account } = scenario();
    const copy = createCommercialState(); loadState(copy, wire(snapshotState(state)));
    const c = makeCtx(copy, { now: NOW, today: '2026-12-05', actor: { id: 'u', canManageCommercial: true } });
    const novo = h.submitLead(c, { nome: 'Bia', empresa: 'Beta', email: 'bia@beta.com', objetivo: 'marca', formatosInteresse: [] }).body as { id: string };
    expect(state.crm.leads.has(novo.id)).toBe(false);
    const conv = h.convertLead(c, { leadId: novo.id }).body as { account: { id: string } };
    expect(conv.account.id).not.toBe(account);
    expect(h.getCampaignDetail(c, { campaignId: 'cmp-1' }).status).toBe(200);
  });
  it('atômico: um snapshot parcial inválido não altera nada do estado de destino', () => {
    const { state } = scenario();
    const dest = createCommercialState();
    const before = snapshotState(dest);
    const snap = wire(snapshotState(state));
    snap.ads.creatives = [creative('d', 'k'), creative('d', 'k')]; // ids duplicados no último trecho a ser carregado
    expect(() => loadState(dest, snap)).toThrow(SnapshotError);
    expect(snapshotState(dest)).toEqual(before);
  });
});
