import RedisMock from 'ioredis-mock';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { adKeys, readCounters, type AdRedis } from '@ln/workers/ad-redis';
import { HB_KEY, heartbeatOnce, type HeartbeatRedis } from '@ln/workers/ad-redis-watch';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { GAP_CACHE_MS, resetGapCache } from '../_lib/commercial/gaps';
import { GAP_RECENT_DAYS, hydrate, seedCommercial } from '../_lib/commercial/repo';

// Lacunas de auditoria (perda de dedupe no Redis), LADO CONSUMIDOR: o monitor do Backend escreve em ad_delivery_gaps; aqui se prova que
// (a) os relatórios marcam o período como "não auditável", (b) /ads/serve e /ads/event suspendem a contagem enquanto a lacuna durar,
// sem inflar, e (c) o que deixou de contar é gravado na própria lacuna. Sem lacuna, nada muda (os outros testes de ads cobrem isso).
const SHA = 'a'.repeat(64);
const ARQUIVO_TOP = {
  arquivoRef: `anuncios/${SHA}.png`, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 100, arquivoSha256: SHA,
  textoAlternativo: 'Oferta do anunciante teste', destinoUrl: 'https://anunciante.example/oferta',
} as const;

const T = Date.parse('2026-11-22T12:00:00Z'); // relógio do testkit
const DAY = '2026-11-22';
const min = (n: number) => new Date(T + n * 60_000);
const P = (p: string) => `/api/commercial${p}`;

let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Actor;
let redis: InstanceType<typeof RedisMock>;
const R = () => redis as unknown as AdRedis;
const serve = (pv: string) => call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'TOP', pageViewId: pv } });
const event = (impressionId: string, ev: 'visible' | 'click') => call(d, 'POST', { path: P('/ads/event'), body: { impressionId, event: ev } });
const relatorio = (campaignId = 'cmp-1') => call(d, 'GET', { path: P('/studio/campaigns/report'), query: { campaignId }, as: comercial });
const detalhe = (campaignId: string) => call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId }, as: comercial });
const anunciante = () => call(d, 'GET', { path: P('/studio/accounts/report'), query: { accountId: 'acc-1' }, as: comercial });
const painel = (from: string, to: string) => call(d, 'GET', { path: P('/studio/dashboard'), query: { from, to }, as: comercial });
const naoAuditaveis = (r: { body: any }) => (r.body.attention ?? []).filter((a: { kind: string }) => a.kind === 'periodo_nao_auditavel').map((a: { ref: string }) => a.ref).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
const velha = () => app.db.insert(schema.adDeliveryGaps).values({ id: 'gap-marco', reason: 'dedupe_perdido', from: new Date('2026-03-10T10:00:00Z'), servedUntil: new Date('2026-03-10T10:30:00Z'), to: new Date('2026-03-10T12:00:00Z'), detectedAt: new Date('2026-03-10T10:00:00Z'), uncountedServes: 7, ignoredEvents: 3 });
const dias = (n: number) => new Date(T - n * 86_400_000);
const gapAntiga = (id: string, atras: number) => app.db.insert(schema.adDeliveryGaps).values({ id, reason: 'dedupe_regrediu', from: dias(atras), servedUntil: new Date(dias(atras).getTime() + 1_800_000), to: new Date(dias(atras).getTime() + 7_200_000), detectedAt: dias(atras) });
const gap = (id: string, de: number, detectado: number, servidoAte: number, ate: number, extra: Record<string, unknown> = {}) =>
  app.db.insert(schema.adDeliveryGaps).values({ id, reason: 'dedupe_perdido', from: min(de), servedUntil: min(servidoAte), to: min(ate), detectedAt: min(detectado), ...extra });
const linha = async (id: string) => (await app.db.select().from(schema.adDeliveryGaps).where(eq(schema.adDeliveryGaps.id, id)))[0]!;

beforeAll(async () => {
  app = await makeApp({ adServerVendas: true });
  comercial = await app.actor('comercial');
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante Teste' });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-1', nome: 'Campanha', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active' });
  await app.db.insert(schema.adCreatives).values({ id: 'cr-1', campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true, ...ARQUIVO_TOP });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-old', nome: 'Campanha antiga', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-03-01', fim: '2026-04-30', status: 'completed' });
  await app.db.insert(schema.adDeliveryDaily).values({ id: 'cr-1@2026-11-20', criativoId: 'cr-1', dia: '2026-11-20', servidas: 10, visiveis: 6, cliques: 1, ignoradasBotInterno: 0, refreshSuprimido: 0, atualizadoEm: new Date('2026-11-20T20:00:00Z') });
}, 120_000);
beforeEach(async () => {
  redis = new RedisMock() as unknown as InstanceType<typeof RedisMock>;
  await redis.flushall();
  app.deps.redis = R();
  app.deps.flags.adServerVendas = true;
  await app.db.delete(schema.adDeliveryGaps);
  await app.db.delete(schema.adRedisWatermark); // espelho do monitor: cada teste começa sem histórico de batidas
  resetGapCache();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); });

