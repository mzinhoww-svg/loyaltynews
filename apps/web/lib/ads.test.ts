import { describe, expect, it, vi } from 'vitest';
import {
  AD_POSITION_OF, fetchAdPlan, parseAdPlan, parseServeAd, safeAdUrl, trackVisible, type VisibleTrackerEnv,
} from '../app/(portal)/_lib/ads';

// Formatos do @ln/commercial (ft/commercial 2b26b64): GET /api/commercial/ads/plan e POST /api/commercial/ads/serve.
const plan = (slots: unknown[]) => ({ today: '2026-11-23', slots });
const ad = (over: Record<string, unknown> = {}) => ({
  positionId: 'TOP', creativeId: 'cr-1', label: 'Publicidade', advertiser: 'Anunciante de teste (MOCK)',
  imageSrc: '/api/commercial/ads/creative-image?id=cr-1', alt: 'Banner de teste (MOCK)', width: 1280, height: 150,
  href: '/api/commercial/ads/click?ref=imp-1', impressionId: 'imp-1', ...over,
});
const served = (over: Record<string, unknown> = {}) => ({ kind: 'creative', creativeId: 'cr-1', impressionId: 'imp-1', counted: true, ad: ad(over) });

describe('plano das posições', () => {
  it('só entram posições disponíveis, com dimensão válida e id conhecido', () => {
    const p = parseAdPlan(plan([
      { positionId: 'TOP', available: true, width: 1280, height: 150 },
      { positionId: 'SIDEBAR_1', available: false, width: null, height: null },
      { positionId: 'FOOTER', available: true, width: 1280, height: 200 },
      { positionId: 'OUTRA', available: true, width: 10, height: 10 },
      { positionId: 'SIDEBAR_2', available: true, width: 0, height: 280 },
      { positionId: 'SIDEBAR_3', available: 'sim', width: 336, height: 280 },
      null,
    ]));
    expect([...p.keys()]).toEqual(['TOP', 'FOOTER']);
    expect(p.get('TOP')).toEqual({ positionId: 'TOP', width: 1280, height: 150, desktop: true, mobile: null });
  });
  it('mobile aditivo do plano: formatos válidos entram; só-mobile vira desktop:false; [] = nenhum; sem o campo = null (API antiga)', () => {
    const p = parseAdPlan(plan([
      { positionId: 'TOP', available: true, width: 1280, height: 150, mobile: [{ width: 320, height: 100 }, { width: 300, height: 250 }, { width: 0, height: 5 }, 'x', null] },
      { positionId: 'SIDEBAR_1', available: false, width: null, height: null, mobile: [{ width: 300, height: 250 }] },
      { positionId: 'SIDEBAR_2', available: true, width: 336, height: 280, mobile: [] },
      { positionId: 'FOOTER', available: true, width: 1280, height: 200 },
      { positionId: 'SIDEBAR_3', available: false, width: null, height: null, mobile: [] },
      { positionId: 'HOME_BETWEEN', available: true, width: 1280, height: 150, mobile: 'x' },
    ]));
    expect(p.get('TOP')).toEqual({ positionId: 'TOP', width: 1280, height: 150, desktop: true, mobile: [{ width: 320, height: 100 }, { width: 300, height: 250 }] });
    expect(p.get('SIDEBAR_1')).toEqual({ positionId: 'SIDEBAR_1', width: 300, height: 250, desktop: false, mobile: [{ width: 300, height: 250 }] });
    expect(p.get('SIDEBAR_2')?.mobile).toEqual([]);
    expect(p.get('FOOTER')?.mobile).toBeNull();
    expect(p.has('SIDEBAR_3')).toBe(false); // nem desktop nem mobile
    expect(p.get('HOME_BETWEEN')?.mobile).toBeNull();
  });
  it('formato inesperado = nenhuma posição (nunca lança)', () => {
    for (const j of [null, 'x', {}, { slots: 'x' }, [], { slots: [{}] }]) expect(parseAdPlan(j).size).toBe(0);
  });
  it('mapa do portal: entre-secoes e in-article usam as posições ainda sem inventário', () => {
    expect(AD_POSITION_OF).toMatchObject({ topo: 'TOP', 'sidebar-1': 'SIDEBAR_1', 'sidebar-2': 'SIDEBAR_2', 'sidebar-3': 'SIDEBAR_3', rodape: 'FOOTER', 'entre-secoes': 'HOME_BETWEEN', 'in-article': 'ARTICLE_INLINE' });
  });
  it('fetchAdPlan: pede todas as posições numa chamada cacheável; falha de rede, status ou JSON = plano vazio', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify(plan([{ positionId: 'TOP', available: true, width: 1280, height: 150 }])), { status: 200 }));
    const p = await fetchAdPlan('http://api.test/', f as unknown as typeof fetch);
    expect(p.has('TOP')).toBe(true);
    expect(String(f.mock.calls[0]![0])).toBe('http://api.test/api/commercial/ads/plan?positions=TOP,SIDEBAR_1,SIDEBAR_2,SIDEBAR_3,FOOTER,HOME_BETWEEN,ARTICLE_INLINE');
    expect((f.mock.calls[0]![1] as { next?: unknown }).next).toEqual({ revalidate: 60 });
    for (const bad of [
      async () => { throw new TypeError('fetch failed'); },
      async () => new Response('{}', { status: 503 }),
      async () => new Response('<html>', { status: 200 }),
    ]) expect((await fetchAdPlan('http://api.test', bad as unknown as typeof fetch)).size).toBe(0);
  });
});

