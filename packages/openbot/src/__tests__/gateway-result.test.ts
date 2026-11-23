import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore, InMemoryLeaseQueue, InMemoryPilotRowStore, InMemoryPilotState,
  OPENBOT_PERMISSIONS, OpenBotModelGateway, resultRefFor, signBody, type CostEntry, type CostLedger, type GatewayRequestLike, type OpenBotDeps, type PullResult, type SignedRequest, type TaskIo,
} from '../index';

// O callback conclui a tarefa e SÓ DEPOIS grava o custo e a linha do piloto (e o gateway pode rodar em outro processo): o gateway espera por eles
// antes de responder e devolve `taskId` e `attempt` (a Editorial usa para `reviewedDraftTaskId` e para achar a linha do patch do veredito).
const SECRET = 'segredo-de-teste-resultado';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const signed = (obj: unknown): SignedRequest => {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() };
};
class MemIo implements TaskIo {
  results = new Map<string, unknown>();
  async putInput() {}
  async getResult(ref: string) {
    return this.results.get(ref) ?? null;
  }
}
/** Livro-caixa que só "enxerga" os relatos depois de N leituras (simula o callback gravando o custo depois de concluir a tarefa). */
class LateLedger extends InMemoryCostLedger implements CostLedger {
  reads = 0;
  constructor(private readonly visibleAfter: number) {
    super();
  }
  override async entries(): Promise<CostEntry[]> {
    this.reads += 1;
    return this.reads > this.visibleAfter ? super.entries() : [];
  }
}

let n = 0;
const mk = (opts: { ledger?: CostLedger; pilot?: boolean; timeoutMs?: number } = {}) => {
  const io = new MemIo();
  const rows = new InMemoryPilotRowStore();
  const deps: OpenBotDeps = {
    queue: new InMemoryLeaseQueue(() => `lease-${++n}`), ledger: opts.ledger ?? new InMemoryCostLedger(), health: new InMemoryHealthStore(), callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW,
    ...(opts.pilot ? { pilot: { enabled: true, rows, state: new InMemoryPilotState(), gate: () => ({ allowed: true, reasons: [] }) } } : {}),
  };
  let t = 0;
  let agent: (() => Promise<void>) | null = null;
  const gw = new OpenBotModelGateway({
    deps, io, caller: { id: 'f', permissions: [OPENBOT_PERMISSIONS.dispatch] }, timeoutMs: opts.timeoutMs ?? 10_000, pollMs: 1,
    profiles: { triage: 'a', context: 'a', draft: 'a', factcheck: 'a', review: 'a', social_pack: 'a', roles: 'a' },
    clock: () => t, sleep: async () => { t += 100; const a = agent; agent = null; if (a) await a(); },
  });
  return { gw, deps, io, rows, onFirstSleep: (f: () => Promise<void>) => { agent = f; } };
};
const req = (taskClass: GatewayRequestLike['taskClass'] = 'factcheck', key = 'art-9:factcheck:1', excludeProviders: string[] = []): GatewayRequestLike => ({
  taskClass, route: taskClass, workflow: 'WF02', idempotencyKey: key, promptVersion: 'p', dataClass: 'public', excludeProviders, input: {},
});
const usage = (t: { id: string; leaseId: string }, account: 'codex' | 'claude' | 'antigravity', model: string, tag = '') => ({
  executionId: `ex-${t.id}-${tag}${account}`, taskId: t.id, leaseId: t.leaseId, model, lane: (account === 'antigravity' ? 'antigravity' : 'subscription') as 'antigravity' | 'subscription', account, costMicro: 0,
});

describe('gateway: resposta com taskId e attempt', () => {
  test('ok:true devolve o taskId e a tentativa que concluíram; pending_timeout e falha também levam o taskId', async () => {
    const { gw, deps, io, onFirstSleep } = mk();
    onFirstSleep(async () => {
      const [t] = ((await handlePull(deps, signed({ workerId: 'w', account: 'codex' }))).body as PullResult).tasks;
      io.results.set(resultRefFor(t!.id, t!.attempt), { ok: 1 });
      await handleCallback(deps, signed({ callbackId: 'cb1', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: resultRefFor(t!.id, t!.attempt), usage: usage(t!, 'codex', 'gpt-5.1-codex') }));
    });
    const r = await gw.invoke(req());
    assert.equal(r.ok, true);
    const tasks = [...(await Promise.all([deps.queue.counts()]))];
    assert.equal(tasks[0]!.completed, 1);
    if (r.ok) assert.deepEqual([r.taskId, r.attempt, r.provider], [(await deps.queue.get(r.taskId))!.id, 1, 'openai']);

    const quiet = mk({ timeoutMs: 300 });
    const pend = await quiet.gw.invoke(req('factcheck', 'art-9:factcheck:2'));
    assert.deepEqual([pend.ok, !pend.ok && /pending_timeout/.test(pend.detail ?? ''), !pend.ok && typeof pend.taskId === 'string'], [false, true, true]);
  });
});

