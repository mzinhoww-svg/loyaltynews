/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import RedisMock from 'ioredis-mock';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { adKeys, flushAdDelivery, readCounters, type AdRedis } from '@ln/workers/ad-redis';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { seedCommercial } from '../_lib/commercial/repo';

let app: Awaited<ReturnType<typeof makeApp>>;
let redis: InstanceType<typeof RedisMock>;
const R = () => redis as unknown as AdRedis;
const DAY = '2026-11-22'; // relógio do testkit (12:00Z) em America/Sao_Paulo
const P = (p: string) => `/api/commercial${p}`;
const serve = (pv: string, extra: Record<string, unknown> = {}) =>
  call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'TOP', pageViewId: pv, ...extra } });
const event = (impressionId: string, ev: 'visible' | 'click') => call(d, 'POST', { path: P('/ads/event'), body: { impressionId, event: ev } });

beforeAll(async () => {
  app = await makeApp({ adServerVendas: true });
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante Teste' });
  await app.db.insert(schema.campaigns).values({
    id: 'cmp-1', nome: 'Campanha', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active',
  });
  await app.db.insert(schema.adCreatives).values({ id: 'cr-1', campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true });
}, 120_000);
beforeEach(async () => {
  redis = new RedisMock();
  await redis.flushall();
  app.deps.redis = R();
  app.deps.flags.adServerVendas = true;
});
afterAll(async () => {
  await app.close();
});

describe('ad server público sobre Redis', () => {
  it('flag desligada: house, sem tocar em Redis nem banco', async () => {
    app.deps.flags.adServerVendas = false;
    const r = await serve('pv-off');
    expect(r.body).toMatchObject({ kind: 'house', counted: false });
    expect(await redis.dbsize()).toBe(0);
  });

  it('primeira impressão conta; refresh da mesma visualização não infla; chaves só com ids opacos', async () => {
    const a = await serve('pv-1');
    expect(a.body).toMatchObject({ kind: 'creative', creativeId: 'cr-1', counted: true });
    expect(a.body.impressionId).toMatch(/^[0-9a-f-]{36}$/);
    const b = await serve('pv-1');
    expect(b.body).toMatchObject({ kind: 'creative', counted: false, reason: 'refresh', impressionId: a.body.impressionId });
    const c = await readCounters(R(), 'cr-1', DAY);
    expect(c).toEqual({ s: 1, r: 1 });
    const keys = await redis.keys('ln:ad:*');
    expect(keys.sort()).toEqual([adKeys.cnt('cr-1', DAY), adKeys.imp(a.body.impressionId), adKeys.view('pv-1', 'TOP')].sort());
    expect(JSON.stringify([await redis.get(adKeys.view('pv-1', 'TOP')), await redis.hgetall(adKeys.imp(a.body.impressionId))])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(await redis.ttl(adKeys.view('pv-1', 'TOP'))).toBeGreaterThan(0);
  });

  it('várias instâncias na mesma visualização (concorrência): exatamente uma impressão contada', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => serve('pv-race')));
    expect(rs.filter((r) => r.body.counted === true)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.body.impressionId).filter(Boolean)).size).toBe(1);
    const c = await readCounters(R(), 'cr-1', DAY);
    expect(c.s).toBe(1);
  });

  it('visível e clique contam uma vez por impressão, também entre instâncias; impressão desconhecida não conta', async () => {
    const a = await serve('pv-2');
    const id = a.body.impressionId as string;
    const vis = await Promise.all([event(id, 'visible'), event(id, 'visible'), event(id, 'visible')]);
    expect(vis.filter((r) => r.body.counted === true)).toHaveLength(1);
    expect((await event(id, 'click')).body.counted).toBe(true);
    expect((await event(id, 'click')).body.counted).toBe(false);
    expect((await event('imp-que-nao-existe', 'visible')).body).toEqual({ counted: false });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({ s: 1, v: 1, c: 1 });
    expect((await call(d, 'POST', { path: P('/ads/event'), body: { impressionId: id, event: 'x' } })).status).toBe(400);
  });

  it('bot e tráfego interno servem sem contar como entrega faturável', async () => {
    const r = await serve('pv-bot', { isBot: true });
    expect(r.body).toMatchObject({ kind: 'ignored', counted: false });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({ i: 1 });
  });

  it('sem Redis: serve o criativo mas NÃO conta (dedupe_indisponivel); nunca cai para memória', async () => {
    app.deps.redis = null;
    const r = await serve('pv-nr');
    expect(r.body).toMatchObject({ kind: 'creative', creativeId: 'cr-1', counted: false, reason: 'dedupe_indisponivel', impressionId: null });
    expect((await event('qualquer', 'visible')).body).toEqual({ counted: false });
  });

  it('Redis que falha no meio: sub-conta em vez de inflar', async () => {
    const broken = new Proxy(redis, { get: (t, p) => (p === 'get' ? async () => { throw new Error('ECONNRESET'); } : (t as any)[p]) });
    app.deps.redis = broken as unknown as AdRedis;
    const r = await serve('pv-broken');
    expect(r.body).toMatchObject({ counted: false, reason: 'dedupe_indisponivel' });
    expect(await redis.dbsize()).toBe(0);
    const failWrite = new Proxy(redis, { get: (t, p) => (p === 'set' ? async () => { throw new Error('ECONNRESET'); } : (t as any)[p]) });
    app.deps.redis = failWrite as unknown as AdRedis;
    expect((await serve('pv-broken-2')).body).toMatchObject({ counted: false, reason: 'dedupe_indisponivel' });
    expect(await readCounters(R(), 'cr-1', DAY)).toEqual({});
  });

  it('entrada inválida: 400; sem criativo elegível: house', async () => {
    expect((await call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'NOPE', pageViewId: 'x' } })).status).toBe(400);
    const r = await call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'SIDEBAR_1', pageViewId: 'pv-house' } });
    expect(r.body).toMatchObject({ kind: 'house', counted: false });
  });
});