describe('resposta do serve', () => {
  it('criativo real vira anúncio com rótulo Publicidade, anunciante e links do próprio portal', () => {
    const a = parseServeAd(served());
    expect(a).toMatchObject({ label: 'Publicidade', advertiser: 'Anunciante de teste (MOCK)', width: 1280, height: 150, impressionId: 'imp-1', href: '/api/commercial/ads/click?ref=imp-1' });
  });
  it('sem `ad` (house, ignored, erro) colapsa a posição', () => {
    for (const j of [{ kind: 'house', creativeId: null, impressionId: null, counted: false }, { kind: 'ignored' }, { kind: 'creative' }, null, 'x', { error: 'x' }]) expect(parseServeAd(j)).toBeNull();
  });
  it('impressionId nulo é aceito (impressão não contada), mas sem evento depois', () => {
    expect(parseServeAd(served({ impressionId: null }))!.impressionId).toBeNull();
  });
  it('campos fora do formato derrubam o anúncio: sem anunciante, sem alt, dimensão inválida, URL perigosa', () => {
    for (const over of [{ advertiser: '' }, { alt: ' ' }, { width: 0 }, { height: 'x' }, { imageSrc: 'javascript:alert(1)' }, { href: 'data:text/html,x' }, { imageSrc: '//evil.example/x.png' }, { href: '/x"onload="1' }]) {
      expect(parseServeAd(served(over)), JSON.stringify(over)).toBeNull();
    }
  });
  it('safeAdUrl: caminho do portal ou http(s) normalizado', () => {
    expect(safeAdUrl('/api/commercial/ads/click?ref=a%2Fb')).toBe('/api/commercial/ads/click?ref=a%2Fb');
    expect(safeAdUrl('https://cdn.example/b.png')).toBe('https://cdn.example/b.png');
    for (const v of ['javascript:1', '//x.example', 'mailto:a@b', '', 'sem-barra', '/a\\b']) expect(safeAdUrl(v), v).toBeNull();
  });
});

describe('visível: ≥ 50 % da área por ≥ 1 s, uma vez', () => {
  function env() {
    let cb: (r: number) => void = () => {};
    const timers = new Map<number, { fn: () => void; ms: number }>();
    let n = 0;
    let pageVisible = true;
    const e: VisibleTrackerEnv = {
      observe(_el, onRatio) { cb = onRatio; return () => { cb = () => {}; }; },
      setTimeout(fn, ms) { timers.set(++n, { fn, ms }); return n; },
      clearTimeout(id) { timers.delete(id as number); },
      pageVisible: () => pageVisible,
    };
    return { e, ratio: (r: number) => cb(r), fire: () => { const t = [...timers.entries()][0]; if (t) { timers.delete(t[0]); t[1].fn(); } }, pending: () => timers.size, hide: () => { pageVisible = false; } };
  }
  const el = {} as Element;

  it('dispara uma vez depois de 1 s com ≥ 50 %', () => {
    const t = env(); const on = vi.fn();
    trackVisible(el, on, t.e);
    t.ratio(0.4); expect(t.pending()).toBe(0);
    t.ratio(0.6); expect(t.pending()).toBe(1);
    t.fire(); expect(on).toHaveBeenCalledTimes(1);
    t.ratio(1); t.fire(); expect(on).toHaveBeenCalledTimes(1);
  });
  it('sair da área antes de 1 s cancela; voltar recomeça a contagem', () => {
    const t = env(); const on = vi.fn();
    trackVisible(el, on, t.e);
    t.ratio(0.9); t.ratio(0.2); expect(t.pending()).toBe(0);
    t.ratio(0.9); t.fire(); expect(on).toHaveBeenCalledTimes(1);
  });
  it('1000 ms; aba escondida não conta; cancelar o rastreio desarma tudo', () => {
    const t = env(); const on = vi.fn();
    const stop = trackVisible(el, on, t.e);
    t.ratio(0.7); t.hide(); t.fire(); expect(on).not.toHaveBeenCalled();
    const t2 = env(); const on2 = vi.fn();
    const stop2 = trackVisible(el, on2, t2.e);
    t2.ratio(0.7); stop2(); t2.fire(); expect(on2).not.toHaveBeenCalled();
    stop();
  });
});
