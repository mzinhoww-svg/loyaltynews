import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { leaseQueueConformanceCases } from '../testing';
import { InMemoryLeaseQueue } from '../lease-queue';
import {
  dispatchTask, handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore, InputConflict, OPENBOT_PERMISSIONS, OpenBotModelGateway,
  resultRefFor, signBody, type OpenBotDeps, type PullResult, type SignedRequest, type TaskInputMeta, type TaskIo,
} from '../index';
import type { ApiError } from '@ln/contracts';

describe('suíte de conformidade da fila com lease (a mesma que o Backend roda contra o PostgreSQL)', () => {
  let n = 0;
  for (const c of leaseQueueConformanceCases(() => new InMemoryLeaseQueue(() => `lease-${++n}`))) {
    test(c.name, c.run);
  }
});

const SECRET = 'segredo-de-teste-io';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const signed = (obj: unknown): SignedRequest => {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() };
};
const code = (b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? (b as ApiError).error.code : undefined);
let n = 0;

function mkDeps(over: Partial<OpenBotDeps> = {}): OpenBotDeps {
  return {
    queue: new InMemoryLeaseQueue(() => `lease-${++n}`), ledger: new InMemoryCostLedger(), health: new InMemoryHealthStore(), callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW, ...over,
  };
}

describe('resultRef derivado (nunca escolhido pelo agente)', () => {
  const setup = async (deps: OpenBotDeps) => {
    await dispatchTask(deps, { id: 'u', permissions: [OPENBOT_PERMISSIONS.dispatch] }, { kind: 'classification', profileId: 'newsdesk', refId: 'r1', idempotencyKey: 'k1', dataClass: 'public', maxCostMicro: 1 });
    return (((await handlePull(deps, signed({ workerId: 'w' }))).body) as PullResult).tasks[0]!;
  };
  const cb = (deps: OpenBotDeps, t: { id: string; leaseId: string }, resultRef: string | undefined, id: string) =>
    handleCallback(deps, signed({ callbackId: id, taskId: t.id, leaseId: t.leaseId, outcome: 'completed', ...(resultRef ? { resultRef } : {}), usage: { executionId: `ex-${id}`, taskId: t.id, leaseId: t.leaseId, model: 'm', lane: 'subscription', account: 'claude', costMicro: 0 } }));

  test('forma: res-<taskId>-a<tentativa>, aceita pelo formato de id', () => {
    assert.equal(resultRefFor('task-1', 2), 'res-task-1-a2');
    assert.match(resultRefFor('task-000001', 1), /^[A-Za-z0-9_.-]{1,128}$/);
  });

  test('com a exigência ligada: só o derivado passa; outro, de outra tarefa ou ausente é 422 e não consome o callbackId', async () => {
    const deps = mkDeps({ requireDerivedResultRef: true });
    const t = await setup(deps);
    for (const bad of ['res-outra-a1', `res-${t.id}-a9`, 'qualquer-coisa', undefined]) {
      const r = await cb(deps, t, bad, 'cb-1');
      assert.equal(code(r.body), 'RESULT_REF_MISMATCH', String(bad));
    }
    assert.equal((await deps.queue.get(t.id))?.status, 'leased');
    const ok = await cb(deps, t, resultRefFor(t.id, t.attempt), 'cb-1');
    assert.equal(ok.status, 200);
    assert.equal((await deps.queue.get(t.id))?.resultRef, resultRefFor(t.id, t.attempt));
  });

  test('sem a exigência (padrão), o comportamento antigo continua', async () => {
    const deps = mkDeps();
    const t = await setup(deps);
    assert.equal((await cb(deps, t, 'qualquer', 'cb-2')).status, 200);
  });
});

