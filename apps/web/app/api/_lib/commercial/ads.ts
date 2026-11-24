// Caminho público do ad server (serve / evento): sem hidratar o banco inteiro e sem lock. O domínio (AdServer) continua
// síncrono e sem I/O; este módulo faz o I/O em volta dele com o ciclo preload → serve → commit (docs/dedupe-persistido.md):
//  - criativos elegíveis vêm do PostgreSQL (leitura leve); dedupe e contadores ficam no Redis;
//  - a entrada da impressão é gravada (SET NX) ANTES de contar; quem perde a corrida não conta;
//  - visível/clique contam uma vez por impressão entre instâncias (HSETNX);
//  - Redis indisponível ⇒ serve com counted:false e reason 'dedupe_indisponivel'. Nunca cai para memória e conta.
import {
  AdServer, createCommercialState, diffCounters, ImpressionLedger, makeCtx,
  type CommercialCtx, type ServeResult,
} from '@ln/commercial';
import type { Route } from '@ln/commercial/api';
import { RedisImpressionStore } from '@ln/workers/ad-redis';
import type { RouteCtx } from '../http';
import { getAdRedis } from '../redis';
import { activeGaps, flushGapCounts, gapCountsOf, loadGapsInto } from './gaps';
import { loadCreatives } from './repo';

type Extra = { now: string; today: string; flags: CommercialCtx['flags']; actor?: CommercialCtx['actor'] };
export const isAdRoute = (path: string): boolean => path.endsWith('/ads/serve') || path.endsWith('/ads/event');

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null);
/**
 * Sem dedupe confiável: serve sem contar. O anúncio é REMONTADO sem impressão (`href` = `c:{criativo}`): o que o ledger local gerou apontaria para uma
 * impressão que não existe no Redis e o clique daria 404.
 */
const degraded = (r: ServeResult, ads: AdServer): ServeResult => {
  const { ad: _local, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  const ad = r.creativeId ? ads.publicAdFor(r.creativeId, null) : null;
  return { ...rest, impressionId: null, counted: false, reason: 'dedupe_indisponivel', ...(ad ? { ad } : {}) };
};

function freshState(ledger: ImpressionLedger) {
  const s = createCommercialState();
  return { ...s, ads: new AdServer(ledger) };
}

export async function adCall(route: Route, input: unknown, c: RouteCtx, extra: Extra): Promise<{ status: number; body: unknown }> {
  const flagOn = c.deps.flags.adServerVendas === true;
  const isServe = route.path.endsWith('/ads/serve');
  const ledger = new ImpressionLedger({ newId: () => crypto.randomUUID() });

  // flag desligada: o handler responde house/counted:false sem tocar em banco nem Redis
  if (!flagOn) return route.handler(makeCtx(freshState(ledger), extra), input);

  // lacunas ativas (perda de dedupe): o domínio suspende a contagem enquanto durarem; o que ele deixar de contar é gravado na lacuna
  const nowMs = Date.parse(extra.now);
  const rodar = async (state: ReturnType<typeof freshState>) => {
    loadGapsInto(state.ads.audit, await activeGaps(c.deps.db, nowMs));
    const antes = gapCountsOf(state.ads.audit);
    const res = route.handler(makeCtx(state, extra), input);
    await flushGapCounts(c.deps.db, state.ads.audit, antes);
    return res;
  };

  const redis = c.deps.redis === undefined ? await getAdRedis() : c.deps.redis;
  const store = redis ? new RedisImpressionStore(redis) : null;
  const body = (input ?? {}) as Record<string, unknown>;

  if (isServe) {
    const state = freshState(ledger);
    state.ads.loadCreatives(await loadCreatives(c.deps.db));
    const pv = str(body.pageViewId);
    const pos = str(body.positionId);
    if (!store || !pv || !pos) {
      const res = await rodar(state);
      if (res.status >= 400) return res;
      return { status: res.status, body: store ? res.body : degraded(res.body as ServeResult, state.ads) };
    }
    try {
      const existing = await store.loadView(pv, pos);
      if (existing) ledger.preload([existing]);
    } catch {
      const res = await rodar(state);
      return res.status >= 400 ? res : { status: res.status, body: degraded(res.body as ServeResult, state.ads) };
    }
    const before = state.ads.countersSnapshot();
    const res = await rodar(state);
    if (res.status >= 400) return res;
    const result = res.body as ServeResult;
    try {
      for (const e of ledger.drainChanges()) {
        const committed = await store.commitNew(e);
        if (!committed.won) {
          // outra instância gravou antes: esta visualização já tem impressão; devolve a vencedora e não conta
          const w = committed.existing;
          const creativeId = w?.creativeId ?? result.creativeId;
          const impressionId = w?.impressionId ?? null;
          // a vencedora pode ser de OUTRA variante (pedido com outro device na mesma visualização): nunca a devolve a este dispositivo
          const device = body.device === 'mobile' ? 'mobile' : 'desktop';
          const compativel = creativeId ? state.ads.eligible(pos, extra.today, device).some((x) => x.id === creativeId) : false;
          if (!compativel) {
            return { status: 200, body: { kind: 'house', creativeId: null, impressionId: null, counted: false, reason: device === 'mobile' ? 'sem criativo mobile elegível; house ad' : 'sem criativo elegível; house ad' } };
          }
          // a resposta da vencedora também leva o anúncio (sem ele a posição ficaria oculta para quem perdeu a corrida)
          const ad = creativeId ? state.ads.publicAdFor(creativeId, impressionId) : null;
          return { status: 200, body: { kind: 'creative', creativeId, impressionId, counted: false, reason: 'refresh', ...(ad ? { ad } : {}) } };
        }
      }
      const delta = diffCounters(before, state.ads.countersSnapshot());
      for (const [creativeId, d] of Object.entries(delta)) await store.addCounters(creativeId, extra.today, d);
    } catch {
      return { status: 200, body: degraded(result, state.ads) }; // sub-conta: serviu, não contou
    }
    return res;
  }

  // evento visível/clique
  const id = str(body.impressionId);
  if (!id) return route.handler(makeCtx(freshState(ledger), extra), input); // entrada inválida: o handler responde 400
  if (!store) return { status: 200, body: { counted: false } }; // sem dedupe confiável não conta
  try {
    const entry = await store.loadImpression(id);
    if (!entry) return { status: 200, body: { counted: false } };
    ledger.preload([entry]);
    const state = freshState(ledger);
    const res = await rodar(state);
    if (res.status >= 400 || !(res.body as { counted?: boolean }).counted) return res;
    const event = body.event === 'click' ? 'clicked' : 'visible';
    if (!(await store.claim(id, event))) return { status: 200, body: { counted: false } }; // outra instância contou antes
    await store.addCounters(entry.creativeId, extra.today, event === 'visible' ? { visible: 1 } : { clicks: 1 });
    return res;
  } catch {
    return { status: 200, body: { counted: false } };
  }
}

