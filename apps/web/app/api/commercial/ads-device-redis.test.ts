/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
// `device` no serve de anúncios (ft/commercial-device 6f7eb48) pelo CAMINHO COM REDIS (apps/web/app/api/_lib/commercial/ads.ts), que o pacote
// não exercita: mobile só recebe criativo mobile; mobile sem criativo mobile = house SEM contar (nenhuma chave nem incremento no Redis);
// desktop inalterado; refresh de outra variante não conta; Redis fora = serve sem contar; e o upload aceita a dimensão MOBILE da posição.
// Padrão: ioredis-mock. Com LN_TEST_REDIS_URL (Redis LOCAL de teste; o teste faz flushall) usa Redis real, como ads.test.ts.
import IORedis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { assertLocalTestHost } from '@ln/db/testing';
import { adKeys, readCounters, type AdRedis } from '@ln/workers/ad-redis';
import { call, makeApp, MemoryBlobStore, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { sha256Hex } from '../_lib/commercial/creative-file';
import { seedCommercial } from '../_lib/commercial/repo';
import * as upload from './studio/creatives/upload/route';

// DP-43 por ambiente: aprovar criativo e levar campanha a approved/active pela API só vale onde a venda foi liberada (staging);
// em produção é 409 SALE_DISABLED_IN_ENV (venda-ambiente.test.ts). Este arquivo exercita o fluxo de venda, então roda como staging.
const APP_ENV_ANTES = process.env.APP_ENV;
beforeAll(() => { process.env.APP_ENV = 'staging'; });
afterAll(() => { if (APP_ENV_ANTES === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = APP_ENV_ANTES; });


const REAL_REDIS_URL = process.env.LN_TEST_REDIS_URL;
if (REAL_REDIS_URL) assertLocalTestHost(REAL_REDIS_URL, 'LN_TEST_REDIS_URL');
let app: Awaited<ReturnType<typeof makeApp>>;
let redis: InstanceType<typeof RedisMock>;
let blob: MemoryBlobStore;
let comercial: Actor;
const R = () => redis as unknown as AdRedis;
const DAY = '2026-11-22';

function png(w: number, h: number, extra = 40): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
/** Criativo real aprovado da campanha cmp-1 na posição TOP, com a dimensão dada (1280x150 = desktop; 320x100 ou 300x250 = mobile). */
async function criativo(id: string, w: number, h: number) {
  const sha = sha256Hex(png(w, h, id.length));
  await app.db.insert(schema.adCreatives).values({
    id, campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true,
    arquivoRef: `anuncios/${sha}.png`, arquivoMime: 'image/png', largura: w, altura: h, tamanhoKb: 1, arquivoSha256: sha, textoAlternativo: `Oferta ${id}`, destinoUrl: 'https://anunciante.example/oferta',
  } as any);
}
const serve = (pv: string, device?: unknown) => call(d, 'POST', { path: '/api/commercial/ads/serve', body: { positionId: 'TOP', pageViewId: pv, ...(device === undefined ? {} : { device }) } });
const cnt = (id: string) => readCounters(R(), id, DAY);

beforeAll(async () => {
  app = await makeApp({ adServerVendas: true });
  blob = new MemoryBlobStore();
  app.deps.blob = blob;
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante Teste' });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-1', nome: 'Campanha', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active' });
  comercial = await app.actor('admin');
}, 120_000);
beforeEach(async () => {
  redis = (REAL_REDIS_URL ? new IORedis(REAL_REDIS_URL, { maxRetriesPerRequest: 2 }) : new RedisMock()) as unknown as InstanceType<typeof RedisMock>;
  await redis.flushall();
  app.deps.redis = R();
  app.deps.flags.adServerVendas = true;
  await app.db.delete(schema.adCreatives);
  blob.objects.clear();
});
afterEach(async () => {
  if (REAL_REDIS_URL) await (redis as unknown as { quit: () => Promise<unknown> }).quit().catch(() => undefined);
});
afterAll(async () => {
  await app.close();
});

describe('serve com device, pelo caminho com Redis', () => {
  it('só criativo desktop: mobile recebe house SEM contar (nenhuma chave no Redis); desktop (sem device ou device=desktop) segue igual e conta', async () => {
    await criativo('cr-d', 1280, 150);
    const m = await serve('pv-m1', 'mobile');
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ kind: 'house', counted: false });
    expect(m.body.impressionId ?? null).toBeNull();
    expect(m.body.ad).toBeUndefined();
    expect(await redis.keys('ln:ad:*')).toEqual([]); // nem visualização, nem impressão, nem contador

    const semDevice = await serve('pv-d1');
    expect(semDevice.body).toMatchObject({ kind: 'creative', creativeId: 'cr-d', counted: true });
    const desktop = await serve('pv-d2', 'desktop');
    expect(desktop.body).toMatchObject({ kind: 'creative', creativeId: 'cr-d', counted: true });
    expect(desktop.body.ad).toMatchObject({ width: 1280, height: 150 });
    expect(await cnt('cr-d')).toEqual({ s: 2 });
  });

  it('com criativo mobile e desktop: mobile recebe SÓ o mobile (dimensão mobile) e o contador vai para ele; desktop nunca recebe o mobile', async () => {
    await criativo('cr-d', 1280, 150);
    await criativo('cr-m', 320, 100);
    for (let i = 0; i < 6; i++) {
      const m = await serve(`pv-m-${i}`, 'mobile');
      expect(m.body).toMatchObject({ kind: 'creative', creativeId: 'cr-m', counted: true });
      expect(m.body.ad).toMatchObject({ width: 320, height: 100 });
      const dk = await serve(`pv-d-${i}`, 'desktop');
      expect(dk.body).toMatchObject({ kind: 'creative', creativeId: 'cr-d', counted: true });
    }
    expect(await cnt('cr-m')).toEqual({ s: 6 });
    expect(await cnt('cr-d')).toEqual({ s: 6 });
  });

  it('refresh da mesma visualização no mesmo device não reconta; trocar de variante na mesma visualização não conta de novo', async () => {
    await criativo('cr-d', 1280, 150);
    await criativo('cr-m', 300, 250);
    const a = await serve('pv-r', 'mobile');
    expect(a.body).toMatchObject({ creativeId: 'cr-m', counted: true });
    const b = await serve('pv-r', 'mobile');
    expect(b.body).toMatchObject({ counted: false, reason: 'refresh', impressionId: a.body.impressionId });
    const c = await serve('pv-r', 'desktop');
    expect(c.body.counted).toBe(false);
    expect(c.body.creativeId === 'cr-m' && c.body.ad?.width === 1280).toBe(false); // nunca o mobile esticado no desktop
    expect(await cnt('cr-m')).toEqual({ s: 1, r: 1 });
    expect(await cnt('cr-d')).toEqual({});
    expect(await redis.keys(adKeys.cnt('*', DAY))).not.toContain(adKeys.cnt('cr-d', DAY));
  });

  it('device inválido: 400 sem tocar no Redis; Redis indisponível: mobile recebe o criativo mobile SEM contar (dedupe_indisponivel)', async () => {
    await criativo('cr-m', 320, 100);
    for (const bad of ['tablet', '', 1, null]) expect((await serve('pv-x', bad)).status, JSON.stringify(bad)).toBe(400);
    expect(await redis.keys('ln:ad:*')).toEqual([]);
    app.deps.redis = null as any;
    const r = await serve('pv-semredis', 'mobile');
    expect(r.body).toMatchObject({ kind: 'creative', creativeId: 'cr-m', counted: false, reason: 'dedupe_indisponivel', impressionId: null });
    expect(r.body.ad).toMatchObject({ width: 320, height: 100 });
    app.deps.redis = R();
    expect(await redis.keys('ln:ad:*')).toEqual([]);
  });
});

