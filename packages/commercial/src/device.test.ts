// `device` no ad server (pedido do PM, proposta do Frontend 1): o mobile só recebe criativo de dimensão mobile da posição (320x100 ou 300x250);
// sem criativo compatível devolve house SEM contar impressão; sem `device` o comportamento é o de antes (desktop).
import { describe, expect, it } from 'vitest';
import {
  AdServer, POSITIONS, adPlan, creativeVariant, createCommercialState, makeCtx, toPublicAd, validateCreative,
  type Creative,
} from './index';
import * as h from './api/index';
import { realContent, realMobileContent } from './real-creative.mock';

const NOW = '2026-12-05T12:00:00-03:00';
const TODAY = '2026-12-05';
const mk = (id: string, content: ReturnType<typeof realContent>, over: Partial<Creative> = {}): Creative => ({
  id, campaignId: 'k1', positionId: 'TOP', weight: 1, startDate: '2026-12-01', endDate: '2027-02-28', approved: true, campaignActive: true, ...content, ...over,
});
const desk = (id = 'd1', over: Partial<Creative> = {}) => mk(id, realContent('TOP'), over);
const mob = (id = 'm1', size: '320x100' | '300x250' = '320x100', over: Partial<Creative> = {}) => mk(id, realMobileContent('TOP', size), over);
const serve = (s: AdServer, pv: string, device?: 'mobile' | 'desktop', extra: Record<string, unknown> = {}) => s.serve({ positionId: 'TOP', today: TODAY, pageViewId: pv, device, ...extra });
const counters = (s: AdServer, id: string) => s.delivery(id);

describe('variante do criativo e validação', () => {
  it('a variante sai da dimensão REAL do arquivo contra a posição: desktop, mobile ou nenhuma', () => {
    expect(creativeVariant(desk())).toBe('desktop');
    expect(creativeVariant(mob('a', '320x100'))).toBe('mobile');
    expect(creativeVariant(mob('b', '300x250'))).toBe('mobile');
    expect(creativeVariant({ positionId: 'TOP', asset: { ...desk().asset!, width: 336, height: 280 } })).toBeNull();
    expect(creativeVariant({ positionId: 'TOP', asset: undefined })).toBeNull();
    expect(creativeVariant({ positionId: 'ARTICLE_INLINE', asset: desk().asset })).toBeNull(); // posição sem dimensão
    expect(creativeVariant({ positionId: 'NAO_EXISTE', asset: desk().asset })).toBeNull();
  });
  it('criativo mobile é válido nas 5 posições configuradas, com as 2 dimensões; dimensão fora das duas listas é recusada', () => {
    for (const id of ['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER']) {
      for (const size of ['320x100', '300x250'] as const) expect(validateCreative(mk('x', realMobileContent(id, size), { positionId: id })), `${id} ${size}`).toEqual([]);
    }
    const bad = validateCreative(mk('x', realMobileContent('TOP'), { asset: { ...realMobileContent('TOP').asset, width: 320, height: 99 } }));
    expect(bad.map((i) => i.code)).toEqual(['BAD_DIMENSIONS']);
    expect(bad[0]!.message).toContain('1280x150'); expect(bad[0]!.message).toContain('320x100');
  });
  it('as demais regras valem igual para o mobile: peso, hash, alt, destino https', () => {
    const base = realMobileContent('TOP');
    expect(validateCreative(mk('x', realMobileContent('TOP'), { asset: { ...base.asset, sizeKB: 201 } })).map((i) => i.code)).toEqual(['TOO_HEAVY']);
    expect(validateCreative(mk('x', realMobileContent('TOP'), { asset: { ...base.asset, sha256: 'xx' } })).map((i) => i.code)).toEqual(['NO_HASH']);
    expect(validateCreative(mk('x', realMobileContent('TOP'), { altText: '' })).map((i) => i.code)).toEqual(['NO_ALT']);
    expect(validateCreative(mk('x', realMobileContent('TOP'), { destinationUrl: 'http://x.example' })).map((i) => i.code)).toEqual(['BAD_DESTINATION']);
  });
  it('o anúncio público do criativo mobile leva a dimensão do próprio arquivo (nunca a do desktop)', () => {
    const ad = toPublicAd(mob('m1', '300x250'), 'imp-1')!;
    expect(ad).toMatchObject({ width: 300, height: 250, label: 'Publicidade' });
  });
});

