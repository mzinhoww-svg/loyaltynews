// Conexão Redis do processo web (dedupe e contadores do ad server). Sem REDIS_URL: null (o ad server então serve
// sem contar: sub-contar, nunca inflar). Falhas são rápidas: sem fila offline, 1 tentativa por comando.
import type { AdRedis } from '@ln/workers/ad-redis';
import { redisTlsOptions } from '@ln/workers/redis-tls';

const KEY = Symbol.for('ln.web.redis');
type G = typeof globalThis & { [KEY]?: AdRedis | null };

export async function getAdRedis(env: Record<string, string | undefined> = process.env): Promise<AdRedis | null> {
  const g = globalThis as G;
  if (g[KEY] !== undefined) return g[KEY] ?? null;
  const url = env.REDIS_URL;
  if (!url) {
    g[KEY] = null;
    return null;
  }
  let tls: ReturnType<typeof redisTlsOptions>;
  try {
    tls = redisTlsOptions(env); // rediss:// + REDIS_SSL_*_PEM (Vertra: TLS com certificado de cliente)
  } catch (e) {
    console.error(`[redis] TLS inválido: ${e instanceof Error ? e.message : 'erro'}`); // sem segredo; o ad server sub-conta
    g[KEY] = null;
    return null;
  }
  const { default: IORedis } = await import('ioredis');
  const r = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500, lazyConnect: false, ...tls });
  r.on('error', () => undefined); // erro de conexão não derruba o processo; cada comando rejeita e o ad server sub-conta
  g[KEY] = r as unknown as AdRedis;
  return g[KEY];
}
