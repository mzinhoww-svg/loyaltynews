/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import RedisMock from 'ioredis-mock';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import type { AdRedis } from '@ln/workers/ad-redis';
import { call, makeApp, MemoryBlobStore, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { creativeBlobKey, readImageInfo, sha256Hex } from '../_lib/commercial/creative-file';
import { seedCommercial } from '../_lib/commercial/repo';
import * as plan from './ads/plan/route';
import * as click from './ads/click/route';
import * as image from './ads/creative-image/route';
import * as upload from './studio/creatives/upload/route';

// Posições de anúncio no portal: só criativo REAL aparece; plano sem contar; clique 302 com destino do cadastro; imagem com cabeçalhos defensivos e conferência de hash;
// upload do arquivo medido no servidor.
let app: Awaited<ReturnType<typeof makeApp>>;
let redis: InstanceType<typeof RedisMock>;
let blob: MemoryBlobStore;
let comercial: Actor;
let editor: Actor;
const DAY = '2026-11-22';

/** PNG mínimo com IHDR de largura x altura (o servidor lê só o cabeçalho). */
function png(w: number, h: number, extra = 40): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

const get = (handler: { GET: (r: Request, c?: any) => Promise<Response> }, path: string, headers: Record<string, string> = {}) =>
  handler.GET(new Request(`http://localhost:3000${path}`, { headers: { 'x-forwarded-for': '10.9.0.2', ...headers } }));

async function criativoReal(id: string, over: Record<string, unknown> = {}) {
  const bytes = png(1280, 150, 200);
  const sha = sha256Hex(bytes);
  const key = creativeBlobKey(sha, 'png');
  await blob.put(key, bytes, 'image/png');
  await app.db.insert(schema.adCreatives).values({
    id, campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true,
    arquivoRef: key, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 1, arquivoSha256: sha, textoAlternativo: 'Oferta do Anunciante Teste', destinoUrl: 'https://anunciante.example/oferta?utm=ln',
    ...over,
  } as any);
  return { key, sha, bytes };
}

beforeAll(async () => {
  app = await makeApp({ adServerVendas: true });
  blob = new MemoryBlobStore();
  app.deps.blob = blob;
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante Teste' });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-1', nome: 'Campanha', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active' });
  [comercial, editor] = [await app.actor('admin'), await app.actor('editor')];
}, 120_000);
beforeEach(async () => {
  redis = new RedisMock();
  await redis.flushall();
  app.deps.redis = redis as unknown as AdRedis;
  app.deps.flags.adServerVendas = true;
  await app.db.delete(schema.adCreatives);
  blob.objects.clear();
});
afterAll(async () => {
  await app.close();
});

const serve = (pv: string) => call(d, 'POST', { path: '/api/commercial/ads/serve', body: { positionId: 'TOP', pageViewId: pv } });

describe('serve: só criativo real, com a visão pública do anúncio', () => {
  it('criativo real: o anúncio vem com rótulo, anunciante (conta da campanha), imagem, alt, dimensão e href de clique; nenhum campo interno', async () => {
    await criativoReal('cr-1');
    const r = await serve('pv-1');
    expect(r.body).toMatchObject({ kind: 'creative', counted: true });
    const ad = r.body.ad;
    expect(ad).toMatchObject({ positionId: 'TOP', creativeId: 'cr-1', label: 'Publicidade', advertiser: 'Anunciante Teste', alt: 'Oferta do Anunciante Teste', width: 1280, height: 150, impressionId: r.body.impressionId });
    expect(ad.imageSrc).toMatch(/^\/api\/commercial\/ads\/creative-image\?id=cr-1&v=[0-9a-f]{8}$/);
    expect(ad.href).toBe(`/api/commercial/ads/click?ref=${r.body.impressionId}`);
    expect(JSON.stringify(ad)).not.toMatch(/campanha|cmp-1|acc-1|peso|weight|anuncios\//); // nada de id interno, peso nem chave de arquivo
  });

  it('sem criativo real (sem arquivo/alt/destino ou aprovado=false) NÃO serve e NÃO conta: a posição fica oculta', async () => {
    await app.db.insert(schema.adCreatives).values({ id: 'cr-sem', campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: false });
    const r = await serve('pv-2');
    expect(r.body).toMatchObject({ kind: 'house', counted: false });
    expect(r.body.ad).toBeUndefined();
    expect(await redis.dbsize()).toBe(0);
  });

  it('Redis indisponível: serve sem contar e o anúncio é remontado SEM impressão (href c:{criativo}, nunca uma impressão que não existe)', async () => {
    await criativoReal('cr-1');
    app.deps.redis = null;
    const r = await serve('pv-3');
    expect(r.body).toMatchObject({ counted: false, reason: 'dedupe_indisponivel', impressionId: null });
    expect(r.body.ad).toMatchObject({ creativeId: 'cr-1', impressionId: null, href: '/api/commercial/ads/click?ref=c%3Acr-1' });
  });

  it('refresh da mesma visualização (ou corrida perdida): devolve o MESMO anúncio, sem recontar', async () => {
    await criativoReal('cr-1');
    const a = await serve('pv-4');
    const b = await serve('pv-4');
    expect(b.body).toMatchObject({ counted: false, reason: 'refresh', impressionId: a.body.impressionId });
    expect(b.body.ad).toMatchObject({ creativeId: 'cr-1', impressionId: a.body.impressionId });
  });
});

describe('GET /api/commercial/ads/plan', () => {
  it('só posições com criativo real elegível hoje; leitura leve (nada é contado); cache público curto; flag desligada: tudo indisponível', async () => {
    await criativoReal('cr-1');
    const r = await get(plan, '/api/commercial/ads/plan?positions=TOP,FOOTER');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/s-maxage=60/);
    const body = await r.json();
    expect(body.slots).toEqual([{ positionId: 'TOP', available: true, width: 1280, height: 150 }, { positionId: 'FOOTER', available: false, width: null, height: null }]);
    expect(await redis.dbsize()).toBe(0);
    app.deps.flags.adServerVendas = false;
    expect((await (await get(plan, '/api/commercial/ads/plan?positions=TOP')).json()).slots[0].available).toBe(false);
    expect((await get(plan, '/api/commercial/ads/plan?positions=INVENTADA')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/commercial/ads/click', () => {
  it('302 para o destino DO CADASTRO, com Referrer-Policy; conta o clique uma vez por impressão (repetir leva ao destino sem recontar)', async () => {
    await criativoReal('cr-1');
    const s = await serve('pv-5');
    await call(d, 'POST', { path: '/api/commercial/ads/event', body: { impressionId: s.body.impressionId, event: 'visible' } });
    const r = await get(click, s.body.ad.href);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://anunciante.example/oferta?utm=ln');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toBe('');
    const h = await redis.hgetall(`ln:ad:cnt:cr-1:${DAY}`);
    expect(Number(h.c)).toBe(1);
    expect((await get(click, s.body.ad.href)).status).toBe(302);
    expect(Number((await redis.hgetall(`ln:ad:cnt:cr-1:${DAY}`)).c)).toBe(1); // o segundo clique da mesma impressão não conta
  });

  it('ref c:{criativo} leva ao destino sem contar; o destino nunca vem da URL do cliente (parâmetro extra é ignorado)', async () => {
    await criativoReal('cr-1');
    const r = await get(click, '/api/commercial/ads/click?ref=c%3Acr-1&destination=https%3A%2F%2Fevil.example&url=https%3A%2F%2Fevil.example');
    expect(r.headers.get('location')).toBe('https://anunciante.example/oferta?utm=ln');
    expect(await redis.dbsize()).toBe(0);
  });

  it('404 uniforme: ref desconhecido, ausente, criativo inexistente/pausado/inválido, flag desligada', async () => {
    await criativoReal('cr-1');
    await app.db.insert(schema.campaigns).values({ id: 'cmp-p', nome: 'Pausada', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'paused' });
    await criativoReal('cr-pausado', { campanhaId: 'cmp-p' });
    const msgs = new Set<string>();
    for (const ref of ['', 'c%3Anao-existe', 'impressao-desconhecida', 'c%3Acr-pausado']) {
      const r = await get(click, `/api/commercial/ads/click${ref ? `?ref=${ref}` : ''}`);
      expect(r.status, ref).toBe(404);
      expect(r.headers.get('location')).toBeNull();
      msgs.add(JSON.stringify((await r.json()).error.message));
    }
    expect(msgs.size).toBe(1);
    app.deps.flags.adServerVendas = false;
    expect((await get(click, '/api/commercial/ads/click?ref=c%3Acr-1')).status).toBe(404);
  });
});

describe('GET /api/commercial/ads/creative-image', () => {
  it('bytes do criativo real com cabeçalhos defensivos e ETag pelo sha256 (304 em If-None-Match)', async () => {
    const { sha, bytes } = await criativoReal('cr-1');
    const r = await get(image, '/api/commercial/ads/creative-image?id=cr-1');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(r.headers.get('etag')).toBe(`"${sha}"`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
    expect((await get(image, '/api/commercial/ads/creative-image?id=cr-1', { 'if-none-match': `"${sha}"` })).status).toBe(304);
  });

  it('404 uniforme: criativo não aprovado, fora do período, campanha inativa, inexistente, arquivo sumido do Blob, ARQUIVO ADULTERADO (hash não bate) e flag desligada', async () => {
    await criativoReal('cr-nao-aprovado', { aprovado: false });
    await criativoReal('cr-periodo', { inicio: '2027-01-01', fim: '2027-02-01' });
    await app.db.insert(schema.campaigns).values({ id: 'cmp-i', nome: 'Inativa', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'paused' });
    await criativoReal('cr-inativa', { campanhaId: 'cmp-i' });
    const ok = await criativoReal('cr-ok');
    await criativoReal('cr-sumido', { arquivoRef: 'anuncios/nao-existe.png' });
    for (const id of ['cr-nao-aprovado', 'cr-periodo', 'cr-inativa', 'nao-existe', 'cr-sumido']) expect((await get(image, `/api/commercial/ads/creative-image?id=${id}`)).status, id).toBe(404);
    blob.objects.set(ok.key, { bytes: png(1280, 150, 999), contentType: 'image/png' }); // outro conteúdo sob a mesma chave
    expect((await get(image, '/api/commercial/ads/creative-image?id=cr-ok')).status).toBe(404);
    blob.objects.set(ok.key, { bytes: ok.bytes, contentType: 'image/png' });
    app.deps.flags.adServerVendas = false;
    expect((await get(image, '/api/commercial/ads/creative-image?id=cr-ok')).status).toBe(404);
  });
});

describe('POST /api/commercial/studio/creatives/upload', () => {
  const send = async (fields: Record<string, string>, file: Uint8Array | null, as: Actor | null = comercial, name = 'anuncio.png') => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (file) form.set('arquivo', new File([file as BlobPart], name, { type: 'application/octet-stream' }));
    const res = await upload.POST(new Request('http://localhost:3000/api/commercial/studio/creatives/upload', { method: 'POST', body: form, headers: { 'x-forwarded-for': '10.9.0.2', ...(as ? { cookie: as.cookie } : {}) } }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const novoCriativo = async () => {
    const r = await call(d, 'POST', { path: '/api/commercial/studio/creatives', body: { campaignId: 'cmp-1', positionId: 'TOP', startDate: '2026-11-01', endDate: '2026-12-31' }, as: comercial });
    return r.body.id as string;
  };

  it('arquivo válido: tipo, dimensões, peso e hash MEDIDOS no servidor, gravado no Blob, persistido; aprovação revogada; o que o cliente declara não vale', async () => {
    const id = await novoCriativo();
    const bytes = png(1280, 150, 3000);
    const r = await send({ creativeId: id, altText: 'Oferta nova', destinationUrl: 'https://anunciante.example/nova', width: '1', height: '1', sha256: 'f'.repeat(64) }, bytes, comercial, 'qualquer.gif');
    expect(r.status).toBe(200);
    const sha = sha256Hex(bytes);
    expect(r.body.arquivo).toEqual({ mime: 'image/png', width: 1280, height: 150, sizeKB: 3, sha256: sha });
    expect(r.body).toMatchObject({ approved: false, issues: [] });
    expect(blob.objects.get(creativeBlobKey(sha, 'png'))?.bytes).toEqual(bytes);
    const [row] = await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, id));
    expect(row).toMatchObject({ arquivoRef: creativeBlobKey(sha, 'png'), arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 3, arquivoSha256: sha, textoAlternativo: 'Oferta nova', destinoUrl: 'https://anunciante.example/nova', aprovado: false });
    // aprovar agora é aceito; trocar o arquivo depois REVOGA a aprovação
    expect((await call(d, 'POST', { path: '/api/commercial/studio/creatives/approve', body: { creativeId: id }, as: comercial })).body).toMatchObject({ approved: true });
    const outro = png(1280, 150, 5000);
    expect((await send({ creativeId: id }, outro, comercial)).status).toBe(200);
    expect((await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, id)))[0]!.aprovado).toBe(false);
  });

  it('recusa o que não casa com a posição (dimensão, peso, tipo) ANTES de gravar no Blob: 422 com a lista; 415 para o que não é JPEG/PNG/GIF íntegro', async () => {
    const id = await novoCriativo();
    const dim = await send({ creativeId: id }, png(728, 90));
    expect([dim.status, dim.body.error.code, dim.body.error.details.map((i: any) => i.code)]).toEqual([422, 'CREATIVE_FILE_INVALID', ['BAD_DIMENSIONS']]);
    const pesado = await send({ creativeId: id }, png(1280, 150, 400 * 1024));
    expect([pesado.status, pesado.body.error.details.map((i: any) => i.code)]).toEqual([422, ['TOO_HEAVY']]);
    expect(blob.objects.size).toBe(0);
    for (const lixo of [new Uint8Array([1, 2, 3, 4, 5]), new TextEncoder().encode('<html><script>alert(1)</script></html>'), new TextEncoder().encode('%PDF-1.4 ...'), Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])]) {
      expect((await send({ creativeId: id }, lixo)).status).toBe(415);
    }
    expect((await send({ creativeId: id }, png(0, 150))).status).toBe(415); // dimensão zero não é imagem
    expect((await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, id)))[0]!.arquivoRef).toBeNull();
  });

  it('acesso: sem sessão 401, editor 403; criativo inexistente 404; sem arquivo 400; sem Blob configurado 503', async () => {
    const id = await novoCriativo();
    const bytes = png(1280, 150);
    expect((await send({ creativeId: id }, bytes, null)).status).toBe(401);
    expect((await send({ creativeId: id }, bytes, editor)).status).toBe(403);
    expect((await send({ creativeId: 'nao-existe' }, bytes)).status).toBe(404);
    expect((await send({ creativeId: id }, null)).status).toBe(400);
    app.deps.blob = null;
    expect((await send({ creativeId: id }, bytes)).status).toBe(503);
    app.deps.blob = blob;
  });
});

describe('leitor de cabeçalho de imagem', () => {
  it('lê PNG, GIF e JPEG (SOF depois de segmentos APPn); recusa truncado, dimensão zero e tipo desconhecido', () => {
    expect(readImageInfo(png(300, 250))).toMatchObject({ mime: 'image/png', width: 300, height: 250 });
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xfa, 0x00, 0, 0]);
    expect(readImageInfo(gif)).toMatchObject({ mime: 'image/gif', width: 300, height: 250 });
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xfa, 0x01, 0x2c, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(readImageInfo(jpg)).toMatchObject({ mime: 'image/jpeg', width: 300, height: 250 });
    expect(readImageInfo(png(10, 10).slice(0, 20))).toBeNull();
    expect(readImageInfo(gif.slice(0, 8))).toBeNull();
    expect(readImageInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readImageInfo(new Uint8Array(0))).toBeNull();
  });
});