describe('gateway: espera o custo e a linha do piloto depois de concluir a tarefa', () => {
  test('o custo só aparece depois de algumas leituras: o gateway espera e responde ok, sem recusar por falta de relato', async () => {
    const { gw, deps, io, onFirstSleep } = mk({ ledger: new LateLedger(3) });
    onFirstSleep(async () => {
      const [t] = ((await handlePull(deps, signed({ workerId: 'w', account: 'codex' }))).body as PullResult).tasks;
      io.results.set(resultRefFor(t!.id, t!.attempt), { ok: 1 });
      await handleCallback(deps, signed({ callbackId: 'cb2', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: resultRefFor(t!.id, t!.attempt), usage: usage(t!, 'codex', 'gpt-5.1-codex') }));
    });
    const r = await gw.invoke(req());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok((deps.ledger as LateLedger).reads > 3, 'leu o livro-caixa várias vezes até o relato aparecer');
  });

  test('o custo nunca aparece: no prazo vira unknown_rate (nada inventado)', async () => {
    const { gw, deps, io, onFirstSleep } = mk({ ledger: new LateLedger(10_000), timeoutMs: 500 });
    onFirstSleep(async () => {
      const [t] = ((await handlePull(deps, signed({ workerId: 'w', account: 'codex' }))).body as PullResult).tasks;
      io.results.set(resultRefFor(t!.id, t!.attempt), { ok: 1 });
      await handleCallback(deps, signed({ callbackId: 'cb3', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: resultRefFor(t!.id, t!.attempt), usage: usage(t!, 'codex', 'gpt-5.1-codex') }));
    });
    const r = await gw.invoke(req('factcheck', 'art-9:factcheck:3'));
    assert.deepEqual([r.ok, !r.ok && r.refusal, !r.ok && typeof r.taskId], [false, 'unknown_rate', 'string']);
  });

  test('piloto ativo: espera a linha (task, tentativa) existir antes de responder; sem a linha no prazo, responde ok mesmo assim (o patch é melhor esforço)', async () => {
    const w = mk({ pilot: true });
    // o agente só grava a linha DEPOIS: o callback do piloto precisa de trace; aqui a linha é gravada à mão, atrasada
    w.onFirstSleep(async () => {
      const [t] = ((await handlePull(w.deps, signed({ workerId: 'w', account: 'codex' }))).body as PullResult).tasks;
      w.io.results.set(resultRefFor(t!.id, t!.attempt), { ok: 1 });
      await w.deps.queue.complete(t!.id, t!.leaseId, resultRefFor(t!.id, t!.attempt), NOW);
      await w.deps.ledger.record(usage(t!, 'codex', 'gpt-5.1-codex'), 1_000_000, NOW);
      // a linha só passa a existir na 4ª leitura (o callback do piloto a grava depois de concluir a tarefa)
      const origAll = w.rows.all.bind(w.rows);
      let calls = 0;
      w.rows.all = async () => {
        if (++calls === 4) {
          await w.rows.upsert({
            task_id: t!.id, kind: t!.kind, article_id: 'art-9', source_id: 's', stage: 'factcheck', account: 'codex', declared_model: 'gpt-5.1-codex', prompt_version: 'p',
            started_at: NOW.toISOString(), ended_at: NOW.toISOString(), attempt: t!.attempt, outcome: 'completed', packet_chars: 1, tokens_measured: false,
            published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false,
          });
        }
        return origAll();
      };
    });
    const r = await w.gw.invoke(req('factcheck', 'art-9:factcheck:4'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok((await w.rows.all()).some((x) => x.task_id === (r.ok ? r.taskId : '')), 'a linha existia quando o gateway respondeu');

    const w2 = mk({ pilot: true, timeoutMs: 400 });
    w2.onFirstSleep(async () => {
      const [t] = ((await handlePull(w2.deps, signed({ workerId: 'w', account: 'codex' }))).body as PullResult).tasks;
      w2.io.results.set(resultRefFor(t!.id, t!.attempt), { ok: 1 });
      await w2.deps.queue.complete(t!.id, t!.leaseId, resultRefFor(t!.id, t!.attempt), NOW);
      await w2.deps.ledger.record(usage(t!, 'codex', 'gpt-5.1-codex'), 1_000_000, NOW);
    });
    const r2 = await w2.gw.invoke(req('factcheck', 'art-9:factcheck:5'));
    assert.equal(r2.ok, true, 'sem linha no prazo: responde ok (melhor esforço); a Editorial registra a auditoria do patch');
  });
});

describe('gateway: com troca de via, usa o relato da execução que CONCLUIU', () => {
  test('a codex bateu o limite (com relato) e a antigravity concluiu: provedor e modelo vêm do relato da antigravity, não do primeiro', async () => {
    const { gw, deps, io, onFirstSleep } = mk();
    onFirstSleep(async () => {
      const [a] = ((await handlePull(deps, signed({ workerId: 'w1', account: 'codex' }))).body as PullResult).tasks;
      await handleCallback(deps, signed({
        callbackId: 'cb-lim', taskId: a!.id, leaseId: a!.leaseId, outcome: 'failed', retryable: true, error: 'limite',
        usage: usage(a!, 'codex', 'gpt-5.1-codex', 'lim-'), trace: { stage: 'factcheck', account: 'codex', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), limit: { message: 'limite', at: NOW.toISOString() } },
      }));
      const [b] = ((await handlePull(deps, signed({ workerId: 'w2', account: 'antigravity' }))).body as PullResult).tasks;
      io.results.set(resultRefFor(b!.id, b!.attempt), { ok: 1 });
      await handleCallback(deps, signed({ callbackId: 'cb-ok', taskId: b!.id, leaseId: b!.leaseId, outcome: 'completed', resultRef: resultRefFor(b!.id, b!.attempt), usage: usage(b!, 'antigravity', 'gemini-3-pro') }));
    });
    const r = await gw.invoke(req());
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) assert.deepEqual([r.model, r.provider, r.attempt], ['gemini-3-pro', 'google', 2]);
  });
});
