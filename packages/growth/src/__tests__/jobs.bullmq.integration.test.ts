import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { Queue, QueueEvents, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { InMemoryPackageStore, type ArticleSource, type DashboardDeps } from '../dashboard';
import { DEFAULT_FLAGS } from '../flags';
import { SimulatedGateway } from '../jobs/gateway.mock';
import {
  createSocialPackageWorker, enqueueSocialPackage, SOCIAL_JOB_OPTIONS, SOCIAL_PACKAGE_JOB, SOCIAL_QUEUE, socialJobId, socialPackageKey,
  type SocialJobDeps, type SocialJobResult,
} from '../jobs';
import { createSocialPublisher } from '../publisher/publisher';
import type { Article } from '../types';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// Integração do job social contra BullMQ + Redis REAIS e LOCAIS (sem custo). Só roda com LN_TEST_REDIS_URL
// (ex.: redis://127.0.0.1:56391); sem a variável os testes são PULADOS. Cada execução usa um `prefix` próprio do BullMQ e o
// remove por completo ao final (obliterate só da fila de teste; nada de FLUSHALL).

const URL_ = process.env.LN_TEST_REDIS_URL;
const suite = URL_ ? describe : describe.skip;
const now = () => '2026-11-23T12:00:00.000Z';

class MapSource implements ArticleSource {
  items = new Map<string, Article>([[MOCK_ARTICLE.id, MOCK_ARTICLE]]);
  async get(id: string) {
    const a = this.items.get(id);
    return a ? structuredClone(a) : null;
  }
}

suite('job social contra BullMQ + Redis reais', () => {
  const prefix = `ln-test-${randomUUID().slice(0, 8)}`;
  const connection = { host: '127.0.0.1', port: 56391 };
  let redis: Redis;
  let queue: Queue;
  let events: QueueEvents;
  let worker: Worker | undefined;
  let store: InMemoryPackageStore;
  let gateway: SimulatedGateway;
  let source: MapSource;
  let processed = 0;

  beforeAll(async () => {
    const u = new URL(URL_ as string);
    connection.host = u.hostname;
    connection.port = Number(u.port || 6379);
    redis = new Redis({ ...connection, maxRetriesPerRequest: null });
    queue = new Queue(SOCIAL_QUEUE, { connection: { ...connection }, prefix });
    events = new QueueEvents(SOCIAL_QUEUE, { connection: { ...connection }, prefix });
    await events.waitUntilReady();

    store = new InMemoryPackageStore();
    gateway = new SimulatedGateway();
    source = new MapSource();
    const dashboard: DashboardDeps = {
      store, articles: source, publisher: createSocialPublisher({ mode: 'simulated', now }), flags: DEFAULT_FLAGS, now,
    };
    const deps: SocialJobDeps = { dashboard, gateway, now: () => new Date('2026-11-23T12:00:00Z') };
    // Conta cada execução do processador sem alterar o comportamento do job.
    const countingGateway = { decide: async (r: Parameters<SimulatedGateway['decide']>[0]) => { if (r.task === 'creative_composition') processed += 1; return gateway.decide(r); } };
    worker = createSocialPackageWorker(
      { Worker: Worker as never, UnrecoverableError },
      { ...connection },
      { ...deps, gateway: countingGateway },
      2,
      { prefix },
    ) as Worker;
    await worker.waitUntilReady();
  }, 30_000);

  afterAll(async () => {
    await worker?.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    const left = await redis.keys(`${prefix}:*`);
    if (left.length) await redis.del(...left);
    await redis.quit();
  }, 30_000);

  const finished = (job: Job) => job.waitUntilFinished(events, 20_000);

  test('enqueue grava jobId determinístico e as opções da casa; payload no Redis só tem IDs', async () => {
    const { jobId } = await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id);
    assert.equal(jobId, socialJobId(socialPackageKey(MOCK_ARTICLE.id)));
    const job = (await queue.getJob(jobId))!;
    assert.equal(job.name, SOCIAL_PACKAGE_JOB);
    assert.equal(job.opts.attempts, SOCIAL_JOB_OPTIONS.attempts);
    assert.deepEqual(job.opts.backoff, SOCIAL_JOB_OPTIONS.backoff);
    assert.equal(job.opts.removeOnFail, false);
    const raw = await redis.hget(`${prefix}:${SOCIAL_QUEUE}:${jobId}`, 'data');
    assert.deepEqual(JSON.parse(raw as string), { refId: MOCK_ARTICLE.id, idempotencyKey: socialPackageKey(MOCK_ARTICLE.id) });
    assert.equal((raw as string).includes('Programa Exemplo'), false, 'nenhum conteúdo da matéria no Redis');
    await finished(job);
  });

  test('o worker real processa o job e gera os pacotes (LinkedIn + Instagram), sem publicar', async () => {
    const job = (await queue.getJob(socialJobId(socialPackageKey(MOCK_ARTICLE.id))))!;
    await finished(job);
    const done = (await queue.getJob(job.id as string))!;
    assert.equal(await done.getState(), 'completed');
    const res = done.returnvalue as SocialJobResult;
    assert.deepEqual(res.created.sort(), ['MOCK-2026-0001:instagram:v1', 'MOCK-2026-0001:linkedin:v1']);
    assert.equal(res.modelCostUsd, 0);
    const all = await store.all();
    assert.equal(all.length, 2);
    assert.ok(all.every((r) => r.receipts.length === 0));
  });

  test('reenfileirar a mesma chave enquanto o job existe não duplica nem reprocessa', async () => {
    const before = processed;
    await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id);
    await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(processed, before, 'o job não rodou de novo');
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    assert.equal((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0), 0);
    assert.equal((await store.all()).length, 2);
  });

  test('versão nova da chave é outro job e gera outro conjunto', async () => {
    const { jobId } = await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id, 2);
    await finished((await queue.getJob(jobId))!);
    const ids = (await store.all()).map((r) => r.id).sort();
    assert.ok(ids.includes('MOCK-2026-0001:linkedin:v2'));
    assert.equal(ids.length, 4);
  });

  test('matéria inexistente: erro não retentável vira UnrecoverableError — falha na 1ª tentativa, mesmo com attempts=5', async () => {
    const { jobId } = await enqueueSocialPackage(queue as never, 'nao-existe');
    const job = (await queue.getJob(jobId))!;
    await assert.rejects(() => finished(job), /não encontrada/);
    const failed = (await queue.getJob(jobId))!;
    assert.equal(await failed.getState(), 'failed');
    assert.equal(failed.attemptsMade, 1, 'sem novas tentativas');
    assert.equal((await store.all()).length, 4, 'nada novo gerado');
  });

  test('kill switch do gateway: falha fechada sem tentativas extras e nada gerado', async () => {
    source.items.set('A-KILL', { ...MOCK_ARTICLE, id: 'A-KILL' });
    gateway.killGlobal = true;
    try {
      const { jobId } = await enqueueSocialPackage(queue as never, 'A-KILL');
      await assert.rejects(async () => finished((await queue.getJob(jobId))!), /kill_global/);
      assert.equal((await queue.getJob(jobId))!.attemptsMade, 1);
      assert.equal((await store.all()).some((r) => r.articleId === 'A-KILL'), false);
    } finally {
      gateway.killGlobal = false;
    }
  });

  test('falha de infraestrutura é retentável: BullMQ tenta de novo com backoff e conclui; sem duplicar', async () => {
    source.items.set('A-RETRY', { ...MOCK_ARTICLE, id: 'A-RETRY' });
    const realPut = store.put.bind(store);
    let failures = 0;
    store.put = async (r) => {
      if (r.articleId === 'A-RETRY' && failures < 2) {
        failures += 1;
        throw new Error('banco indisponível (simulado)');
      }
      return realPut(r);
    };
    try {
      const { jobId } = await enqueueSocialPackage(queue as never, 'A-RETRY', 1, { backoff: { type: 'fixed' as never, delay: 50 } as never });
      const res = (await finished((await queue.getJob(jobId))!)) as SocialJobResult;
      const job = (await queue.getJob(jobId))!;
      assert.equal(failures, 2);
      assert.equal(job.attemptsMade, 3, 'duas falhas e um sucesso');
      assert.equal(await job.getState(), 'completed');
      assert.equal(res.articleId, 'A-RETRY');
      const mine = (await store.all()).filter((r) => r.articleId === 'A-RETRY');
      assert.equal(mine.length, 2, 'exatamente um pacote por canal, sem duplicata');
    } finally {
      store.put = realPut;
    }
  });
});
