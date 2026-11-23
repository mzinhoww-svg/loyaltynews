import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { signBody, verifySignature, DEFAULT_TOLERANCE_MS } from '../signing';
import { InMemoryLeaseQueue, LeaseError } from '../lease-queue';
import type { NewTask } from '../types';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const SECRET = 'segredo-de-teste-1';
const OLD = 'segredo-de-teste-0';

describe('assinatura HMAC', () => {
  const body = JSON.stringify({ a: 1 });
  const ts = NOW.getTime();
  const header = signBody(SECRET, ts, body);

  test('assina e confere', () => {
    assert.match(header, /^v1=[0-9a-f]{64}$/);
    assert.deepEqual(verifySignature({ secrets: [SECRET], header, timestampMs: ts, body, now: NOW }), { ok: true, keyIndex: 0 });
  });

  test('segredo errado, corpo adulterado ou timestamp adulterado recusam', () => {
    assert.equal(verifySignature({ secrets: ['outro'], header, timestampMs: ts, body, now: NOW }).ok, false);
    assert.equal(verifySignature({ secrets: [SECRET], header, timestampMs: ts, body: body + ' ', now: NOW }).ok, false);
    assert.equal(verifySignature({ secrets: [SECRET], header, timestampMs: ts + 1, body, now: NOW }).ok, false);
  });

  test('janela de tempo: passado e futuro além da tolerância recusam (anti-replay)', () => {
    const r1 = verifySignature({ secrets: [SECRET], header, timestampMs: ts, body, now: at(DEFAULT_TOLERANCE_MS + 1) });
    assert.deepEqual(r1, { ok: false, reason: 'timestamp_fora_da_janela' });
    const h2 = signBody(SECRET, ts + DEFAULT_TOLERANCE_MS + 5, body);
    assert.deepEqual(verifySignature({ secrets: [SECRET], header: h2, timestampMs: ts + DEFAULT_TOLERANCE_MS + 5, body, now: NOW }), { ok: false, reason: 'timestamp_fora_da_janela' });
    assert.equal(verifySignature({ secrets: [SECRET], header, timestampMs: ts, body, now: at(DEFAULT_TOLERANCE_MS) }).ok, true);
  });

  test('rotação: o segredo anterior ainda vale (keyIndex 1), o atual vale (0)', () => {
    const hOld = signBody(OLD, ts, body);
    assert.deepEqual(verifySignature({ secrets: [SECRET, OLD], header: hOld, timestampMs: ts, body, now: NOW }), { ok: true, keyIndex: 1 });
    assert.deepEqual(verifySignature({ secrets: [SECRET, OLD], header, timestampMs: ts, body, now: NOW }), { ok: true, keyIndex: 0 });
    assert.equal(verifySignature({ secrets: [SECRET], header: hOld, timestampMs: ts, body, now: NOW }).ok, false);
  });

  test('sem segredo configurado, tudo é recusado (falha fechada)', () => {
    assert.deepEqual(verifySignature({ secrets: [], header, timestampMs: ts, body, now: NOW }), { ok: false, reason: 'sem_segredo' });
    assert.deepEqual(verifySignature({ secrets: [''], header, timestampMs: ts, body, now: NOW }), { ok: false, reason: 'sem_segredo' });
  });

  test('formato inválido: sem cabeçalho, versão errada, timestamp ausente, hex malformado ou de tamanho errado', () => {
    for (const [h, t] of [[undefined, ts], ['v2=abc', ts], [header, undefined], [header, Number.NaN]] as const) {
      assert.deepEqual(verifySignature({ secrets: [SECRET], header: h, timestampMs: t, body, now: NOW }), { ok: false, reason: 'formato_invalido' });
    }
    for (const h of ['v1=', 'v1=zz', 'v1=abcd', `v1=${'0'.repeat(63)}`, `v1=${'0'.repeat(66)}`]) {
      assert.equal(verifySignature({ secrets: [SECRET], header: h, timestampMs: ts, body, now: NOW }).ok, false, h);
    }
  });
});