describe('flush de entrega: Redis → ad_delivery_daily', () => {
  it('soma o delta, subtrai do Redis o que gravou e não perde incremento concorrente', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(((await serve(`pv-f${i}`)).body.impressionId as string));
    await event(ids[0]!, 'visible');
    await event(ids[0]!, 'click');
    await serve('pv-f0'); // refresh
    const r1 = await flushAdDelivery(R(), app.db);
    expect(r1).toEqual({ keys: 1, rows: 1 });
    const [row] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.criativoId, 'cr-1'));
    expect(row).toMatchObject({ dia: DAY, servidas: 5, visiveis: 1, cliques: 1, refreshSuprimido: 1, ignoradasBotInterno: 0 });
    expect(Object.values(await readCounters(R(), 'cr-1', DAY)).every((v) => v === 0)).toBe(true);
    expect(await flushAdDelivery(R(), app.db)).toEqual({ keys: 0, rows: 0 }); // nada a gravar
    // novo dia de tráfego soma na mesma linha
    await serve('pv-f9');
    await flushAdDelivery(R(), app.db);
    const [row2] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.criativoId, 'cr-1'));
    expect(row2).toMatchObject({ servidas: 6, visiveis: 1, cliques: 1 });
  });

  it('falha ao gravar devolve os contadores ao Redis (nada se perde nem duplica); visível nunca passa de servida', async () => {
    await redis.hincrby(adKeys.cnt('cr-inexistente', DAY), 's', 3); // FK falha no banco
    await expect(flushAdDelivery(R(), app.db)).rejects.toThrow();
    expect(await readCounters(R(), 'cr-inexistente', DAY)).toEqual({ s: 3 });
    await redis.flushall();
    await redis.hincrby(adKeys.cnt('cr-1', '2026-11-20'), 's', 2);
    await redis.hincrby(adKeys.cnt('cr-1', '2026-11-20'), 'v', 7); // contador de visível maior que servida (Redis perdeu dado)
    await flushAdDelivery(R(), app.db);
    const [row] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.id, 'cr-1@2026-11-20'));
    expect(row).toMatchObject({ servidas: 2, visiveis: 2 });
  });
});