describe('gateway: putInput idempotente, divergência e reviewedDraftTaskId', () => {
  class Io implements TaskIo {
    puts: { refId: string; input: unknown; meta: TaskInputMeta }[] = [];
    mode: 'ok' | 'conflict' | 'down' = 'ok';
    async putInput(refId: string, input: unknown, meta: TaskInputMeta) {
      if (this.mode === 'conflict') throw new InputConflict(refId);
      if (this.mode === 'down') throw new Error('db fora');
      this.puts.push({ refId, input, meta });
    }
    async getResult() {
      return null;
    }
  }
  const mk = (io: Io) => new OpenBotModelGateway({
    deps: mkDeps(), io, caller: { id: 'f', permissions: [OPENBOT_PERMISSIONS.dispatch] }, timeoutMs: 20, pollMs: 1,
    profiles: { triage: 'a', context: 'a', draft: 'a', factcheck: 'a', review: 'a', social_pack: 'a', roles: 'a' },
  });
  const req = (input: unknown) => ({ taskClass: 'factcheck' as const, route: 'review', workflow: 'WF02', idempotencyKey: 'k', promptVersion: 'p', dataClass: 'public' as const, excludeProviders: [], input });

  test('reviewedDraftTaskId vem de input.reviewedDraftTaskId (se válido) e vai em meta, nunca no fio', async () => {
    const io = new Io();
    await mk(io).invoke(req({ headline: 'x', reviewedDraftTaskId: 'task-000007' }));
    assert.equal(io.puts[0]?.meta.reviewedDraftTaskId, 'task-000007');
    const io2 = new Io();
    await mk(io2).invoke(req({ reviewedDraftTaskId: 'com espaço' }));
    assert.equal('reviewedDraftTaskId' in (io2.puts[0]?.meta ?? {}), false);
    const io3 = new Io();
    await mk(io3).invoke(req('texto'));
    assert.equal('reviewedDraftTaskId' in (io3.puts[0]?.meta ?? {}), false);
  });

  test('articleId: vem da chave <articleId>:<etapa>:<tentativa> da Editorial (ou de input.articleId) e vai em meta; id fora do formato não vai', async () => {
    const io = new Io();
    const g = mk(io);
    const withKey = (idempotencyKey: string, input: unknown = {}) => ({ ...req(input), idempotencyKey });
    await g.invoke(withKey('art-2026-0001:factcheck:1'));
    await g.invoke(withKey('chave-sem-padrao', { articleId: 'art-2026-0002' }));
    await g.invoke(withKey('com espaço:review:2'));
    await g.invoke(withKey('chave-sem-padrao-2', { articleId: 'com espaço' }));
    assert.deepEqual(io.puts.map((p) => p.meta.articleId), ['art-2026-0001', 'art-2026-0002', undefined, undefined]);
  });

  test('despacho desligado ou parado: recusa ANTES de gravar a entrada (nenhuma entrada órfã) e sem criar tarefa', async () => {
    for (const [flags, refusal, detail] of [
      [{ dispatchEnabled: false, kill: false }, 'model_disabled', 'DISPATCH_OFF'],
      [{ dispatchEnabled: true, kill: true }, 'kill_switch', 'KILL_SWITCH'],
    ] as const) {
      const io = new Io();
      const deps = mkDeps({ flags: () => flags });
      const g = new OpenBotModelGateway({
        deps, io, caller: { id: 'f', permissions: [OPENBOT_PERMISSIONS.dispatch] }, timeoutMs: 20, pollMs: 1,
        profiles: { triage: 'a', context: 'a', draft: 'a', factcheck: 'a', review: 'a', social_pack: 'a', roles: 'a' },
      });
      const r = await g.invoke(req({}));
      assert.deepEqual([r.ok, !r.ok && r.refusal, !r.ok && r.detail], [false, refusal, detail]);
      assert.equal(io.puts.length, 0);
      assert.equal((await deps.queue.counts()).pending, 0);
    }
  });

  test('entrada divergente vira recusa clara; armazém fora do ar vira recusa e NÃO despacha tarefa', async () => {
    const io = new Io();
    const g = mk(io);
    io.mode = 'conflict';
    const a = await g.invoke(req({}));
    assert.deepEqual([a.ok, !a.ok && a.refusal, !a.ok && a.detail?.startsWith('input_divergente')], [false, 'model_disabled', true]);
    io.mode = 'down';
    const b = await g.invoke(req({}));
    assert.deepEqual([b.ok, !b.ok && b.detail], [false, 'armazem_de_conteudo_indisponivel']);
  });
});
