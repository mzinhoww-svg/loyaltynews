import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { InMemoryPackageStore, type ArticleSource, type DashboardDeps } from '../dashboard';
import { DEFAULT_FLAGS } from '../flags';
import { SimulatedGateway } from '../jobs/gateway.mock';
import {
  createSocialPackageWorker, enqueueSocialPackage, NonRetryableError, parseSocialPayload, processSocialPackageJob,
  SOCIAL_JOB_OPTIONS, SOCIAL_PACKAGE_JOB, SOCIAL_QUEUE, socialJobId, socialPackageKey,
  type BullmqLike, type SocialJobDeps,
} from '../jobs';
import { SimulatedMlabsAdapter } from '../mlabs/simulated.mock';
import { SocialPublisher } from '../publisher/publisher';
import type { Article } from '../types';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

const now = () => '2026-11-22T12:00:00.000Z';

class MapSource implements ArticleSource {
  items = new Map<string, Article>([[MOCK_ARTICLE.id, MOCK_ARTICLE]]);
  async get(id: string) {
    const a = this.items.get(id);
    return a ? structuredClone(a) : null;
  }
}

function make() {
  const adapter = new SimulatedMlabsAdapter(now);
  const gateway = new SimulatedGateway();
  const dashboard: DashboardDeps = {
    store: new InMemoryPackageStore(),
    articles: new MapSource(),
    adapter,
    publisher: new SocialPublisher({ adapter, now }),
    flags: DEFAULT_FLAGS,
    now,
  };
  const deps: SocialJobDeps = { dashboard, gateway, now: () => new Date('2026-11-22T12:00:00Z') };
  return { deps, gateway, adapter, dashboard };
}

const payloadFor = (id: string, v = 1) => ({ refId: id, idempotencyKey: socialPackageKey(id, v) });

describe('job de pacote social: definição', () => {
  test('convenções do Backend: fila social, jobId sem ":", opções padrão, payload só com IDs', () => {
    assert.equal(SOCIAL_QUEUE, 'social');
    assert.equal(SOCIAL_PACKAGE_JOB, 'social.package.generate');
    assert.equal(socialJobId('a__social-package__v1'), 'social__a__social-package__v1');
    assert.equal(socialJobId(socialPackageKey('MOCK-2026-0001')).includes(':'), false);
    assert.equal(SOCIAL_JOB_OPTIONS.attempts, 5);
    assert.deepEqual(SOCIAL_JOB_OPTIONS.backoff, { type: 'exponential', delay: 2000 });
    assert.equal(SOCIAL_JOB_OPTIONS.removeOnFail, false);
    assert.deepEqual(parseSocialPayload(payloadFor('a1')), payloadFor('a1'));
  });

  test('payload com conteúdo, campo extra ou ID inválido é rejeitado (não retentável)', () => {
    for (const bad of [
      { refId: 'a1', idempotencyKey: 'k', corpo: 'texto da matéria' },
      { refId: 'com espaço', idempotencyKey: 'k' },
      { refId: 'x'.repeat(200), idempotencyKey: 'k' },
      { refId: 'a1' },
      null,
      [],
      'texto',
    ]) {
      assert.throws(() => parseSocialPayload(bad), (e: unknown) => e instanceof NonRetryableError);
    }
  });

  test('enqueue: jobId determinístico; repetir não duplica (fila fake que dedupe por jobId)', async () => {
    const jobs = new Map<string, { name: string; data: unknown; opts: Record<string, unknown> }>();
    const queue = {
      async add(name: string, data: unknown, opts: Record<string, unknown>) {
        const id = String(opts.jobId);
        if (!jobs.has(id)) jobs.set(id, { name, data: data as never, opts });
        return { id };
      },
    };
    const a = await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id);
    const b = await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id);
    assert.equal(a.jobId, b.jobId);
    assert.equal(jobs.size, 1);
    const job = [...jobs.values()][0]!;
    assert.equal(job.name, SOCIAL_PACKAGE_JOB);
    assert.deepEqual(job.data, payloadFor(MOCK_ARTICLE.id));
    assert.equal(job.opts.attempts, 5);
    assert.equal(JSON.stringify(job.data).includes('Programa Exemplo'), false, 'sem conteúdo da matéria no Redis');
    await enqueueSocialPackage(queue as never, MOCK_ARTICLE.id, 2);
    assert.equal(jobs.size, 2);
  });
});