describe('serve com device', () => {
  it('mobile recebe SÓ criativo mobile; desktop e sem device recebem SÓ criativo desktop (nunca se mistura)', () => {
    const s = new AdServer(); s.addCreative(desk('d1')); s.addCreative(mob('m1'));
    for (let i = 0; i < 6; i++) {
      expect(serve(s, `pm${i}`, 'mobile')).toMatchObject({ kind: 'creative', creativeId: 'm1', counted: true });
      expect(serve(s, `pd${i}`, 'desktop')).toMatchObject({ kind: 'creative', creativeId: 'd1', counted: true });
      expect(serve(s, `pn${i}`)).toMatchObject({ kind: 'creative', creativeId: 'd1', counted: true }); // sem device = desktop
    }
    expect(counters(s, 'm1').served).toBe(6); expect(counters(s, 'd1').served).toBe(12);
  });
  it('mobile com SÓ criativo desktop: house, sem contar, sem impressão, sem tocar em contadores nem no livro', () => {
    const s = new AdServer(); s.addCreative(desk('d1'));
    const before = JSON.stringify(s.countersSnapshot());
    for (let i = 0; i < 5; i++) {
      const r = serve(s, `pv${i}`, 'mobile');
      expect(r).toEqual({ kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo mobile elegível; house ad' });
      expect(r.ad).toBeUndefined();
    }
    expect(JSON.stringify(s.countersSnapshot())).toBe(before);
    expect(counters(s, 'd1').served).toBe(0);
    expect(s.ledger.byViewKey('pv0|TOP')).toBeUndefined();
    // e o desktop da mesma posição continua servindo e contando
    expect(serve(s, 'pvx', 'desktop')).toMatchObject({ kind: 'creative', creativeId: 'd1', counted: true });
  });
  it('desktop com SÓ criativo mobile: house (o banner de celular nunca ocupa o espaço do desktop)', () => {
    const s = new AdServer(); s.addCreative(mob('m1'));
    expect(serve(s, 'a', 'desktop')).toMatchObject({ kind: 'house', counted: false, reason: 'sem criativo elegível; house ad' });
    expect(serve(s, 'b')).toMatchObject({ kind: 'house', counted: false });
    expect(counters(s, 'm1').served).toBe(0);
  });
  it('mobile com duas dimensões (320x100 e 300x250): rotaciona ponderado entre elas, sem contaminar o crédito do desktop', () => {
    const s = new AdServer(); s.addCreative(mob('m1', '320x100')); s.addCreative(mob('m2', '300x250')); s.addCreative(desk('d1'));
    const seq = Array.from({ length: 6 }, (_, i) => serve(s, `p${i}`, 'mobile').creativeId);
    expect(seq.filter((x) => x === 'm1')).toHaveLength(3); expect(seq.filter((x) => x === 'm2')).toHaveLength(3);
    expect(seq).not.toContain('d1');
    // o desktop, que só tem 1 criativo, não foi afetado
    expect(serve(s, 'z', 'desktop').creativeId).toBe('d1');
  });
  it('as regras de elegibilidade continuam valendo no mobile: aprovado, campanha ativa, período e criativo real', () => {
    const s = new AdServer();
    s.addCreative(mob('m-nao-aprovado', '320x100', { approved: false }));
    s.addCreative(mob('m-pausada', '320x100', { campaignActive: false }));
    s.addCreative(mob('m-vencido', '320x100', { endDate: '2026-12-04' }));
    s.addCreative(mob('m-futuro', '320x100', { startDate: '2026-12-06' }));
    s.addCreative(mk('m-sem-alt', realMobileContent('TOP'), { altText: '' }));
    expect(serve(s, 'a', 'mobile')).toMatchObject({ kind: 'house', counted: false });
    s.addCreative(mob('m-ok'));
    expect(serve(s, 'b', 'mobile')).toMatchObject({ kind: 'creative', creativeId: 'm-ok', counted: true });
  });
  it('visível e clique contam uma vez por impressão mobile; refresh da mesma visualização não infla', () => {
    const s = new AdServer(); s.addCreative(mob('m1'));
    const r = serve(s, 'pv1', 'mobile');
    expect(r).toMatchObject({ counted: true, creativeId: 'm1' });
    expect(serve(s, 'pv1', 'mobile')).toMatchObject({ counted: false, reason: 'refresh', creativeId: 'm1' });
    expect(s.recordVisible(r.impressionId!)).toBe(true); expect(s.recordVisible(r.impressionId!)).toBe(false);
    expect(s.recordClick(r.impressionId!)).toBe(true); expect(s.recordClick(r.impressionId!)).toBe(false);
    expect(counters(s, 'm1')).toMatchObject({ served: 1, visible: 1, clicks: 1, refreshSuppressed: 1 });
  });
  it('a mesma visualização que já recebeu criativo de OUTRA variante não o devolve a este dispositivo (house, sem contar)', () => {
    const s = new AdServer(); s.addCreative(desk('d1')); s.addCreative(mob('m1'));
    expect(serve(s, 'pv1', 'desktop')).toMatchObject({ creativeId: 'd1', counted: true });
    const r = serve(s, 'pv1', 'mobile');
    expect(r).toMatchObject({ kind: 'house', counted: false, impressionId: null });
    expect(r.ad).toBeUndefined();
    expect(counters(s, 'd1')).toMatchObject({ served: 1, refreshSuppressed: 0 });
  });
  it('bot e tráfego interno no mobile: servem criativo mobile sem contar como entrega; sem criativo mobile, não servem o desktop', () => {
    const s = new AdServer(); s.addCreative(desk('d1'));
    expect(serve(s, 'b1', 'mobile', { isBot: true })).toMatchObject({ kind: 'ignored', creativeId: null, counted: false });
    s.addCreative(mob('m1'));
    const r = serve(s, 'b2', 'mobile', { isInternal: true });
    expect(r).toMatchObject({ kind: 'ignored', creativeId: 'm1', counted: false, reason: 'interno' });
    expect(counters(s, 'm1')).toMatchObject({ served: 0, ignoredBotOrInternal: 1 });
    expect(counters(s, 'd1').ignoredBotOrInternal).toBe(0);
  });
  it('dedupe suspenso (perda do Redis) no mobile: serve criativo mobile sem contar; sem mobile, house', () => {
    const s = new AdServer(); s.addCreative(desk('d1'));
    s.audit.reportLoss({ detectedAtMs: Date.parse(NOW), reason: 'dedupe_perdido' });
    const ms = Date.parse(NOW);
    expect(s.serve({ positionId: 'TOP', today: TODAY, pageViewId: 'x1', device: 'mobile', nowMs: ms })).toMatchObject({ kind: 'house', counted: false });
    s.addCreative(mob('m1'));
    expect(s.serve({ positionId: 'TOP', today: TODAY, pageViewId: 'x2', device: 'mobile', nowMs: ms })).toMatchObject({ kind: 'creative', creativeId: 'm1', counted: false, reason: 'dedupe_suspenso' });
  });
});

describe('plano das posições com o mobile (aditivo)', () => {
  it('available/width/height continuam sendo do desktop; `mobile` lista as dimensões mobile com criativo real hoje', () => {
    const plan = (cs: Creative[]) => adPlan(cs, TODAY, ['TOP', 'FOOTER']);
    expect(plan([])).toEqual([
      { positionId: 'TOP', available: false, width: null, height: null, mobile: [] },
      { positionId: 'FOOTER', available: false, width: null, height: null, mobile: [] },
    ]);
    expect(plan([desk()])[0]).toEqual({ positionId: 'TOP', available: true, width: 1280, height: 150, mobile: [] });
    // só mobile: o desktop NÃO fica disponível
    expect(plan([mob('m1', '320x100')])[0]).toEqual({ positionId: 'TOP', available: false, width: null, height: null, mobile: [{ width: 320, height: 100 }] });
    // os dois, com as duas dimensões mobile (ordenadas, sem repetir)
    expect(plan([desk(), mob('m2', '320x100'), mob('m3', '300x250'), mob('m4', '320x100')])[0]).toEqual({
      positionId: 'TOP', available: true, width: 1280, height: 150, mobile: [{ width: 300, height: 250 }, { width: 320, height: 100 }],
    });
    // criativo mobile não aprovado ou vencido não entra
    expect(plan([mob('m5', '320x100', { approved: false }), mob('m6', '300x250', { endDate: '2026-12-01' })])[0]!.mobile).toEqual([]);
    // outra posição não é afetada
    expect(plan([mob('m7')])[1]).toEqual({ positionId: 'FOOTER', available: false, width: null, height: null, mobile: [] });
  });
});

describe('handler POST /ads/serve com device', () => {
  const flagOn = (state = createCommercialState()) => ({ state, ctx: makeCtx(state, { now: NOW, today: TODAY, flags: { adServerVendas: true } }) });
  it('device inválido é recusado pela validação (400/422), nunca vira desktop em silêncio', () => {
    const { ctx } = flagOn();
    for (const device of ['tablet', 'MOBILE', '', 1, null, ['mobile']]) {
      const r = h.serveAd(ctx, { positionId: 'TOP', pageViewId: 'p1', device });
      expect(r.status, JSON.stringify(device)).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
    }
  });
  it('sem device: resposta igual à de antes (desktop); com device desktop: igual; com mobile: variante mobile', () => {
    const { state, ctx } = flagOn();
    state.ads.addCreative(desk('d1')); state.ads.addCreative(mob('m1', '300x250'));
    const antes = h.serveAd(ctx, { positionId: 'TOP', pageViewId: 'a' }).body as { creativeId: string; ad: { width: number; height: number } };
    const dsk = h.serveAd(ctx, { positionId: 'TOP', pageViewId: 'b', device: 'desktop' }).body as typeof antes;
    const mbl = h.serveAd(ctx, { positionId: 'TOP', pageViewId: 'c', device: 'mobile' }).body as typeof antes;
    expect(antes.creativeId).toBe('d1'); expect(antes.ad).toMatchObject({ width: 1280, height: 150 });
    expect(dsk.creativeId).toBe('d1'); expect(dsk.ad).toMatchObject({ width: 1280, height: 150 });
    expect(mbl.creativeId).toBe('m1'); expect(mbl.ad).toMatchObject({ width: 300, height: 250 });
  });
  it('mobile sem criativo mobile: 200 com house, counted:false e sem impressionId (o portal recolhe)', () => {
    const { state, ctx } = flagOn(); state.ads.addCreative(desk('d1'));
    const r = h.serveAd(ctx, { positionId: 'TOP', pageViewId: 'p1', device: 'mobile' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo mobile elegível; house ad' });
    expect(state.ads.countersSnapshot()['d1']?.served ?? 0).toBe(0);
  });
  it('flag adServerVendas desligada: house sem contar, com ou sem device (nada muda)', () => {
    const state = createCommercialState(); state.ads.addCreative(mob('m1'));
    const off = makeCtx(state, { now: NOW, today: TODAY, flags: {} });
    for (const device of [undefined, 'mobile', 'desktop'] as const) {
      expect(h.serveAd(off, { positionId: 'TOP', pageViewId: 'p1', device }).body).toMatchObject({ kind: 'house', counted: false, impressionId: null });
    }
    expect(state.ads.countersSnapshot()['m1']?.served ?? 0).toBe(0);
  });
  it('/ads/plan expõe `mobile` por posição, e só com a flag ligada', () => {
    const { state, ctx } = flagOn(); state.ads.addCreative(mob('m1', '320x100'));
    const slots = (h.getAdPlan(ctx, { positions: 'TOP' }).body as { slots: { mobile: unknown[]; available: boolean }[] }).slots;
    expect(slots[0]).toMatchObject({ available: false, mobile: [{ width: 320, height: 100 }] });
    const off = makeCtx(state, { now: NOW, today: TODAY, flags: {} });
    expect((h.getAdPlan(off, { positions: 'TOP' }).body as { slots: { mobile: unknown[] }[] }).slots[0]!.mobile).toEqual([]);
  });
  it('as posições sem dimensão continuam sem servir nada, em qualquer device', () => {
    const { state, ctx } = flagOn();
    state.ads.addCreative({ ...mob('m1'), positionId: 'ARTICLE_INLINE' });
    for (const device of [undefined, 'mobile', 'desktop'] as const) expect(h.serveAd(ctx, { positionId: 'ARTICLE_INLINE', pageViewId: 'p', device }).body).toMatchObject({ kind: 'house', counted: false });
  });
});

describe('inventário: o mobile da posição não muda', () => {
  it('as 5 posições vendáveis declaram 320x100 e 300x250; as 4 sem dimensão não declaram mobile', () => {
    for (const p of POSITIONS) {
      if (p.desktop) expect(p.mobile).toEqual(['320x100', '300x250']); else expect(p.mobile).toEqual([]);
    }
  });
});
