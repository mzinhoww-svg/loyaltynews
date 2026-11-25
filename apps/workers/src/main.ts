// Processo de workers (build: dist/index.js; `node dist/index.js`). Ambiente: DATABASE_URL, REDIS_URL (obrigatórios).
import { drizzle } from 'drizzle-orm/node-postgres';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import { anyPemSet, pgPoolConfig, selfCheckPemSet } from '@ln/db/tls';
import { errLine, installOutputFilter, installProcessGuards, onClientError } from '@ln/db/safe-log';
import type { Db } from '@ln/auth';
import { flushAdDelivery, type AdRedis } from './ad-redis';
import { describeHeartbeat, startAdRedisWatch, type HeartbeatRedis } from './ad-redis-watch';
import type { Db as IntelDb } from '@ln/intelligence';
import { handlers } from './handlers';
import { redisTlsOptions } from './redis-tls';
import { startIntelligenceAlerts } from './intelligence-alerts';
import { startLeadRetention } from './lead-retention';
import { workerFlagResolver } from './worker-flags';
import { startIntelligenceReread } from './intelligence-reread';
import { BullQueueSink, startReconciler, startWorkers } from './runtime';

// Incidente de 23/11: nenhum erro de conexão pode sair com o objeto inteiro (ca/cert/key do TLS). C4: filtro de PEM na saída; C2: rejeição/exceção sem tratamento sai com 1.
installOutputFilter();
installProcessGuards();

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
    console.error(errLine('[workers] configuração de TLS inválida', e));
    process.exit(1);
  }
  const pool = new Pool(poolConfig);
  pool.on('error', onClientError('[workers] pg (conexão ociosa)')); // C1: sem ouvinte o Node imprime o erro inteiro, com o objeto do TLS
  const db = drizzle(pool, { schema }) as unknown as Db;
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, ...redisTls }); // exigido pelo BullMQ nos workers
  connection.on('error', onClientError('[workers] redis'));

  const sink = new BullQueueSink(connection);
  const workers = startWorkers({ connection, db, handlers });
  const reconciler = startReconciler({
    db,
    sink,
    onResult: (r) => console.log('[workers] reconciliador', JSON.stringify(r)),
    onError: (e) => console.error(errLine('[workers] reconciliador falhou', e)),
  });
  // entrega dos anúncios: Redis → ad_delivery_daily a cada minuto (sub-conta em caso de falha, nunca infla)
  const adFlush = setInterval(() => {
    flushAdDelivery(connection as unknown as AdRedis, db)
      .then((r) => { if (r.rows) console.log('[workers] entrega de anúncios gravada', JSON.stringify(r)); })
      .catch((e) => console.error(errLine('[workers] flush de anúncios falhou', e)));
  }, 60_000);
  // auditoria de perda do Redis do ad server (C1): batida ln:ad:hb a cada minuto + espelho no PostgreSQL; perda/regressão/indisponibilidade abre lacuna.
  // Conexão PRÓPRIA e sem fila offline: com Redis fora, o comando falha rápido (a conexão do BullMQ espera para sempre) e isso conta como indisponibilidade.
  const hbRedis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500, ...redisTls });
  hbRedis.on('error', onClientError('[workers] redis (batida do ad server)'));
  // sem fila offline o comando falha enquanto a conexão não está pronta: espera até 3 s para a subida não parecer indisponibilidade do Redis
  await new Promise<void>((resolve) => { const t = setTimeout(resolve, 3000); hbRedis.once('ready', () => { clearTimeout(t); resolve(); }); });
  const adWatch = startAdRedisWatch({
    db,
    redis: hbRedis as unknown as HeartbeatRedis,
    onResult: (r) => { if (r.state !== 'healthy') console.log('[workers] auditoria do dedupe de anúncios:', describeHeartbeat(r)); },
    onError: (e) => console.error(errLine('[workers] batida do ad server falhou', e)),
  });
  // releitura das páginas oficiais de diretoria (Intelligence): DESLIGADA por padrão; só liga com LN_INTELLIGENCE_REREAD=on, LN_REREAD_SEED e a flag intelligencePessoas (ADR-022)
  const intelDbPort = { query: async (sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows }) } as unknown as IntelDb;
  // flags de produto pelo resolvedor da ADR-022 (o mesmo do web): releitura exige intelligencePessoas; reserva por provedor exige leitorViaProvedor
  const flags = workerFlagResolver(process.env);
  const reread = startIntelligenceReread({ db: intelDbPort, flags });
  // alertas das watchlists quando um Move é confirmado: DESLIGADO por padrão (LN_INTELLIGENCE_ALERTS=on e a flag intelligencePessoas pelo resolvedor)
  const alerts = startIntelligenceAlerts({ db: intelDbPort, flags });
  // retenção do lead descartado (LGPD): na subida e uma vez por dia; sem LN_LEAD_AUDIT_SALT não apaga e avisa
  const leadRetention = startLeadRetention({ db });
  console.log(`[workers] no ar; filas com handler: ${workers.workers.length}`);

  const stop = async () => {
    reconciler.stop();
    reread?.stop();
    alerts?.stop();
    leadRetention?.stop();
    clearInterval(adFlush);
    adWatch.stop();
    hbRedis.disconnect();
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