describe('job de pacote social: processamento', () => {
  let c: ReturnType<typeof make>;
  beforeEach(() => {
    c = make();
  });

  test('gera LinkedIn + Instagram, consulta o gateway nas duas tarefas determinísticas e não gasta modelo', async () => {
    const r = await processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id));
    assert.deepEqual(r.created.sort(), ['MOCK-2026-0001:instagram:v1', 'MOCK-2026-0001:linkedin:v1']);
    assert.deepEqual(c.gateway.calls.map((x) => x.task), ['creative_composition', 'social_publish']);
    assert.equal(r.modelCostUsd, 0);
    assert.equal((await c.dashboard.store.all()).length, 2);
  });

  test('o job não publica: nenhum recibo, nada no adaptador', async () => {
    await processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id));
    assert.equal(c.adapter.count, 0);
    assert.ok((await c.dashboard.store.all()).every((r) => r.receipts.length === 0));
    assert.equal(c.dashboard.publisher.audit.length, 0);
  });

  test('reprocessar a mesma chave é idempotente: existing, sem duplicar', async () => {
    await processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id));
    const r2 = await processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id));
    assert.equal(r2.created.length, 0);
    assert.equal(r2.existing.length, 2);
    assert.equal((await c.dashboard.store.all()).length, 2);
  });

  test('a versão vem da chave de idempotência', async () => {
    const r = await processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id, 3));
    assert.ok(r.created.every((id) => id.endsWith(':v3')));
  });

  test('gateway bloqueado (kill switch): falha fechada, não retentável, nada gerado', async () => {
    c.gateway.killGlobal = true;
    await assert.rejects(() => processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id)), (e: unknown) => {
      return e instanceof NonRetryableError && e.message.includes('kill_global');
    });
    assert.equal((await c.dashboard.store.all()).length, 0);
  });

  test('gateway que devolve rota com modelo é recusado (pacote social é determinístico)', async () => {
    const gw = { decide: async () => ({ status: 'model' as const, model: 'm' }) };
    await assert.rejects(
      () => processSocialPackageJob({ ...c.deps, gateway: gw }, payloadFor(MOCK_ARTICLE.id)),
      (e: unknown) => e instanceof NonRetryableError,
    );
  });

  test('matéria inexistente: não retentável', async () => {
    await assert.rejects(() => processSocialPackageJob(c.deps, payloadFor('nao-existe')), (e: unknown) => {
      return e instanceof NonRetryableError && e.message.includes('não encontrada');
    });
  });

  test('falha de infraestrutura (armazenamento) é retentável: propaga o erro original', async () => {
    c.dashboard.store.put = async () => {
      throw new Error('banco indisponível');
    };
    await assert.rejects(() => processSocialPackageJob(c.deps, payloadFor(MOCK_ARTICLE.id)), (e: unknown) => {
      return e instanceof Error && !(e instanceof NonRetryableError) && e.message === 'banco indisponível';
    });
  });

  test('matéria que viola regra de copy gera registro falhou (job conclui, sem retry infinito)', async () => {
    (c.dashboard.articles as MapSource).items.set('A-2027', { ...MOCK_ARTICLE, id: 'A-2027', title: 'Regra em 2027', facts: [{ text: 'Regra muda.', source: 's' }] });
    const r = await processSocialPackageJob(c.deps, payloadFor('A-2027'));
    assert.equal(r.failed.length, 2);
    assert.equal(r.created.length, 0);
  });
});

describe('worker BullMQ (estrutural, sem Redis)', () => {
  class UnrecoverableError extends Error {}
  function fakeBullmq() {
    const created: { queue: string; processor: (job: { name: string; data: unknown }) => Promise<unknown>; opts: { connection: unknown; concurrency: number } }[] = [];
    const bullmq: BullmqLike = {
      Worker: class {
        constructor(queue: string, processor: (job: { name: string; data: unknown }) => Promise<unknown>, opts: { connection: unknown; concurrency: number }) {
          created.push({ queue, processor, opts });
        }
      },
      UnrecoverableError,
    };
    return { bullmq, created };
  }

  test('worker na fila social com concorrência 2 e a conexão injetada', () => {
    const { bullmq, created } = fakeBullmq();
    const conn = { fake: true };
    createSocialPackageWorker(bullmq, conn, make().deps);
    assert.equal(created[0]!.queue, 'social');
    assert.equal(created[0]!.opts.concurrency, 2);
    assert.equal(created[0]!.opts.connection, conn);
  });

  test('o processador roda o job; erro não retentável vira UnrecoverableError; job desconhecido também', async () => {
    const { bullmq, created } = fakeBullmq();
    const c = make();
    createSocialPackageWorker(bullmq, {}, c.deps);
    const proc = created[0]!.processor;
    const res = (await proc({ name: SOCIAL_PACKAGE_JOB, data: payloadFor(MOCK_ARTICLE.id) })) as { created: string[] };
    assert.equal(res.created.length, 2);
    await assert.rejects(() => proc({ name: SOCIAL_PACKAGE_JOB, data: payloadFor('nao-existe') }), UnrecoverableError);
    await assert.rejects(() => proc({ name: SOCIAL_PACKAGE_JOB, data: { refId: 'a', idempotencyKey: 'k', extra: 1 } }), UnrecoverableError);
    await assert.rejects(() => proc({ name: 'outro.job', data: {} }), UnrecoverableError);
  });

  test('erro de infraestrutura NÃO vira UnrecoverableError (BullMQ vai retentar)', async () => {
    const { bullmq, created } = fakeBullmq();
    const c = make();
    c.dashboard.store.all = async () => {
      throw new Error('x');
    };
    c.dashboard.store.put = async () => {
      throw new Error('redis/db fora');
    };
    createSocialPackageWorker(bullmq, {}, c.deps);
    await assert.rejects(() => created[0]!.processor({ name: SOCIAL_PACKAGE_JOB, data: payloadFor(MOCK_ARTICLE.id) }), (e: unknown) => {
      return e instanceof Error && !(e instanceof UnrecoverableError) && e.message === 'redis/db fora';
    });
  });
});
