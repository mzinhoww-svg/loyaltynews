// Processo de workers (build: dist/index.js; `node dist/index.js`). Ambiente: DATABASE_URL, REDIS_URL (obrigatórios).
import { drizzle } from 'drizzle-orm/node-postgres';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import { anyPemSet, pgPoolConfig, selfCheckPemSet } from '@ln/db/tls';
import type { Db } from '@ln/auth';
import { flushAdDelivery, type AdRedis } from './ad-redis';
import { handlers } from './handlers';
import { redisTlsOptions } from './redis-tls';
import { BullQueueSink, startReconciler, startWorkers } from './runtime';

async function main() {
  const { DATABASE_URL, REDIS_URL } = process.env;
  if (!DATABASE_URL || !REDIS_URL) {
    console.error('[workers] DATABASE_URL e REDIS_URL são obrigatórios');
    process.exit(1);
  }
  // Confere os PEM de verdade ANTES de conectar e diz QUAL variável falhou (só nomes, classes de erro e fatos estruturais; nunca o conteúdo).
  // Falha = o processo sai com a causa clara em vez de repetir "no start line" a cada tentativa de conexão.
  let tlsOk = true;
  for (const [prefix, active] of [['DB_SSL', anyPemSet(process.env, 'DB_SSL')], ['REDIS_SSL', anyPemSet(process.env, 'REDIS_SSL') || REDIS_URL.startsWith('rediss:')]] as const) {
    if (!active) continue;
    const r = selfCheckPemSet(process.env, prefix);
    for (const l of r.lines) console.log(`[workers] TLS ${r.ok ? '' : 'PROBLEMA: '}${l}`);
    if (!r.ok) tlsOk = false;
  }
  if (!tlsOk) {
    console.error('[workers] TLS inválido: veja as linhas "TLS PROBLEMA" acima (variável, erro e formato recebido)');
    process.exit(1);
  }
  let poolConfig: ReturnType<typeof pgPoolConfig>;
  let redisTls: ReturnType<typeof redisTlsOptions>;
  try {
    poolConfig = pgPoolConfig(process.env, { max: 8 }); // TLS + certificado de cliente (DB_SSL_*_PEM)
    redisTls = redisTlsOptions(process.env); // rediss:// + REDIS_SSL_*_PEM
  } catch (e) {
    console.error(`[workers] configuração de TLS inválida: ${e instanceof Error ? e.message : 'erro'}`);
    process.exit(1);
  }
  const pool = new Pool(poolConfig);
  const db = drizzle(pool, { schema }) as unknown as Db;
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, ...redisTls }); // exigido pelo BullMQ nos workers

  const sink = new BullQueueSink(connection);
  const workers = startWorkers({ connection, db, handlers });
  const reconciler = startReconciler({
    db,
    sink,
    onResult: (r) => console.log('[workers] reconciliador', JSON.stringify(r)),
    onError: (e) => console.error('[workers] reconciliador falhou:', e instanceof Error ? e.message : 'erro'),
  });
  // entrega dos anúncios: Redis → ad_delivery_daily a cada minuto (sub-conta em caso de falha, nunca infla)
  const adFlush = setInterval(() => {
    flushAdDelivery(connection as unknown as AdRedis, db)
      .then((r) => { if (r.rows) console.log('[workers] entrega de anúncios gravada', JSON.stringify(r)); })
      .catch((e) => console.error('[workers] flush de anúncios falhou:', e instanceof Error ? e.message : 'erro'));
  }, 60_000);
  console.log(`[workers] no ar; filas com handler: ${workers.workers.length}`);

  const stop = async () => {
    reconciler.stop();
    clearInterval(adFlush);
    await workers.close();
    await sink.close();
    connection.disconnect();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

void main();
