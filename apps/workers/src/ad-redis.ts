// Dedupe e contagem de entrega do ad server em Redis (opção A de packages/commercial/docs/dedupe-persistido.md,
// decisão do PM). Chaves só com ids opacos: nenhum IP, user agent ou cookie. Política: SUB-CONTAR, NUNCA INFLAR.
//   ln:ad:view:{pageViewId}:{positionId}  JSON da LedgerEntry         TTL 30 min  SET NX EX
//   ln:ad:imp:{impressionId}              hash {creativeId,key,at,visible,clicked}  TTL 2 h  HSETNX
//   ln:ad:cnt:{creativeId}:{AAAA-MM-DD}   hash dos 5 contadores        TTL 3 dias  HINCRBY
// O worker `flushAdDelivery` soma os contadores em ad_delivery_daily e subtrai do Redis o que gravou.
import { sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { DeliveryCounters, LedgerEntry } from '@ln/commercial';

/** Subconjunto do ioredis usado aqui (ioredis e ioredis-mock cumprem). */
export interface AdRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<number>;
  hsetnx(key: string, field: string, value: string): Promise<number>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  scan(cursor: string | number, match: 'MATCH', pattern: string, count: 'COUNT', n: number): Promise<[string, string[]]>;
}

export const TTL = { view: 1800, imp: 7200, cnt: 3 * 86_400 } as const;
export const adKeys = {
  view: (pageViewId: string, positionId: string) => `ln:ad:view:${pageViewId}:${positionId}`,
  imp: (impressionId: string) => `ln:ad:imp:${impressionId}`,
  cnt: (creativeId: string, day: string) => `ln:ad:cnt:${creativeId}:${day}`,
  cntPattern: 'ln:ad:cnt:*',
} as const;

const FIELD: Record<keyof DeliveryCounters, string> = {
  served: 's', visible: 'v', clicks: 'c', ignoredBotOrInternal: 'i', refreshSuppressed: 'r',
};

export class RedisImpressionStore {
  constructor(private readonly redis: AdRedis) {}

  /** Entrada da visualização (refresh), se já existe. */
  async loadView(pageViewId: string, positionId: string): Promise<LedgerEntry | null> {
    const raw = await this.redis.get(adKeys.view(pageViewId, positionId));
    return raw ? (JSON.parse(raw) as LedgerEntry) : null;
  }

  /** Entrada pela impressão (eventos visível/clique). */
  async loadImpression(impressionId: string): Promise<LedgerEntry | null> {
    const h = await this.redis.hgetall(adKeys.imp(impressionId));
    if (!h.creativeId || !h.key) return null;
    return { impressionId, key: h.key, creativeId: h.creativeId, at: Number(h.at ?? 0), visible: h.visible === '1', clicked: h.clicked === '1' };
  }

  /**
   * Grava a primeira impressão da visualização. `SET NX` decide a corrida entre instâncias: quem perde recebe a
   * entrada vencedora e NÃO deve contar. Grava a entrada ANTES de qualquer contador.
   */
  async commitNew(e: LedgerEntry): Promise<{ won: true } | { won: false; existing: LedgerEntry | null }> {
    const [pageViewId, positionId] = splitKey(e.key);
    const ok = await this.redis.set(adKeys.view(pageViewId, positionId), JSON.stringify(e), 'EX', TTL.view, 'NX');
    if (ok !== 'OK') return { won: false, existing: await this.loadView(pageViewId, positionId) };
    const k = adKeys.imp(e.impressionId);
    await this.redis.hset(k, 'creativeId', e.creativeId);
    await this.redis.hset(k, 'key', e.key);
    await this.redis.hset(k, 'at', String(e.at));
    await this.redis.expire(k, TTL.imp);
    return { won: true };
  }