describe('fila com lease (pull)', () => {
  const task = (over: Partial<NewTask> = {}): NewTask => ({
    kind: 'editorial_draft', profileId: 'writer_programas', refId: 'a1', idempotencyKey: 'k1', dataClass: 'public', maxCostMicro: 1_000_000, ...over,
  });
  let n = 0;
  const q = () => new InMemoryLeaseQueue(() => `lease-${++n}`);

  test('enqueue é idempotente pela chave', async () => {
    const queue = q();
    const a = await queue.enqueue(task(), NOW);
    const b = await queue.enqueue(task(), at(1000));
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.task.id, b.task.id);
    assert.equal((await queue.counts()).pending, 1);
  });

  test('claim respeita o limite e nunca entrega a mesma tarefa a dois detentores', async () => {
    const queue = q();
    for (let i = 0; i < 3; i++) await queue.enqueue(task({ idempotencyKey: `k${i}`, refId: `a${i}` }), NOW);
    const w1 = await queue.claim({ workerId: 'w1', now: NOW, leaseMs: 60_000, limit: 2 });
    const w2 = await queue.claim({ workerId: 'w2', now: NOW, leaseMs: 60_000, limit: 5 });
    assert.equal(w1.length, 2);
    assert.equal(w2.length, 1);
    const ids = new Set([...w1, ...w2].map((t) => t.id));
    assert.equal(ids.size, 3);
    assert.deepEqual(await queue.claim({ workerId: 'w3', now: NOW, leaseMs: 60_000, limit: 5 }), []);
  });

  test('o lease entregue só tem IDs e limites (sem conteúdo)', async () => {
    const queue = q();
    await queue.enqueue(task(), NOW);
    const [l] = await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    assert.deepEqual(Object.keys(l!).sort(), ['account', 'attempt', 'dataClass', 'id', 'kind', 'leaseExpiresAt', 'leaseId', 'maxCostMicro', 'profileId', 'refId']);
  });

  test('lease vencido: outra tarefa-detentora pode puxar de novo (tentativa 2); o antigo detentor perde o lease', async () => {
    const queue = q();
    await queue.enqueue(task(), NOW);
    const [first] = await queue.claim({ workerId: 'w1', now: NOW, leaseMs: 1000, limit: 1 });
    assert.deepEqual(await queue.claim({ workerId: 'w2', now: at(500), leaseMs: 1000, limit: 1 }), []);
    const [second] = await queue.claim({ workerId: 'w2', now: at(2000), leaseMs: 1000, limit: 1 });
    assert.equal(second!.attempt, 2);
    assert.notEqual(second!.leaseId, first!.leaseId);
    await assert.rejects(() => queue.complete(first!.id, first!.leaseId, 'r', at(2100)), (e: unknown) => e instanceof LeaseError && e.reason === 'lease_invalida');
    assert.equal((await queue.complete(second!.id, second!.leaseId, 'r', at(2100))).already, false);
  });

  test('heartbeat estende; lease vencido não completa nem renova', async () => {
    const queue = q();
    await queue.enqueue(task(), NOW);
    const [l] = await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    const hb = await queue.heartbeat(l!.id, l!.leaseId, at(900), 1000);
    assert.equal(hb.leaseExpiresAt, at(1900).toISOString());
    assert.deepEqual(await queue.claim({ workerId: 'x', now: at(1500), leaseMs: 1000, limit: 1 }), []);
    await assert.rejects(() => queue.heartbeat(l!.id, l!.leaseId, at(5000), 1000), (e: unknown) => e instanceof LeaseError && e.reason === 'lease_expirada');
    await assert.rejects(() => queue.complete(l!.id, l!.leaseId, 'r', at(5000)), (e: unknown) => e instanceof LeaseError && e.reason === 'lease_expirada');
    await assert.rejects(() => queue.heartbeat('nao-existe', 'x', NOW, 1), (e: unknown) => e instanceof LeaseError && e.reason === 'tarefa_inexistente');
  });

  test('complete é idempotente com o mesmo lease; com lease alheio recusa', async () => {
    const queue = q();
    await queue.enqueue(task(), NOW);
    const [l] = await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    const c1 = await queue.complete(l!.id, l!.leaseId, 'res-1', at(10));
    const c2 = await queue.complete(l!.id, l!.leaseId, 'res-2', at(20));
    assert.equal(c1.already, false);
    assert.equal(c2.already, true);
    assert.equal(c2.task.resultRef, 'res-1');
    await assert.rejects(() => queue.complete(l!.id, 'lease-alheio', 'x', at(30)), (e: unknown) => e instanceof LeaseError && e.reason === 'lease_invalida');
  });

  test('falha retentável volta a pendente; sem tentativas vira dead; não retentável vira failed', async () => {
    const queue = q();
    await queue.enqueue(task({ maxAttempts: 2 }), NOW);
    let [l] = await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    assert.equal((await queue.fail(l!.id, l!.leaseId, 'oops', true, at(10))).task.status, 'pending');
    [l] = await queue.claim({ workerId: 'w', now: at(20), leaseMs: 1000, limit: 1 });
    assert.equal(l!.attempt, 2);
    assert.equal((await queue.fail(l!.id, l!.leaseId, 'oops 2', true, at(30))).task.status, 'dead');
    assert.deepEqual(await queue.claim({ workerId: 'w', now: at(40), leaseMs: 1000, limit: 1 }), []);

    await queue.enqueue(task({ idempotencyKey: 'k2', refId: 'a2' }), NOW);
    const [m] = await queue.claim({ workerId: 'w', now: at(50), leaseMs: 1000, limit: 1 });
    assert.equal((await queue.fail(m!.id, m!.leaseId, 'definitivo', false, at(60))).task.status, 'failed');
    const c = await queue.counts();
    assert.equal(c.dead, 1);
    assert.equal(c.failed, 1);
  });

  test('tarefa que expira com tentativas esgotadas vira dead no próximo claim', async () => {
    const queue = q();
    await queue.enqueue(task({ maxAttempts: 1 }), NOW);
    await queue.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
    assert.deepEqual(await queue.claim({ workerId: 'w2', now: at(5000), leaseMs: 1000, limit: 1 }), []);
    assert.equal((await queue.counts()).dead, 1);
  });

  test('filtro por tipo (workers próprios de reserva)', async () => {
    const queue = q();
    await queue.enqueue(task({ kind: 'daily', idempotencyKey: 'd' }), NOW);
    await queue.enqueue(task({ kind: 'fact_check', idempotencyKey: 'f' }), NOW);
    const got = await queue.claim({ workerId: 'r', now: NOW, leaseMs: 1000, limit: 5, kinds: ['fact_check'] });
    assert.deepEqual(got.map((t) => t.kind), ['fact_check']);
  });
});
