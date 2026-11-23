// /api/ready: prontidão real (banco e Redis respondem), separada de /api/health (processo vivo).
// APP_MODE=nodb: o site sobe sem banco/Redis (staging só de site); o corpo diz isso explicitamente.
import { sql } from 'drizzle-orm';
import type { Db } from '@ln/auth';
import { anyPemSet, selfCheckPemSet } from '@ln/db/tls';
import { redisTlsFromEnv } from '@ln/workers/redis-tls';

export interface ReadyReport {
  status: 'ok' | 'indisponivel';
  mode: 'completo' | 'nodb';
  db: 'ok' | 'falha' | 'nao_configurado' | 'n/a';
  redis: 'ok' | 'falha' | 'nao_configurado' | 'n/a';
  /** TLS dos certificados lidos do ambiente (sem abrir conexão): só um estado por grupo, sem nome de variável, código do OpenSSL nem formato (o detalhe vai ao log do processo). */
  tls: { db: TlsState; redis: TlsState };
}

export type TlsState = 'ok' | 'invalido' | 'nao_configurado' | 'n/a';

export interface ReadyProbes {
  db?: () => Promise<void>;
  redis?: () => Promise<void>;
}

async function probe(fn: (() => Promise<void>) | undefined): Promise<'ok' | 'falha' | 'nao_configurado'> {
  if (!fn) return 'nao_configurado';
  try {
    await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
    return 'ok';
  } catch {
    return 'falha';
  }
}

const tlsCache = new WeakMap<object, { db: TlsState; redis: TlsState }>();

/**
 * Confere os PEM do ambiente com o OpenSSL do Node (certificado, chave e o par), UMA vez por processo (o ambiente não muda depois do boot): só leitura de
 * variáveis, nenhuma conexão nova. O detalhe (variável, código, formato) vai ao log do processo; o retorno público é só `ok` ou `invalido`.
 */
export function tlsState(env: Record<string, string | undefined>): { db: TlsState; redis: TlsState } {
  const hit = tlsCache.get(env);
  if (hit) return hit;
  const log = (grupo: string, lines: string[]) => console.error(`[ready] TLS ${grupo} INVÁLIDO: ${lines.filter((l) => /FALHA|FALHOU|AUSENTE/.test(l)).join(' | ')}`);
  let db: TlsState;
  if (env.DB_SSL_MODE === 'disable') db = 'n/a';
  else if (!anyPemSet(env, 'DB_SSL')) db = env.NODE_ENV === 'production' || env.DB_SSL_MODE === 'verify-full' ? 'invalido' : 'nao_configurado';
  else {
    const r = selfCheckPemSet(env, 'DB_SSL');
    if (!r.ok) log('do banco', r.lines);
    db = r.ok ? 'ok' : 'invalido';
  }
  let redis: TlsState;
  try {
    const t = redisTlsFromEnv(env); // lança se o TLS exigido está ausente ou mal formado
    if (!t) redis = env.REDIS_URL ? 'n/a' : 'nao_configurado';
    else {
      const r = selfCheckPemSet(env, 'REDIS_SSL');
      if (!r.ok) log('do redis', r.lines);
      redis = r.ok ? 'ok' : 'invalido';
    }
  } catch {
    console.error('[ready] TLS do redis INVÁLIDO: configuração ausente ou mal formada (REDIS_URL/REDIS_SSL_*)');
    redis = 'invalido';
  }
  const out = { db, redis };
  tlsCache.set(env, out);
  return out;
}

export async function readiness(env: Record<string, string | undefined>, probes: ReadyProbes): Promise<ReadyReport> {
  if (env.APP_MODE === 'nodb') return { status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a', tls: { db: 'n/a', redis: 'n/a' } };
  const tls = tlsState(env);
  const [db, redis] = await Promise.all([probe(probes.db), probe(probes.redis)]);
  // TLS inválido derruba a prontidão (503), com ou sem sonda: o processo não está apto a falar com o banco/Redis
  const tlsRuim = tls.db === 'invalido' || tls.redis === 'invalido';
  return { status: db === 'ok' && redis === 'ok' && !tlsRuim ? 'ok' : 'indisponivel', mode: 'completo', db, redis, tls };
}

export const dbProbe = (db: Db) => async () => {
  await db.execute(sql`select 1`);
};

/** Ping no Redis da URL de ambiente; sem REDIS_URL, sem sonda (nao_configurado). */
export function redisProbe(env: Record<string, string | undefined>): (() => Promise<void>) | undefined {
  const url = env.REDIS_URL;
  if (!url) return undefined;
  return async () => {
    const { default: IORedis } = await import('ioredis');
    const { redisTlsOptions } = await import('@ln/workers/redis-tls');
    const r = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1500, ...redisTlsOptions(env) }); // TLS inválido ⇒ a sonda falha (indisponível), sem segredo
    try {
      await r.connect();
      await r.ping();
    } finally {
      r.disconnect();
    }
  };
}