describe('relatórios e painel: período não auditável', () => {
  it('sem lacuna: auditável', async () => {
    const r = await relatorio();
    expect(r.status).toBe(200);
    expect(r.body.auditability).toMatchObject({ auditable: true, lowerBound: false, note: null });
    expect(r.body.auditability.gaps).toEqual([]);
  });
  it('lacuna que toca o período da campanha: não auditável, com a lacuna, o aviso e o número como piso', async () => {
    await gap('gap-1', -15, -1, 29, 119, { uncountedServes: 4, ignoredEvents: 2 });
    const r = await relatorio();
    expect(r.body.auditability).toMatchObject({ auditable: false, lowerBound: true });
    expect(r.body.auditability.note).toMatch(/não auditável/i);
    expect(r.body.auditability.gaps).toHaveLength(1);
    expect(r.body.auditability.gaps[0]).toMatchObject({ id: 'gap-1', reason: 'dedupe_perdido', uncountedServes: 4, ignoredEvents: 2 });
    expect(r.body.estimated).toBe(false); // nunca estimado: o número continua sendo o contado
    expect(JSON.stringify(r.body.notes)).toMatch(/não auditável/i);
  });
  it('lacuna FORA do período da campanha não a torna não auditável', async () => {
    await app.db.insert(schema.adDeliveryGaps).values({ id: 'gap-antiga', reason: 'dedupe_regrediu', from: new Date('2026-03-01T10:00:00Z'), servedUntil: new Date('2026-03-01T10:30:00Z'), to: new Date('2026-03-01T12:00:00Z'), detectedAt: new Date('2026-03-01T10:00:00Z') });
    expect((await relatorio()).body.auditability).toMatchObject({ auditable: true });
  });
  it('hydrate carrega as lacunas no auditor do contexto, com todos os campos', async () => {
    await gap('gap-7', -15, -1, 29, 119, { uncountedServes: 3, ignoredEvents: 5 });
    const h = await hydrate(app.db, new Date(T), null);
    expect(h.state.ads.audit.list()).toEqual([{
      id: 'gap-7', reason: 'dedupe_perdido', from: min(-15).toISOString(), servedUntil: min(29).toISOString(), to: min(119).toISOString(),
      detectedAt: min(-1).toISOString(), uncountedServes: 3, ignoredEvents: 5,
    }]);
  });
});

describe('quais lacunas o hydrate carrega: as recentes e as do período pedido, nunca todas, nunca menos', () => {
  const ids = async (scope = {}) => (await hydrate(app.db, new Date(T), null, scope)).state.ads.audit.list().map((g) => g.id).sort();

  it('padrão: só as dos últimos GAP_RECENT_DAYS dias; a de março (mais de 30 dias) não é lida', async () => {
    expect(GAP_RECENT_DAYS).toBe(30);
    await velha();
    await gap('gap-recente', -15, -1, 29, 119);
    await gapAntiga('gap-20d', 20);
    await gapAntiga('gap-40d', 40);
    expect(await ids()).toEqual(['gap-20d', 'gap-recente']);
  });
  it('com a campanha pedida, entram também as que tocam o PERÍODO dela, por mais antigas que sejam', async () => {
    await velha();
    expect(await ids({ campaignId: 'cmp-old' })).toEqual(['gap-marco']);
    expect(await ids({ campaignId: 'cmp-1' })).toEqual([]); // a de março não toca o período de cmp-1 (nov-dez)
  });
  it('com a conta pedida, entram as de todas as campanhas dela', async () => {
    await velha(); await gap('gap-recente', -15, -1, 29, 119);
    expect(await ids({ accountId: 'acc-1' })).toEqual(['gap-marco', 'gap-recente']);
  });
  it('campanha ou conta desconhecida: só as recentes (sem erro)', async () => {
    await velha(); await gap('gap-recente', -15, -1, 29, 119);
    expect(await ids({ campaignId: 'nao-existe' })).toEqual(['gap-recente']);
    expect(await ids({ accountId: 'nao-existe' })).toEqual(['gap-recente']);
  });
  it('relatório da campanha ANTIGA: a lacuna de março (fora da janela recente) a marca como não auditável', async () => {
    await velha();
    const r = await relatorio('cmp-old');
    expect(r.status).toBe(200);
    expect(r.body.auditability).toMatchObject({ auditable: false, lowerBound: true });
    expect(r.body.auditability.gaps[0]).toMatchObject({ id: 'gap-marco', uncountedServes: 7, ignoredEvents: 3 });
    expect((await relatorio('cmp-1')).body.auditability).toMatchObject({ auditable: true }); // outra campanha: não é tocada
  });
  it('detalhe da campanha antiga e relatório do anunciante também enxergam a lacuna antiga', async () => {
    await velha();
    expect((await detalhe('cmp-old')).body.report.auditability).toMatchObject({ auditable: false });
    const a = await anunciante();
    expect(a.status).toBe(200);
    expect(a.body.auditability).toMatchObject({ auditable: false });
    expect(a.body.auditability.gaps.map((g: { id: string }) => g.id)).toContain('gap-marco');
  });
});

