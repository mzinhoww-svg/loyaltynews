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
    expect(r1).toEqual({ keys: 1, rows: 1, recovered: 0 });
    const [row] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.criativoId, 'cr-1'));
    expect(row).toMatchObject({ dia: DAY, servidas: 5, visiveis: 1, cliques: 1, refreshSuprimido: 1, ignoradasBotInterno: 0 });
    expect(Object.values(await readCounters(R(), 'cr-1', DAY)).every((v) => v === 0)).toBe(true);
    expect(await flushAdDelivery(R(), app.db)).toEqual({ keys: 0, rows: 0, recovered: 0 }); // nada a gravar
    // novo dia de tráfego soma na mesma linha
    await serve('pv-f9');
    await flushAdDelivery(R(), app.db);
    const [row2] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.criativoId, 'cr-1'));
    expect(row2).toMatchObject({ servidas: 6, visiveis: 1, cliques: 1 });
  });

  it('dois flushes concorrentes sobre o mesmo contador: soma exata no banco, nunca em dobro (QA 2)', async () => {
    const key = adKeys.cnt('cr-1', '2026-11-21');
    for (const [f, n] of [['s', 100], ['v', 40], ['c', 7], ['i', 3], ['r', 11]] as const) await redis.hincrby(key, f, n);
    const rs = await Promise.all([flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db)]);
    expect(rs.reduce((a, r) => a + r.rows, 0)).toBe(1); // exatamente um flush levou o hash
    const [row] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.id, 'cr-1@2026-11-21'));
    expect(row).toMatchObject({ servidas: 100, visiveis: 40, cliques: 7, ignoradasBotInterno: 3, refreshSuprimido: 11 });
    expect(await redis.keys('ln:ad:*')).toEqual([]); // nada sobra: hash tomado e chave de trabalho apagada
  });

  it('conservação: muitos flushes concorrentes com incrementos chegando durante o flush; banco + Redis = total exato', async () => {
    const day = '2026-11-19';
    const key = adKeys.cnt('cr-1', day);
    const bump = async (n: number) => { for (let i = 0; i < n; i++) { await redis.hincrby(key, 's', 1); await redis.hincrby(key, 'r', 2); } };
    await Promise.all([
      bump(60), bump(60), bump(60),
      flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db),
    ]);
    await Promise.all([flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db)]); // varre o que sobrou
    const [row] = await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.id, `cr-1@${day}`));
    const rest = await readCounters(R(), 'cr-1', day);
    expect((row?.servidas ?? 0) + (rest.s ?? 0)).toBe(180);
    expect((row?.refreshSuprimido ?? 0) + (rest.r ?? 0)).toBe(360);
    expect(row?.servidas).toBe(180); // depois da varredura final tudo está no banco
  });

  const workKeys = () => redis.keys('ln:ad:flush:*');
  const ledger = () => app.db.$count(schema.adDeliveryFlushes);
  const row = async (id: string) => (await app.db.select().from(schema.adDeliveryDaily).where(eq(schema.adDeliveryDaily.id, id)))[0];

  it('falha de gravação com flushes concorrentes: o delta NÃO volta às cegas ao hash; fica na chave de trabalho e é gravado uma vez depois', async () => {
    const ledgerBefore = await ledger();
    await redis.hincrby(adKeys.cnt('cr-novo', DAY), 's', 5); // criativo ainda não existe: FK falha no banco
    const rs = await Promise.allSettled([flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db)]);
    expect(rs.filter((r) => r.status === 'rejected').length).toBeGreaterThanOrEqual(1);
    expect(await readCounters(R(), 'cr-novo', DAY)).toEqual({}); // nada devolvido ao hash original
    const keys = await workKeys();
    expect(keys).toHaveLength(1); // uma única chave de trabalho guarda o delta
    expect(await redis.hgetall(keys[0]!)).toEqual({ s: '5' });
    expect(await ledger()).toBe(ledgerBefore); // a transação que falhou desfez o ledger junto
    // o criativo passa a existir: a próxima rodada recupera a chave de trabalho e grava UMA vez
    await app.db.insert(schema.adCreatives).values({ id: 'cr-novo', campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true });
    const r = await flushAdDelivery(R(), app.db);
    expect(r).toMatchObject({ keys: 0, rows: 1, recovered: 0 });
    expect((await row(`cr-novo@${DAY}`))?.servidas).toBe(5);
    expect(await workKeys()).toEqual([]);
    expect(await flushAdDelivery(R(), app.db)).toEqual({ keys: 0, rows: 0, recovered: 0 });
    expect((await row(`cr-novo@${DAY}`))?.servidas).toBe(5);
  });

  it('erro AMBÍGUO (commit confirmado, resposta perdida): soma exata uma vez; a chave de trabalho é só apagada na recuperação (QA 2)', async () => {
    const day = '2026-11-18';
    const ledgerBefore = await ledger();
    const key = adKeys.cnt('cr-1', day);
    for (const [f, n] of [['s', 10], ['v', 4], ['c', 1]] as const) await redis.hincrby(key, f, n);
    const lossy = new Proxy(app.db, {
      get(t, p) {
        if (p === 'transaction') {
          return async (cb: any) => {
            await (t as any).transaction(cb); // o banco confirma...
            throw new Error('ECONNRESET depois do commit'); // ...e a resposta se perde
          };
        }
        const v = Reflect.get(t, p);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    await expect(flushAdDelivery(R(), lossy as typeof app.db)).rejects.toThrow(/ECONNRESET/);
    expect(await row(`cr-1@${day}`)).toMatchObject({ servidas: 10, visiveis: 4, cliques: 1 }); // gravou
    expect(await readCounters(R(), 'cr-1', day)).toEqual({}); // não voltou ao hash
    expect(await workKeys()).toHaveLength(1);
    expect(await ledger()).toBe(ledgerBefore + 1);
    // próxima rodada: o id está no ledger ⇒ só apaga a chave; NÃO soma de novo
    const r = await flushAdDelivery(R(), app.db);
    expect(r).toMatchObject({ rows: 0, recovered: 1 });
    expect(await row(`cr-1@${day}`)).toMatchObject({ servidas: 10, visiveis: 4, cliques: 1 });
    expect(await workKeys()).toEqual([]);
    // e uma recuperação repetida/concorrente da mesma chave também soma uma só vez
    await redis.hincrby(adKeys.cnt('cr-1', '2026-11-17'), 's', 7);
    await Promise.allSettled([flushAdDelivery(R(), lossy as typeof app.db), flushAdDelivery(R(), app.db), flushAdDelivery(R(), app.db)]);
    await flushAdDelivery(R(), app.db);
    expect((await row('cr-1@2026-11-17'))?.servidas).toBe(7);
    expect(await workKeys()).toEqual([]);
  });

  it('visível e clique nunca passam de servida; ledger de flush antigo é expurgado', async () => {
    await redis.hincrby(adKeys.cnt('cr-1', '2026-11-20'), 's', 2);
    await redis.hincrby(adKeys.cnt('cr-1', '2026-11-20'), 'v', 7); // contador de visível maior que servida (Redis perdeu dado)
    await app.db.insert(schema.adDeliveryFlushes).values([
      { flushId: 'velho', creativeId: 'cr-1', day: '2026-01-01', at: new Date(Date.now() - 9 * 86_400_000) },
      { flushId: 'recente', creativeId: 'cr-1', day: '2026-01-02', at: new Date(Date.now() - 1 * 86_400_000) },
    ]);
    await flushAdDelivery(R(), app.db);
    expect(await row('cr-1@2026-11-20')).toMatchObject({ servidas: 2, visiveis: 2 });
    const ids = (await app.db.select().from(schema.adDeliveryFlushes)).map((r) => r.flushId);
    expect(ids).toContain('recente');
    expect(ids).not.toContain('velho');
  });
});
