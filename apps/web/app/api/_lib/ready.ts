// /api/ready: prontidão real (banco e Redis respondem), separada de /api/health (processo vivo).
// APP_MODE=nodb: o site sobe sem banco/Redis (staging só de site); o corpo diz isso explicitamente.
import { sql } from 'drizzle-orm';
import type { Db } from '@ln/auth';

export interface ReadyReport {
  status: 'ok' | 'indisponivel';
  mode: 'completo' | 'nodb';
  db: 'ok' | 'falha' | 'nao_configurado' | 'n/a';
  redis: 'ok' | 'falha' | 'nao_configurado' | 'n/a';
}

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

export async function readiness(env: Record<string, string | undefined>, probes: ReadyProbes): Promise<ReadyReport> {
  if (env.APP_MODE === 'nodb') return { status: 'ok', mode: 'nodb', db: 'n/a', redis: 'n/a' };
  const [db, redis] = await Promise.all([probe(probes.db), probe(probes.redis)]);
  return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'indisponivel', mode: 'completo', db, redis };
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
