import { describe, expect, it } from 'vitest';
import {
  AdServer, POSITIONS, adPlan, createCommercialState, isRealCreative, isSafeDestination, makeCtx,
  resolveClickDestination, toPublicAd, validateCreative, snapshotState, loadState,
  type Creative, type CreativeIssueCode,
} from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-12-05T12:00:00-03:00';
const base = (over: Partial<Creative> = {}): Creative => ({
  id: 'c1', campaignId: 'k1', positionId: 'TOP', weight: 1, startDate: '2026-12-01', endDate: '2027-02-28', approved: true, campaignActive: true, ...realContent('TOP'), ...over,
});
const codes = (c: Creative): CreativeIssueCode[] => validateCreative(c).map((i) => i.code);

describe('validação do criativo contra a posição', () => {
  it('criativo completo e na especificação não tem problemas', () => {
    for (const id of ['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER']) expect(validateCreative(base({ positionId: id, ...realContent(id) }))).toEqual([]);
  });
  it('cada violação gera o seu código (e todas aparecem juntas)', () => {
    const asset = realContent('TOP').asset;
    expect(codes(base({ positionId: 'NOPE' }))).toEqual(['POSITION_UNKNOWN']);
    expect(codes(base({ asset: undefined }))).toEqual(['NO_ASSET']);
    expect(codes(base({ asset: { ...asset, mime: 'text/html' as never } }))).toContain('BAD_MIME');
    expect(codes(base({ asset: { ...asset, mime: 'image/gif' } }))).toEqual([]); // GIF é aceito
    expect(codes(base({ asset: { ...asset, width: 1280, height: 151 } }))).toEqual(['BAD_DIMENSIONS']);
    // variantes mobile da posição (320x100, 300x250) são criativos válidos (servem só ao mobile; ver device.test.ts); outras dimensões seguem recusadas
    expect(codes(base({ asset: { ...asset, width: 320, height: 100 } }))).toEqual([]);
    expect(codes(base({ asset: { ...asset, width: 300, height: 250 } }))).toEqual([]);
    expect(codes(base({ asset: { ...asset, width: 320, height: 101 } }))).toEqual(['BAD_DIMENSIONS']);
    expect(codes(base({ asset: { ...asset, width: 336, height: 280 } }))).toEqual(['BAD_DIMENSIONS']); // dimensão desktop de OUTRA posição
    expect(codes(base({ asset: { ...asset, sizeKB: 201 } }))).toEqual(['TOO_HEAVY']);
    expect(codes(base({ asset: { ...asset, sizeKB: 0 } }))).toEqual(['TOO_HEAVY']);
    expect(codes(base({ altText: '   ' }))).toEqual(['NO_ALT']);
    expect(codes(base({ altText: 'x'.repeat(201) }))).toEqual(['NO_ALT']);
    expect(codes(base({ advertiserName: '' }))).toEqual(['NO_ADVERTISER']);
    expect(codes(base({ destinationUrl: undefined }))).toEqual(['NO_DESTINATION']);
    expect(codes(base({ asset: { ...asset, sha256: undefined as unknown as string } }))).toEqual(['NO_HASH']);
    expect(codes(base({ asset: { ...asset, sha256: 'ABC' } }))).toEqual(['NO_HASH']);
    expect(codes(base({ asset: { ...asset, sha256: 'A'.repeat(64) } }))).toEqual(['NO_HASH']); // hex em maiúsculas não vale
    const tudo = codes(base({ asset: undefined, altText: '', advertiserName: undefined, destinationUrl: 'http://x.example' }));
    expect(tudo).toEqual(['NO_ASSET', 'NO_ALT', 'NO_ADVERTISER', 'BAD_DESTINATION']);
  });
  it('peso máximo depende da posição (sidebar 150 KB, topo 200 KB)', () => {
    expect(codes(base({ positionId: 'SIDEBAR_1', ...realContent('SIDEBAR_1', { asset: { ...realContent('SIDEBAR_1').asset, sizeKB: 151 } }) }))).toEqual(['TOO_HEAVY']);
    expect(codes(base({ asset: { ...realContent('TOP').asset, sizeKB: 200 } }))).toEqual([]);
  });
  it('posições sem dimensão/limite configurados nunca têm criativo válido', () => {
    for (const id of ['ARTICLE_INLINE', 'HOME_BETWEEN', 'AGENDA', 'DATA']) {
      expect(codes(base({ positionId: id }))).toContain('POSITION_NOT_CONFIGURED');
      expect(isRealCreative(base({ positionId: id }))).toBe(false);
    }
  });
  it('destino: só https, sem credenciais, sem esquemas perigosos, com tamanho limitado', () => {
    for (const ok of ['https://a.example', 'https://a.example/x?y=1#z']) expect(isSafeDestination(ok)).toBe(true);
    for (const bad of ['http://a.example', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@a.example', 'https://', '//a.example', 'ftp://a.example', 'not a url', 'https://a.example/' + 'x'.repeat(2000)]) expect(isSafeDestination(bad)).toBe(false);
  });
});

describe('só criativo real é servido', () => {
  const serve = (s: AdServer, pv: string, pos = 'TOP') => s.serve({ positionId: pos, today: '2026-12-05', pageViewId: pv, nowMs: Date.parse(NOW) });
  it('sem arquivo/alt/anunciante/destino: não serve (house, sem anúncio)', () => {
    for (const broken of [{ asset: undefined }, { altText: '' }, { advertiserName: undefined }, { destinationUrl: undefined }, { destinationUrl: 'http://x.example' }]) {
      const s = new AdServer(); s.addCreative(base(broken as Partial<Creative>));
      const r = serve(s, 'p');
      expect(r.kind).toBe('house'); expect(r.ad).toBeUndefined(); expect(s.delivery('c1').served).toBe(0);
    }
  });
  it('criativo real: serve, conta e devolve a visão pública', () => {
    const s = new AdServer(); s.addCreative(base());
    const r = serve(s, 'p');
    expect(r).toMatchObject({ kind: 'creative', counted: true });
    expect(r.ad).toMatchObject({ positionId: 'TOP', creativeId: 'c1', label: 'Publicidade', advertiser: 'Anunciante Teste', alt: 'Anúncio de teste', width: 1280, height: 150, impressionId: r.impressionId });
    expect(r.ad!.href).toBe(`/api/commercial/ads/click?ref=${encodeURIComponent(r.impressionId!)}`);
    expect(r.ad!.imageSrc).toBe('/api/commercial/ads/creative-image?id=c1&v=abababab');
  });
  it('a visão pública NÃO vaza campo interno (campanha, conta, peso, aprovação, chave do arquivo, destino)', () => {
    const s = new AdServer(); s.addCreative(base({ asset: { ...realContent('TOP').asset, sha256: 'a'.repeat(64) } }));
    const ad = serve(s, 'p').ad!;
    expect(Object.keys(ad).sort()).toEqual(['advertiser', 'alt', 'creativeId', 'height', 'href', 'imageSrc', 'impressionId', 'label', 'positionId', 'width']);
    const json = JSON.stringify(ad);
    for (const secret of ['k1', 'campaign', 'weight', 'approved', 'ads/teste', 'anunciante.example/oferta', 'a'.repeat(64)]) expect(json).not.toContain(secret);
    expect(ad.imageSrc).toContain('v=aaaaaaaa'); // só o prefixo do hash, para cache
  });
  it('refresh devolve o mesmo anúncio sem contar; suspensão por perda de dedupe serve sem contar e com href sem impressão', () => {
    const s = new AdServer(); s.addCreative(base());
    const r1 = serve(s, 'p'); const r2 = serve(s, 'p');
    expect(r2).toMatchObject({ counted: false, reason: 'refresh' }); expect(r2.ad!.href).toBe(r1.ad!.href);
    s.audit.reportLoss({ detectedAtMs: Date.parse(NOW), reason: 'dedupe_perdido' });
    const r3 = serve(s, 'novo');
    expect(r3).toMatchObject({ counted: false, reason: 'dedupe_suspenso' }); expect(r3.ad!.impressionId).toBeNull(); expect(r3.ad!.href).toContain(encodeURIComponent('c:c1'));
  });
  it('publicAdFor monta o anúncio do vencedor da corrida (Backend) e devolve null para criativo inválido ou inexistente', () => {
    const s = new AdServer(); s.addCreative(base()); s.addCreative(base({ id: 'c2', altText: '' }));
    expect(s.publicAdFor('c1', 'imp-x')!.href).toContain('imp-x');
    expect(s.publicAdFor('c2', null)).toBeNull(); expect(s.publicAdFor('nope', null)).toBeNull();
  });
  it('URLs são injetáveis', () => {
    const ad = toPublicAd(base(), 'i1', { image: (id) => `/img/${id}`, click: (r) => `/go/${r}` })!;
    expect([ad.imageSrc, ad.href]).toEqual(['/img/c1', '/go/i1']);
  });
  it('snapshot do AdServer guarda o conteúdo do criativo e ele continua válido depois de carregar', () => {
    const s = new AdServer(); s.addCreative(base({ asset: { ...realContent('TOP').asset, sha256: 'b'.repeat(64) } }));
    const t = new AdServer(); t.load(JSON.parse(JSON.stringify(s.snapshot())));
    expect(t.listCreatives()[0]!.asset).toMatchObject({ width: 1280, height: 150, sha256: 'b'.repeat(64) });
    expect(serve(t, 'p').ad).toBeDefined();
  });
});

describe('plano das posições (o que o portal renderiza ou oculta)', () => {
  it('sem criativo: todas as posições ocultas, sem dimensão', () => {
    const plan = adPlan([], '2026-12-05');
    expect(plan).toHaveLength(POSITIONS.length);
    expect(plan.every((s) => !s.available && s.width === null && s.height === null)).toBe(true);
  });
  it('com criativo real elegível: só aquela posição aparece, com a dimensão reservada', () => {
    const plan = adPlan([base(), base({ id: 'c2', positionId: 'FOOTER', ...realContent('FOOTER') })], '2026-12-05');
    expect(plan.filter((s) => s.available).map((s) => [s.positionId, s.width, s.height])).toEqual([['TOP', 1280, 150], ['FOOTER', 1280, 200]]);
  });
  it('criativo não aprovado, de campanha inativa, fora do período ou inválido não conta', () => {
    for (const c of [base({ approved: false }), base({ campaignActive: false }), base({ startDate: '2026-12-06' }), base({ endDate: '2026-12-04' }), base({ altText: '' }), base({ positionId: 'AGENDA' })]) {
      expect(adPlan([c], '2026-12-05', [c.positionId]).every((s) => !s.available)).toBe(true);
    }
  });
  it('não registra impressão: criativos e contadores ficam intactos', () => {
    const s = new AdServer(); s.addCreative(base());
    adPlan(s.listCreatives(), '2026-12-05');
    expect(s.delivery('c1').served).toBe(0); expect(s.ledger.size).toBe(0);
  });
});

describe('clique e imagem: destino e arquivo só do criativo cadastrado', () => {
  const list = [base()];
  const ofImp = (id: string) => (id === 'imp-1' ? 'c1' : undefined);
  it('por impressão ou por criativo; desconhecido, URL do cliente e criativo inválido => null', () => {
    expect(resolveClickDestination('imp-1', list, ofImp)).toEqual({ creativeId: 'c1', destination: 'https://anunciante.example/oferta', impressionId: 'imp-1' });
    expect(resolveClickDestination('c:c1', list, ofImp)).toEqual({ creativeId: 'c1', destination: 'https://anunciante.example/oferta', impressionId: null });
    for (const ref of ['imp-9', 'c:nope', 'https://evil.example', '//evil.example', 'c:', '']) expect(resolveClickDestination(ref, list, ofImp)).toBeNull();
    expect(resolveClickDestination('c:c1', [base({ approved: false })], ofImp)).toBeNull();
    expect(resolveClickDestination('c:c1', [base({ destinationUrl: 'http://x.example' })], ofImp)).toBeNull();
  });
});

describe('handlers públicos do anúncio', () => {
  function live(flags: object = { adServerVendas: true }) {
    const state = createCommercialState();
    state.ads.addCreative(base());
    return { state, ctx: makeCtx(state, { now: NOW, today: '2026-12-05', flags }) };
  }
  it('plano: query "TOP,FOOTER" e posição inválida', () => {
    const { ctx } = live();
    const r = h.getAdPlan(ctx, { positions: 'TOP,FOOTER' });
    expect(r.status).toBe(200);
    expect((r.body as { slots: { positionId: string; available: boolean }[] }).slots.map((s) => [s.positionId, s.available])).toEqual([['TOP', true], ['FOOTER', false]]);
    expect(h.getAdPlan(ctx, { positions: 'TOP,NOPE' }).status).toBe(400);
    expect((h.getAdPlan(ctx, {}).body as { slots: unknown[] }).slots).toHaveLength(9);
  });
  it('flag adServerVendas desligada: plano oculta tudo; clique e imagem dão 404', () => {
    const { ctx } = live({});
    expect((h.getAdPlan(ctx, {}).body as { slots: { available: boolean }[] }).slots.every((s) => !s.available)).toBe(true);
    expect(h.resolveAdClick(ctx, { ref: 'c:c1' }).status).toBe(404);
    expect(h.resolveCreativeImage(ctx, { id: 'c1' }).status).toBe(404);
  });
  it('clique: resolve o destino do criativo; criativo de campanha pausada, desconhecido ou inválido => 404', () => {
    const { state, ctx } = live();
    expect(h.resolveAdClick(ctx, { ref: 'c:c1' }).body).toMatchObject({ destination: 'https://anunciante.example/oferta' });
    expect(h.resolveAdClick(ctx, { ref: 'https://evil.example' }).status).toBe(404);
    expect(h.resolveAdClick(ctx, { ref: '' }).status).toBe(400);
    state.ads.setCreative('c1', { campaignActive: false });
    expect(h.resolveAdClick(ctx, { ref: 'c:c1' }).status).toBe(404);
  });
  it('imagem: só criativo real, aprovado, ativo e no período; devolve a chave do arquivo, nunca o destino', () => {
    const { state, ctx } = live();
    const ok = h.resolveCreativeImage(ctx, { id: 'c1' });
    expect(ok.body).toEqual({ key: 'ads/teste/TOP.png', mime: 'image/png', sizeKB: 50, sha256: 'ab'.repeat(32) });
    for (const patch of [{ approved: false }, { campaignActive: false }, { endDate: '2026-12-04' }, { altText: '' }, { asset: undefined }]) {
      state.ads.setCreative('c1', { approved: true, campaignActive: true, endDate: '2027-02-28', ...realContent('TOP'), ...patch } as Partial<Creative>);
      expect(h.resolveCreativeImage(ctx, { id: 'c1' }).status).toBe(404);
    }
    expect(h.resolveCreativeImage(ctx, { id: 'nope' }).status).toBe(404);
  });
  it('rotas públicas novas estão na tabela, com a autenticação certa', () => {
    const find = (p: string) => h.ROUTES.find((r) => r.path === p);
    for (const p of ['/api/commercial/ads/plan', '/api/commercial/ads/click', '/api/commercial/ads/creative-image']) expect(find(p)).toMatchObject({ method: 'GET', auth: 'public' });
    expect(find('/api/commercial/studio/creatives/content')).toMatchObject({ method: 'POST', auth: 'studio' });
  });
});

describe('Studio: aprovar exige criativo real', () => {
  // o proprietário (admin): é quem aprova imagem e campanha (DP-43)
  const studio = { id: 'u', canManageCommercial: true, canApprove: true };
  function setup() {
    const state = createCommercialState();
    const acc = state.crm.createAccount('Acme Fidelidade', NOW);
    const camp = state.campaigns.create({ name: 'Rodapé', accountId: acc.id, formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    return { state, camp, ctx: makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true }, actor: studio }) };
  }
  it('criar sem arquivo mostra o que falta; aprovar recusa com a lista (422); com tudo, aprova', () => {
    const { ctx, camp } = setup();
    const r = h.addCreative(ctx, { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' });
    const body = r.body as { id: string; approved: boolean; issues: { code: string }[] };
    expect(body.approved).toBe(false);
    expect(body.issues.map((i) => i.code)).toEqual(['NO_ASSET', 'NO_ALT', 'NO_DESTINATION']); // anunciante vem do nome da conta
    const bad = h.approveCreative(ctx, { creativeId: body.id });
    expect(bad.status).toBe(422);
    expect((bad.body as { error: { code: string; details: { code: string }[] } }).error.code).toBe('CREATIVE_INVALID');
    expect((bad.body as { error: { details: unknown[] } }).error.details).toHaveLength(3);
    const fix = h.setCreativeContent(ctx, { creativeId: body.id, ...realContent('FOOTER') });
    expect((fix.body as { issues: unknown[] }).issues).toEqual([]);
    expect(h.approveCreative(ctx, { creativeId: body.id }).status).toBe(200);
  });
  it('o anunciante exibido é o nome da conta da campanha; dimensão errada é recusada na aprovação', () => {
    const { ctx, camp, state } = setup();
    const id = (h.addCreative(ctx, { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER'), advertiserName: undefined }).body as { id: string }).id;
    expect(state.ads.listCreatives()[0]!.advertiserName).toBe('Acme Fidelidade');
    h.setCreativeContent(ctx, { creativeId: id, asset: { ...realContent('FOOTER').asset, height: 100 } });
    const r = h.approveCreative(ctx, { creativeId: id });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain('BAD_DIMENSIONS');
  });
  it('qualquer alteração de conteúdo revoga a aprovação', () => {
    const { ctx, camp, state } = setup();
    const id = (h.addCreative(ctx, { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER') }).body as { id: string }).id;
    h.approveCreative(ctx, { creativeId: id });
    expect(state.ads.listCreatives()[0]!.approved).toBe(true);
    h.setCreativeContent(ctx, { creativeId: id, altText: 'Texto novo' });
    expect(state.ads.listCreatives()[0]!.approved).toBe(false);
    expect(h.setCreativeContent(ctx, { creativeId: 'nope', altText: 'x' }).status).toBe(404);
  });
  it('o arquivo precisa chegar com o hash sha256 (calculado no servidor): sem hash, 400 e nada é gravado', () => {
    const { ctx, camp, state } = setup();
    const { sha256: _omit, ...semHash } = realContent('FOOTER').asset; void _omit;
    expect(h.addCreative(ctx, { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER'), asset: semHash }).status).toBe(400);
    expect(state.ads.listCreatives()).toHaveLength(0);
    const id = (h.addCreative(ctx, { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }).body as { id: string }).id;
    expect(h.setCreativeContent(ctx, { creativeId: id, asset: { ...semHash, sha256: 'xyz' } }).status).toBe(400);
    expect(h.setCreativeContent(ctx, { creativeId: id, ...realContent('FOOTER') }).status).toBe(200);
  });
  it('sem sessão do Studio: 401 nas três ações de criativo', () => {
    const { state } = setup();
    const anon = makeCtx(state, { now: NOW, flags: {} });
    for (const call of [() => h.addCreative(anon, {}), () => h.setCreativeContent(anon, {}), () => h.approveCreative(anon, {})]) expect(call().status).toBe(401);
  });
});

describe('portal em modo api, de ponta a ponta (domínio + handlers)', () => {
  // o proprietário (admin): é quem aprova imagem e campanha (DP-43)
  const studio = { id: 'u', canManageCommercial: true, canApprove: true };
  it('sem criativo tudo fica oculto; com criativo real a posição aparece, conta, clica e some quando a campanha pausa', () => {
    const state = createCommercialState();
    const on = (actor?: typeof studio) => makeCtx(state, { now: NOW, today: '2026-12-05', flags: { adServerVendas: true }, actor });
    const hidden = (h.getAdPlan(on(), {}).body as { slots: { available: boolean }[] }).slots;
    expect(hidden.every((s) => !s.available)).toBe(true);
    expect(h.serveAd(on(), { positionId: 'TOP', pageViewId: 'p0' }).body).toMatchObject({ kind: 'house' });

    const acc = state.crm.createAccount('Acme Fidelidade', NOW);
    const camp = state.campaigns.create({ name: 'Topo', accountId: acc.id, formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    const res = state.inventory.reserve({ positionId: 'FOOTER', advertiserId: acc.id, campaignId: camp.id, startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' });
    state.campaigns.transition(camp.id, 'reserved', NOW, { reservations: [res] }); state.campaigns.transition(camp.id, 'approved', NOW);
    const cid = (h.addCreative(on(studio), { campaignId: camp.id, positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31', ...realContent('FOOTER') }).body as { id: string }).id;
    expect((h.getAdPlan(on(), { positions: 'FOOTER' }).body as { slots: { available: boolean }[] }).slots[0]!.available).toBe(false); // aprovado mas campanha ainda não ativa
    h.approveCreative(on(studio), { creativeId: cid });
    state.campaigns.transition(camp.id, 'active', NOW, { activation: { saleEnabled: true, formatStatus: 'disponivel', reservations: [res], approvedCreativeCount: 1, creativePositions: ['FOOTER'] } });
    state.ads.setCreative(cid, { campaignActive: true });

    const plan = (h.getAdPlan(on(), { positions: 'TOP,FOOTER' }).body as { slots: { positionId: string; available: boolean; width: number | null }[] }).slots;
    expect(plan).toEqual([{ positionId: 'TOP', available: false, width: null, height: null, mobile: [] }, { positionId: 'FOOTER', available: true, width: 1280, height: 200, mobile: [] }]);

    const served = h.serveAd(on(), { positionId: 'FOOTER', pageViewId: 'p1' }).body as { kind: string; impressionId: string; ad: { href: string; label: string; width: number } };
    expect(served.kind).toBe('creative'); expect(served.ad).toMatchObject({ label: 'Publicidade', width: 1280 });
    expect(h.recordAdEvent(on(), { impressionId: served.impressionId, event: 'visible' }).body).toEqual({ counted: true });
    const click = h.resolveAdClick(on(), { ref: served.impressionId }).body as { destination: string; impressionId: string };
    expect(click).toMatchObject({ destination: 'https://anunciante.example/oferta', impressionId: served.impressionId });
    expect(h.recordAdEvent(on(), { impressionId: click.impressionId, event: 'click' }).body).toEqual({ counted: true });
    expect(state.ads.campaignDelivery(camp.id)).toMatchObject({ served: 1, visible: 1, clicks: 1 });

    // pausa: a posição some, o serve vira house e o clique deixa de resolver
    state.campaigns.transition(camp.id, 'paused', NOW);
    state.ads.setCreative(cid, { campaignActive: false });
    expect((h.getAdPlan(on(), { positions: 'FOOTER' }).body as { slots: { available: boolean }[] }).slots[0]!.available).toBe(false);
    expect(h.serveAd(on(), { positionId: 'FOOTER', pageViewId: 'p2' }).body).toMatchObject({ kind: 'house' });
    expect(h.resolveAdClick(on(), { ref: served.impressionId }).status).toBe(404);

    // o estado inteiro sobrevive a snapshot/load e continua servindo o mesmo criativo
    const copy = createCommercialState();
    loadState(copy, JSON.parse(JSON.stringify(snapshotState(state))));
    expect(copy.ads.listCreatives()[0]!.asset).toBeDefined();
  });
});