describe('upload do criativo com a dimensão mobile da posição', () => {
  const send = async (creativeId: string, file: Uint8Array) => {
    const form = new FormData();
    form.set('creativeId', creativeId);
    form.set('altText', 'Oferta mobile');
    form.set('destinationUrl', 'https://anunciante.example/mobile');
    form.set('arquivo', new File([file as BlobPart], 'anuncio.png', { type: 'application/octet-stream' }));
    const res = await upload.POST(new Request('http://localhost:3000/api/commercial/studio/creatives/upload', { method: 'POST', body: form, headers: { 'x-forwarded-for': '10.9.0.2', cookie: comercial.cookie } }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const novo = async () => (await call(d, 'POST', { path: '/api/commercial/studio/creatives', body: { campaignId: 'cmp-1', positionId: 'TOP', startDate: '2026-11-01', endDate: '2026-12-31' }, as: comercial })).body.id as string;

  it('TOP aceita 320x100 e 300x250 (mobile) além de 1280x150; outra dimensão segue recusada antes do Blob', async () => {
    for (const [w, h] of [[320, 100], [300, 250], [1280, 150]] as const) {
      const id = await novo();
      const r = await send(id, png(w, h, 500));
      expect(r.status, `${w}x${h}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.arquivo).toMatchObject({ width: w, height: h });
      const [row] = await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, id));
      expect([row!.largura, row!.altura]).toEqual([w, h]);
    }
    const before = blob.objects.size;
    const ruim = await send(await novo(), png(728, 90));
    expect([ruim.status, ruim.body.error.details.map((i: any) => i.code)]).toEqual([422, ['BAD_DIMENSIONS']]);
    expect(blob.objects.size).toBe(before);
  });

  it('criativo mobile enviado e aprovado passa a ser servido ao mobile pelo caminho com Redis (e conta)', async () => {
    const id = await novo();
    expect((await send(id, png(320, 100, 500))).status).toBe(200);
    expect((await call(d, 'POST', { path: '/api/commercial/studio/creatives/approve', body: { creativeId: id }, as: comercial })).body).toMatchObject({ approved: true });
    const m = await serve('pv-up', 'mobile');
    expect(m.body).toMatchObject({ kind: 'creative', creativeId: id, counted: true });
    expect(await cnt(id)).toEqual({ s: 1 });
    expect((await serve('pv-up-d', 'desktop')).body).toMatchObject({ kind: 'house', counted: false }); // só há o mobile: desktop fica sem anúncio
  });
});
