// Processo de workers (build: dist/index.js; `node dist/index.js`). Ambiente: DATABASE_URL, REDIS_URL (obrigatórios).
import { drizzle } from 'drizzle-orm/node-postgres';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { flushAdDelivery, type AdRedis } from './ad-redis';
import { handlers } from './handlers';
import { BullQueueSink, startReconciler, startWorkers } from './runtime';

async function main() {
  const { DATABASE_URL, REDIS_URL } = process.env;
  if (!DATABASE_URL || !REDIS_URL) {
    console.error('[workers] DATABASE_URL e REDIS_URL são obrigatórios');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }); // exigido pelo BullMQ nos workers

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
