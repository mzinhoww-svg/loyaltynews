// Rotas PÚBLICAS do anúncio que não cabem no despachante JSON: plano das posições, clique (302) e imagem do criativo. Regras (do Comercial e do PM):
//  - só criativo REAL aparece (arquivo medido no servidor, texto alternativo, anunciante, destino https); sem criativo, a posição fica oculta;
//  - plano: leitura leve (só criativos do banco + flag), nada é contado, cache público curto;
//  - clique: o destino sai do criativo cadastrado, NUNCA da URL do cliente (sem redirecionamento aberto); conta o clique pelo mesmo caminho do /ads/event
//    (uma vez por impressão, HSETNX) e responde 302 com Referrer-Policy; qualquer coisa fora disso = 404 uniforme;
//  - imagem: o arquivo vem do Blob com cabeçalhos defensivos, ETag pelo sha256 e conferência de integridade (hash do arquivo = hash cadastrado); 404 uniforme.
import { AdServer, ImpressionLedger, createCommercialState, makeCtx, type CommercialCtx } from '@ln/commercial';
import { ROUTES, type Route } from '@ln/commercial/api';
import { RedisImpressionStore } from '@ln/workers/ad-redis';
import { HttpError, json, queryObject, type RouteCtx, type RouteFn } from '../http';
import { getBlobStore, type BlobStore } from '../blob';
import { getAdRedis } from '../redis';
import { adCall } from './ads';
import { saoPauloDate } from './index';
import { sha256Hex } from './creative-file';
import { loadCreatives } from './repo';

const find = (path: string): Route => ROUTES.find((r) => r.path === path)!;
const NOT_FOUND = () => new HttpError(404, 'NOT_FOUND', 'Anúncio indisponível.');
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);

type Extra = { now: string; today: string; flags: CommercialCtx['flags']; actor?: CommercialCtx['actor'] };
const extraOf = (c: RouteCtx): Extra => {
  const now = c.deps.now();
  return { now: now.toISOString(), today: saoPauloDate(now), flags: c.deps.flags };
};

async function stateWithCreatives(c: RouteCtx, ledger = new ImpressionLedger({ newId: () => crypto.randomUUID() })) {
  const s = createCommercialState();
  const state = { ...s, ads: new AdServer(ledger) };
  state.ads.loadCreatives(await loadCreatives(c.deps.db));
  return state;
}

/** GET /api/commercial/ads/plan?positions=TOP,FOOTER: quais posições têm criativo real elegível hoje. NÃO conta impressão. */
export const adPlanRoute: RouteFn = async (_req, c) => {
  const extra = extraOf(c);
  const state = await stateWithCreatives(c);
  const res = find('/api/commercial/ads/plan').handler(makeCtx(state, extra), queryObject(c.url));
  const headers = { 'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=60' };
  if (res.status >= 400) return json(res.body, res.status, { 'cache-control': 'no-store' });
  return json(res.body, 200, headers); // mesmo corpo do despachante do comercial: { today, slots }
};

/** GET /api/commercial/ads/click?ref=…: 302 para o destino do criativo, contando o clique quando há impressão. */
export const adClickRoute: RouteFn = async (_req, c) => {
  if (c.deps.flags.adServerVendas !== true) throw NOT_FOUND();
  const ref = str(queryObject(c.url).ref);
  if (!ref) throw NOT_FOUND();
  const extra = extraOf(c);
  const ledger = new ImpressionLedger({ newId: () => crypto.randomUUID() });
  const redis = c.deps.redis === undefined ? await getAdRedis() : c.deps.redis;
  const store = redis ? new RedisImpressionStore(redis) : null;
  // a impressão → criativo vem do Redis (o ledger de uma requisição não a conhece)
  if (!ref.startsWith('c:')) {
    if (!store) throw NOT_FOUND();
    try {
      const entry = await store.loadImpression(ref);
      if (!entry) throw NOT_FOUND();
      ledger.preload([entry]);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw NOT_FOUND();
    }
  }
  const state = await stateWithCreatives(c, ledger);
  const res = find('/api/commercial/ads/click').handler(makeCtx(state, extra), { ref });
  if (res.status >= 400) throw NOT_FOUND();
  const { destination, impressionId } = res.body as { destination: string; impressionId: string | null };
  // conta o clique pelo MESMO caminho do /ads/event (uma vez por impressão); falha ao contar nunca impede de levar o leitor ao destino
  if (impressionId) {
    await adCall(find('/api/commercial/ads/event'), { impressionId, event: 'click' }, c, extra).catch(() => undefined);
  }
  return new Response(null, {
    status: 302,
    headers: { location: destination, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
};

const blobOf = (c: RouteCtx): BlobStore | null => (c.deps.blob === undefined ? getBlobStore() : c.deps.blob);

/** GET /api/commercial/ads/creative-image?id=…: bytes do arquivo de um criativo real, aprovado, em campanha ativa e no período. */
export const adCreativeImageRoute: RouteFn = async (req, c) => {
  if (c.deps.flags.adServerVendas !== true) throw NOT_FOUND();
  const id = str(queryObject(c.url).id);
  if (!id) throw NOT_FOUND();
  const state = await stateWithCreatives(c);
  const res = find('/api/commercial/ads/creative-image').handler(makeCtx(state, extraOf(c)), { id });
  if (res.status >= 400) throw NOT_FOUND();
  const { key, mime, sha256 } = res.body as { key: string; mime: string; sizeKB: number; sha256: string };
  const headers = {
    etag: `"${sha256}"`,
    'cache-control': 'public, max-age=300, stale-while-revalidate=60',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (req.headers.get('if-none-match') === `"${sha256}"`) return new Response(null, { status: 304, headers });
  const blob = blobOf(c);
  if (!blob) throw NOT_FOUND();
  const obj = await blob.get(key);
  // integridade: o arquivo que sai tem de ser o que foi cadastrado e aprovado (hash); outro conteúdo = 404 uniforme, nunca servido
  if (!obj || sha256Hex(obj.bytes) !== sha256) throw NOT_FOUND();
  return new Response(obj.bytes as BodyInit, { status: 200, headers: { ...headers, 'content-type': mime, 'content-length': String(obj.bytes.length), 'content-disposition': 'inline' } });
};