describe('painel com janela histórica (from/to): as lacunas antigas dessa janela também entram', () => {
  const ids = async (scope: { from?: string; to?: string }) => (await hydrate(app.db, new Date(T), null, scope)).state.ads.audit.list().map((g) => g.id).sort();

  it('janela de março: a lacuna de março aparece na lista de atenção; sem janela histórica, não', async () => {
    await velha(); await gap('gap-recente', -15, -1, 29, 119);
    const marco = await painel('2026-03-01', '2026-03-31');
    expect(marco.status).toBe(200);
    expect(naoAuditaveis(marco)).toEqual(['gap-marco', 'gap-recente']); // a recente sempre vem; a de março só pela janela
    expect(naoAuditaveis(await painel('2026-11-01', '2026-11-30'))).toEqual(['gap-recente']);
  });
  it('hydrate: só valem datas de calendário reais com from <= to; o resto é ignorado (sem erro e sem carregar tudo)', async () => {
    await velha();
    expect(await ids({ from: '2026-03-01', to: '2026-03-31' })).toEqual(['gap-marco']);
    expect(await ids({ from: '2026-03-31', to: '2026-03-01' })).toEqual([]); // invertida
    expect(await ids({ from: '2026-02-30', to: '2026-03-31' })).toEqual([]); // 30/02 não existe
    expect(await ids({ from: 'ontem', to: '2026-03-31' })).toEqual([]);
    expect(await ids({ from: '2026-03-01' })).toEqual([]); // só uma ponta
  });
  it('janela inválida na rota não derruba o painel (nada de data inválida indo ao banco)', async () => {
    await velha();
    const r = await painel('2026-02-30', '2026-03-31');
    expect(r.status).toBeLessThan(500);
    if (r.status === 200) expect(naoAuditaveis(r)).toEqual([]);
  });
});

describe('datas fora da faixa (mês 13, dia 32, mês 00): ignoradas, nunca 500', () => {
  const FORA = ['2026-13-01', '2026-01-32', '2026-00-10', '2026-12-00', '9999-99-99'];
  const ids = async (scope: { from?: string; to?: string }) => (await hydrate(app.db, new Date(T), null, scope)).state.ads.audit.list().map((g) => g.id).sort();

  it('hydrate não lança e não carrega além do recente, em qualquer das pontas', async () => {
    await velha();
    for (const ruim of FORA) {
      expect(await ids({ from: ruim, to: '2026-12-31' }), `from=${ruim}`).toEqual([]);
      expect(await ids({ from: '2026-03-01', to: ruim }), `to=${ruim}`).toEqual([]);
    }
  });
  it('painel com data fora da faixa: nunca 500 (a rota responde pelo próprio schema)', async () => {
    await velha();
    for (const ruim of FORA) {
      expect((await painel(ruim, '2026-12-31')).status, `from=${ruim}`).toBeLessThan(500);
      expect((await painel('2026-03-01', ruim)).status, `to=${ruim}`).toBeLessThan(500);
    }
  });
  it('relatório de campanha e do anunciante com janela fora da faixa: nunca 500 (leitura das linhas de entrega também)', async () => {
    for (const ruim of FORA) {
      const c = await call(d, 'GET', { path: P('/studio/campaigns/report'), query: { campaignId: 'cmp-1', from: ruim, to: '2026-12-31' }, as: comercial });
      expect(c.status, `campanha from=${ruim}`).toBeLessThan(500);
      const a = await call(d, 'GET', { path: P('/studio/accounts/report'), query: { accountId: 'acc-1', from: '2026-03-01', to: ruim }, as: comercial });
      expect(a.status, `anunciante to=${ruim}`).toBeLessThan(500);
    }
  });
  it('as datas boas continuam funcionando (mês 12, dia 31, 29/02 de ano bissexto não existe em 2026)', async () => {
    await velha();
    expect(await ids({ from: '2026-03-01', to: '2026-12-31' })).toEqual(['gap-marco']);
    expect((await painel('2026-03-01', '2026-12-31')).status).toBe(200);
  });
});

