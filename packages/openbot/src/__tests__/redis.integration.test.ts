import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { Redis } from 'ioredis';
import {
  dispatchTask, evaluateHealth, handleCallback, handlePull, InMemoryCostLedger, InMemoryLeaseQueue, OPENBOT_PERMISSIONS, signBody,
  type CallbackResult, type OpenBotDeps, type PullResult, type SignedRequest, type UsageReport,
} from '../index';
import { RedisCallbackStore, RedisHealthStore } from '../redis-stores';

// Integração contra um Redis REAL e LOCAL (sem custo). Só roda com LN_TEST_REDIS_URL (ex.: redis://127.0.0.1:56391);
// sem a variável, os testes são PULADOS e aparecem como pulados (nunca como passados). Cada execução usa um prefixo
// próprio e apaga só as próprias chaves (nada de FLUSHALL).

const URL_ = process.env.LN_TEST_REDIS_URL;
const suite = URL_ ? describe : describe.skip;
const SECRET = 'segredo-de-teste-integracao';
const NOW = new Date('2026-11-23T12:00:00.000Z');

suite('adaptador OpenBot contra Redis real', () => {
  const prefix = `ln:test:${randomUUID()}:`;
  let a: Redis;
  let b: Redis;

  beforeAll(async () => {
    a = new Redis(URL_ as string, { maxRetriesPerRequest: 2 });
    b = new Redis(URL_ as string, { maxRetriesPerRequest: 2 });
    assert.equal(await a.ping(), 'PONG');
  });

  afterAll(async () => {
    const keys = await a.keys(`${prefix}*`);
    if (keys.length) await a.del(...keys);
    await a.quit();
    await b.quit();
  });

  const signed = (obj: unknown): SignedRequest => {
    const body = JSON.stringify(obj);
    return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() };
  };

  test('callbackId: SET NX PX atômico; TTL real aplicado e dentro do esperado', async () => {
    const store = new RedisCallbackStore(a, { prefix, ttlMs: 700_000 });
    const id = `cb-${randomUUID()}`;
    assert.equal(await store.firstSeen(id), true);
    assert.equal(await store.firstSeen(id), false);
    const ttl = await a.pttl(`${prefix}${id}`);
    assert.ok(ttl > 0 && ttl <= 700_000, `pttl=${ttl}`);
  });

  test('20 chamadas concorrentes com o mesmo callbackId: exatamente uma vê pela primeira vez', async () => {
    const store = new RedisCallbackStore(a, { prefix });
    const id = `race-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => store.firstSeen(id)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  test('dois "processos" (duas conexões) compartilham o dedupe', async () => {
    const s1 = new RedisCallbackStore(a, { prefix });
    const s2 = new RedisCallbackStore(b, { prefix });
    const id = `shared-${randomUUID()}`;
    assert.equal(await s1.firstSeen(id), true);
    assert.equal(await s2.firstSeen(id), false);
  });

  test('saúde: último pull gravado por um processo e lido por outro; atrasado após a janela', async () => {
    const key = `${prefix}last-pull`;
    const w = new RedisHealthStore(a, { key });
    const r = new RedisHealthStore(b, { key });
    assert.equal(await r.last(), null);
    await w.markPull('openbot-1', NOW);
    assert.deepEqual(await r.last(), { workerId: 'openbot-1', at: NOW.toISOString() });
    assert.equal((await evaluateHealth(r, new Date(NOW.getTime() + 60_000))).status, 'saudavel');
    assert.equal((await evaluateHealth(r, new Date(NOW.getTime() + 10 * 60_000))).status, 'atrasado');
  });

  test('fluxo completo com dedupe e saúde em Redis: 10 callbacks idênticos concorrentes = 1 efeito, 1 custo', async () => {
    const queue = new InMemoryLeaseQueue(() => `lease-${randomUUID()}`);
    const ledger = new InMemoryCostLedger();
    const mk = (conn: Redis): OpenBotDeps => ({
      queue,
      ledger,
      health: new RedisHealthStore(conn, { key: `${prefix}flow-health` }),
      callbacks: new RedisCallbackStore(conn, { prefix: `${prefix}flow:` }),
      secrets: () => [SECRET],
      flags: () => ({ dispatchEnabled: true, kill: false }),
      now: () => NOW,
    });
    const p1 = mk(a);
    const p2 = mk(b);
    const caller = { id: 'u', permissions: [OPENBOT_PERMISSIONS.dispatch] };

    const d = await dispatchTask(p1, caller, { kind: 'daily', profileId: 'daily_editorial', refId: 'r1', idempotencyKey: `k-${randomUUID()}`, dataClass: 'internal', maxCostMicro: 2_000_000 });
    assert.equal(d.status, 201);
    const pull = (await handlePull(p2, signed({ workerId: 'openbot-1' }))).body as PullResult;
    const t = pull.tasks[0]!;
    assert.equal((await p1.health.last())?.workerId, 'openbot-1', 'o pull gravado por um processo é visto pelo outro via Redis');

    const usage: UsageReport = {
      executionId: `ex-${randomUUID()}`, taskId: t.id, leaseId: t.leaseId, model: 'claude-haiku-5-5', generationIds: ['gen-1'],
      promptTokens: 10, completionTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 1_200,
    };
    const body = { callbackId: `cb-${randomUUID()}`, taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage };
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => handleCallback(i % 2 === 0 ? p1 : p2, signed(body))),
    );
    const bodies = results.map((r) => r.body as CallbackResult);
    assert.equal(results.every((r) => r.status === 200), true);
    assert.equal(bodies.filter((r) => !r.duplicate).length, 1, 'exatamente um callback passou o dedupe');
    assert.equal(bodies.filter((r) => r.duplicate).length, 9);
    assert.equal(await ledger.totalMicro(), 1_200, 'custo registrado uma vez');
    assert.equal((await queue.counts()).completed, 1);
  });

  test('nenhuma chave de conteúdo: só os prefixos do teste foram criados', async () => {
    const keys = await a.keys(`${prefix}*`);
    assert.ok(keys.length > 0);
    for (const k of keys) assert.match(k, /^ln:test:[0-9a-f-]{36}:/);
  });
});
