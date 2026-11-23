import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_CALLBACK_TTL_MS, RedisCallbackStore, RedisHealthStore, type RedisLike } from '../redis-stores';

/** Fake com a semântica de SET NX PX / GET que o adaptador usa (a prova contra Redis real está em redis.integration.test.ts). */
class FakeRedis implements RedisLike {
  readonly data = new Map<string, { v: string; ttl: number }>();
  async set(key: string, value: string, _mode: 'PX', ttlMs: number, flag?: 'NX'): Promise<'OK' | null> {
    if (flag === 'NX' && this.data.has(key)) return null;
    this.data.set(key, { v: value, ttl: ttlMs });
    return 'OK';
  }
  async get(key: string) {
    return this.data.get(key)?.v ?? null;
  }
}

describe('RedisCallbackStore (fake)', () => {
  test('primeira vez true, repetição false; ids diferentes não colidem; prefixo e TTL aplicados', async () => {
    const r = new FakeRedis();
    const s = new RedisCallbackStore(r, { prefix: 'p:' });
    assert.equal(await s.firstSeen('a'), true);
    assert.equal(await s.firstSeen('a'), false);
    assert.equal(await s.firstSeen('b'), true);
    assert.deepEqual([...r.data.keys()].sort(), ['p:a', 'p:b']);
    assert.equal(r.data.get('p:a')?.ttl, DEFAULT_CALLBACK_TTL_MS);
  });

  test('TTL menor que 2x a janela de assinatura é recusado (replay dentro da janela passaria)', () => {
    const r = new FakeRedis();
    for (const ttlMs of [0, 1000, 599_999, 1.5, Number.NaN]) {
      assert.throws(() => new RedisCallbackStore(r, { ttlMs }), /ttl do callbackId/, String(ttlMs));
    }
    assert.doesNotThrow(() => new RedisCallbackStore(r, { ttlMs: 600_000 }));
  });
});

describe('RedisHealthStore (fake)', () => {
  test('grava e lê o último pull; vazio e valor corrompido devolvem null', async () => {
    const r = new FakeRedis();
    const s = new RedisHealthStore(r, { key: 'k' });
    assert.equal(await s.last(), null);
    await s.markPull('w1', new Date('2026-11-23T12:00:00.000Z'));
    assert.deepEqual(await s.last(), { workerId: 'w1', at: '2026-11-23T12:00:00.000Z' });
    await r.set('k', 'não é json', 'PX', 1000);
    assert.equal(await s.last(), null);
    await r.set('k', JSON.stringify({ workerId: 1, at: 2 }), 'PX', 1000);
    assert.equal(await s.last(), null);
  });
});