describe('a gravação dos contadores da lacuna deixa de ser silenciosa', () => {
  it('falha do banco ao somar: o serve segue (200, sem contar) e o erro vai ao log com o id da lacuna e o nome do erro, sem a mensagem do banco', async () => {
    await gap('gap-1', -15, -1, 29, 119);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const real = app.deps.db;
    app.deps.db = new Proxy(real, {
      get(alvo, prop) {
        if (prop === 'update') return () => { throw new Error('segredo-do-banco-123'); };
        const v = (alvo as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
      },
    }) as typeof real;
    let r;
    try { r = await serve('pv-log'); } finally { app.deps.db = real; }
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'creative', counted: false, reason: 'dedupe_suspenso' });
    const linhas = log.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[ads] lacuna'));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('gap-1');
    expect(linhas[0]).toContain('impressões 1');
    expect(linhas[0]).toContain('Error');
    expect(linhas[0]).not.toContain('segredo-do-banco-123'); // nunca a mensagem do banco
    expect((await linha('gap-1')).uncountedServes).toBe(0); // não gravou, e o log diz isso
  });
  it('sem falha, nada é logado', async () => {
    await gap('gap-1', -15, -1, 29, 119);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await serve('pv-sem-erro');
    expect(log.mock.calls.filter((c) => c.join(' ').includes('[ads] lacuna'))).toEqual([]);
    expect((await linha('gap-1')).uncountedServes).toBe(1);
  });
});

describe('/ads/serve e /ads/event com lacuna ativa: sub-conta, nunca infla', () => {
  it('lacuna ativa: serve o criativo (com o anúncio) mas NÃO conta, não grava no Redis e soma 1 em uncounted_serves', async () => {
    await gap('gap-1', -15, -1, 29, 119);
    const r = await serve('pv-gap');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'creative', creativeId: 'cr-1', counted: false, reason: 'dedupe_suspenso', impressionId: null, ad: { width: 1280, label: 'Publicidade' } });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({});
    expect(await redis.keys('ln:ad:*')).toEqual([]); // nem visualização nem impressão: nada que um visível/clique pudesse contar depois
    expect((await linha('gap-1')).uncountedServes).toBe(1);
    await serve('pv-gap-2'); await serve('pv-gap-3');
    expect((await linha('gap-1')).uncountedServes).toBe(3);
  });
  it('visível e clique de uma impressão anterior à lacuna: não contam e somam em ignored_events', async () => {
    const a = await serve('pv-antes');
    const imp = a.body.impressionId as string;
    expect(a.body.counted).toBe(true);
    await gap('gap-1', -15, -1, 29, 119);
    resetGapCache();
    const v = await event(imp, 'visible');
    expect(v.body).toEqual({ counted: false });
    expect((await event(imp, 'click')).body).toEqual({ counted: false });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({ s: 1 }); // nada de visível/clique somado
    expect((await linha('gap-1')).ignoredEvents).toBe(2);
    expect((await linha('gap-1')).uncountedServes).toBe(0);
  });
  it('as duas janelas: depois de servedUntil a impressão volta a contar, mas visível/clique seguem suspensos até `to`', async () => {
    await gap('gap-1', -60, -40, -10, 80); // impressão nova liberada há 10 min; eventos suspensos até +80
    const a = await serve('pv-janela');
    expect(a.body).toMatchObject({ kind: 'creative', counted: true });
    const ev = await event(a.body.impressionId, 'visible');
    expect(ev.body).toEqual({ counted: false });
    const g = await linha('gap-1');
    expect([g.uncountedServes, g.ignoredEvents]).toEqual([0, 1]);
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({ s: 1 });
  });
  it('lacuna vencida: tudo conta normalmente e os contadores dela não mudam', async () => {
    await gap('gap-velha', -300, -270, -240, -150);
    const a = await serve('pv-velha');
    expect(a.body).toMatchObject({ kind: 'creative', counted: true });
    expect((await event(a.body.impressionId, 'visible')).body).toEqual({ counted: true });
    const g = await linha('gap-velha');
    expect([g.uncountedServes, g.ignoredEvents]).toEqual([0, 0]);
  });
  it('bot e tráfego interno seguem sem contar também com lacuna ativa, sem somar nela (só conta o que o dedupe impediria)', async () => {
    await gap('gap-1', -15, -1, 29, 119);
    const r = await call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'TOP', pageViewId: 'pv-bot', isBot: true } });
    expect(r.body).toMatchObject({ kind: 'ignored', counted: false });
    expect((await linha('gap-1')).uncountedServes).toBe(0);
  });
  it('a lacuna nova passa a valer em até GAP_CACHE_MS (cache curto da rota pública)', async () => {
    expect((await serve('pv-c1')).body.counted).toBe(true); // enche o cache sem lacuna
    await gap('gap-1', -15, -1, 29, 119);
    expect((await serve('pv-c2')).body.counted).toBe(true); // ainda dentro da janela do cache: o limite conhecido
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + GAP_CACHE_MS + 1);
    const depois = await serve('pv-c3');
    expect(depois.body).toMatchObject({ counted: false, reason: 'dedupe_suspenso' });
  });
  it('sem lacuna nenhuma, o serve não muda: conta uma vez, refresh não infla', async () => {
    const a = await serve('pv-normal');
    expect(a.body).toMatchObject({ counted: true });
    expect((await serve('pv-normal')).body).toMatchObject({ counted: false, reason: 'refresh' });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({ s: 1, r: 1 });
    expect((await redis.keys('ln:ad:*')).includes(adKeys.view('pv-normal', 'TOP'))).toBe(true);
  });
});