  /** Marca visível/clique uma única vez por impressão entre todas as instâncias (HSETNX). true = esta chamada contou. */
  async claim(impressionId: string, event: 'visible' | 'clicked'): Promise<boolean> {
    return (await this.redis.hsetnx(adKeys.imp(impressionId), event, '1')) === 1;
  }

  /** Soma um delta nos contadores do criativo no dia. */
  async addCounters(creativeId: string, day: string, delta: Partial<DeliveryCounters>): Promise<void> {
    const key = adKeys.cnt(creativeId, day);
    let touched = false;
    for (const [k, f] of Object.entries(FIELD) as [keyof DeliveryCounters, string][]) {
      const v = delta[k] ?? 0;
      if (v !== 0) { await this.redis.hincrby(key, f, v); touched = true; }
    }
    if (touched) await this.redis.expire(key, TTL.cnt);
  }
}

/** `${pageViewId}|${positionId}` → partes (a posição nunca contém `|`; o pageViewId pode). */
function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf('|');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Subtrai do Redis o que leu e grava no PostgreSQL; falha ao gravar devolve ao Redis. Crash no meio sub-conta. */
export async function flushAdDelivery(redis: AdRedis, db: Db): Promise<{ keys: number; rows: number }> {
  let cursor = '0';
  let keys = 0;
  let rows = 0;
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', adKeys.cntPattern, 'COUNT', 200);
    cursor = next;
    for (const key of batch) {
      const m = /^ln:ad:cnt:(.+):(\d{4}-\d{2}-\d{2})$/.exec(key);
      if (!m) continue;
      const [, creativeId, day] = m as unknown as [string, string, string];
      const h = await redis.hgetall(key);
      const d = {
        s: Number(h.s ?? 0), v: Number(h.v ?? 0), c: Number(h.c ?? 0), i: Number(h.i ?? 0), r: Number(h.r ?? 0),
      };
      if (!Object.values(d).some((x) => x > 0)) continue;
      keys++;
      // 1) tira do Redis o que foi lido (incrementos novos ficam); 2) grava; se falhar, devolve
      for (const [f, v] of Object.entries(d)) if (v > 0) await redis.hincrby(key, f, -v);
      try {
        await upsertDelivery(db, creativeId, day, d);
        rows++;
      } catch (e) {
        for (const [f, v] of Object.entries(d)) if (v > 0) await redis.hincrby(key, f, v);
        throw e;
      }
    }
  } while (cursor !== '0');
  return { keys, rows };
}

async function upsertDelivery(db: Db, creativeId: string, day: string, d: { s: number; v: number; c: number; i: number; r: number }): Promise<void> {
  const t = schema.adDeliveryDaily;
  // visível e clique nunca passam de servidas (restrição do banco): na dúvida, sub-conta
  const v = Math.min(d.v, d.s);
  const c = Math.min(d.c, d.s);
  await db
    .insert(t)
    .values({ id: `${creativeId}@${day}`, criativoId: creativeId, dia: day, servidas: d.s, visiveis: v, cliques: c, ignoradasBotInterno: d.i, refreshSuprimido: d.r })
    .onConflictDoUpdate({
      target: [t.criativoId, t.dia],
      set: {
        servidas: sql`${t.servidas} + ${d.s}`,
        visiveis: sql`LEAST(${t.visiveis} + ${d.v}, ${t.servidas} + ${d.s})`,
        cliques: sql`LEAST(${t.cliques} + ${d.c}, ${t.servidas} + ${d.s})`,
        ignoradasBotInterno: sql`${t.ignoradasBotInterno} + ${d.i}`,
        refreshSuprimido: sql`${t.refreshSuprimido} + ${d.r}`,
        atualizadoEm: new Date(),
      },
    });
}

/** Só para testes: leitura dos contadores de um criativo no dia. */
export async function readCounters(redis: AdRedis, creativeId: string, day: string): Promise<Record<string, number>> {
  const h = await redis.hgetall(adKeys.cnt(creativeId, day));
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
}