describe('ponta a ponta com o monitor do Backend (heartbeat ln:ad:hb): perda detectada → suspende e marca, sem inflar', () => {
  const batida = (deMin: number) => heartbeatOnce(app.db as never, redis as unknown as HeartbeatRedis, { now: () => min(deMin) });

  it('Redis esvaziado: o monitor abre a lacuna, o serve suspende, o relatório fica não auditável, e o monitor não zera os contadores que o serve incrementa', async () => {
    expect((await batida(-3)).state).toBe('baseline');
    await redis.flushall(); // perda do Redis (reinício sem persistência, ADR-012)
    const perda = await batida(-1);
    expect(perda).toMatchObject({ state: 'loss', reason: 'dedupe_perdido', cause: 'chave_ausente' });
    resetGapCache();
    const r = await serve('pv-monitor');
    expect(r.body).toMatchObject({ kind: 'creative', counted: false, reason: 'dedupe_suspenso', impressionId: null });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({});
    const antes = await app.db.select().from(schema.adDeliveryGaps);
    expect(antes).toHaveLength(1);
    expect(antes[0]).toMatchObject({ reason: 'dedupe_perdido', uncountedServes: 1, ignoredEvents: 0 });
    expect((await batida(0)).state).toBe('healthy'); // o Redis voltou a bater; a lacuna continua valendo até as janelas acabarem
    expect((await app.db.select().from(schema.adDeliveryGaps))[0]).toMatchObject({ uncountedServes: 1 }); // contrato: o monitor nunca altera os contadores
    const rel = await relatorio();
    expect(rel.body.auditability).toMatchObject({ auditable: false, lowerBound: true });
    expect(rel.body.auditability.gaps[0]).toMatchObject({ reason: 'dedupe_perdido', uncountedServes: 1 });
  });

  it('Redis restaurado de um ponto antigo (valor menor que o espelho): lacuna dedupe_regrediu, mesma suspensão', async () => {
    await batida(-5); await batida(-4); // espelho = 2
    await redis.set(HB_KEY, '0');
    expect(await batida(-1)).toMatchObject({ state: 'loss', reason: 'dedupe_regrediu', cause: 'regrediu' });
    resetGapCache();
    expect((await serve('pv-regrediu')).body).toMatchObject({ counted: false, reason: 'dedupe_suspenso' });
    expect((await relatorio()).body.auditability.gaps[0]).toMatchObject({ reason: 'dedupe_regrediu' });
  });

  it('batidas saudáveis: nenhuma lacuna, o serve conta e o relatório segue auditável', async () => {
    await batida(-3); await batida(-2); await batida(-1);
    expect(await app.db.select().from(schema.adDeliveryGaps)).toEqual([]);
    expect((await serve('pv-saudavel')).body).toMatchObject({ counted: true });
    expect((await relatorio()).body.auditability).toMatchObject({ auditable: true });
  });
});
