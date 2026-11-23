import assert from 'node:assert/strict';
import { LeaseError, type LeaseQueue } from './lease-queue';
import type { Account, NewTask } from './types';

// Suíte de CONFORMIDADE da fila com lease (entrada `@ln/openbot/testing`, só para testes; não importar em produção).
// Qualquer implementação de `LeaseQueue` (em memória, PostgreSQL com `FOR UPDATE SKIP LOCKED`) tem de passar nestes casos:
// eles são o contrato de comportamento (dedupe, lease, troca de via no limite, redação que nunca troca, limite que não consome
// tentativa, espera da janela). Cada caso usa uma fila NOVA (`make`) e só horários explícitos; nada depende do formato dos ids.

export interface ConformanceCase {
  name: string;
  run: () => Promise<void>;
}

const NOW = new Date('2026-11-23T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

const task = (over: Partial<NewTask> = {}): NewTask => ({
  kind: 'classification', profileId: 'newsdesk', refId: 'a1', idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, dataClass: 'public', maxCostMicro: 1,
  route: ['opencode', 'claude', 'antigravity'], ...over,
});

const reason = (r: LeaseError['reason']) => (e: unknown) => e instanceof LeaseError && e.reason === r;

export function leaseQueueConformanceCases(make: () => Promise<LeaseQueue> | LeaseQueue): ConformanceCase[] {
  const claim = (q: LeaseQueue, account: Account | undefined, now: Date, limit = 5, kinds?: string[]) =>
    q.claim({ workerId: `w-${account ?? 'any'}`, now, leaseMs: 60_000, limit, account, kinds });

  const cases: ConformanceCase[] = [
    {
      name: 'enqueue é idempotente pela chave',
      run: async () => {
        const q = await make();
        const t = task({ idempotencyKey: 'dup' });
        const a = await q.enqueue(t, NOW);
        const b = await q.enqueue(t, at(1000));
        assert.deepEqual([a.created, b.created, a.task.id === b.task.id], [true, false, true]);
        assert.equal((await q.counts()).pending, 1);
      },
    },
    {
      name: 'sem rota informada a tarefa usa a via única claude',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: undefined }), NOW);
        const [l] = await claim(q, undefined, NOW);
        assert.equal(l?.account, 'claude');
      },
    },
    {
      name: 'claim respeita o limite e nunca entrega a mesma tarefa a dois detentores',
      run: async () => {
        const q = await make();
        for (let i = 0; i < 3; i++) await q.enqueue(task({ refId: `a${i}` }), NOW);
        const w1 = await claim(q, undefined, NOW, 2);
        const w2 = await claim(q, undefined, NOW, 5);
        assert.deepEqual([w1.length, w2.length], [2, 1]);
        assert.equal(new Set([...w1, ...w2].map((t) => t.id)).size, 3);
        assert.deepEqual(await claim(q, undefined, NOW), []);
      },
    },
    {
      name: 'claim em paralelo não duplica entrega',
      run: async () => {
        const q = await make();
        for (let i = 0; i < 6; i++) await q.enqueue(task({ refId: `p${i}` }), NOW);
        const got = await Promise.all(Array.from({ length: 6 }, (_, i) => q.claim({ workerId: `w${i}`, now: NOW, leaseMs: 60_000, limit: 2, account: 'opencode' })));
        const ids = got.flat().map((t) => t.id);
        assert.equal(ids.length, 6);
        assert.equal(new Set(ids).size, 6, 'nenhuma tarefa entregue duas vezes');
      },
    },
    {
      name: 'cada via só recebe tarefas cuja via atual é a dela; filtro por tipo',
      run: async () => {
        const q = await make();
        await q.enqueue(task(), NOW);
        await q.enqueue(task({ kind: 'daily', route: ['claude'] }), NOW);
        assert.deepEqual(await claim(q, 'codex', NOW), []);
        assert.deepEqual((await claim(q, 'claude', NOW, 5, ['classification'])), []);
        assert.deepEqual((await claim(q, 'claude', NOW)).map((t) => t.kind), ['daily']);
        assert.deepEqual((await claim(q, 'opencode', NOW)).map((t) => t.kind), ['classification']);
      },
    },
    {
      name: 'lease vencido volta a ser puxável (tentativa 2); o antigo detentor perde o lease; heartbeat estende',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['claude'] }), NOW);
        const [a] = await q.claim({ workerId: 'w1', now: NOW, leaseMs: 1000, limit: 1 });
        assert.deepEqual(await q.claim({ workerId: 'w2', now: at(500), leaseMs: 1000, limit: 1 }), []);
        const hb = await q.heartbeat(a!.id, a!.leaseId, at(900), 1000);
        assert.equal(hb.leaseExpiresAt, at(1900).toISOString());
        const [b] = await q.claim({ workerId: 'w2', now: at(3000), leaseMs: 1000, limit: 1 });
        assert.equal(b!.attempt, 2);
        assert.notEqual(b!.leaseId, a!.leaseId);
        await assert.rejects(() => q.complete(a!.id, a!.leaseId, 'r', at(3100)), reason('lease_invalida'));
        await assert.rejects(() => q.heartbeat(b!.id, b!.leaseId, at(9000), 1000), reason('lease_expirada'));
        await assert.rejects(() => q.heartbeat('nao-existe', 'x', NOW, 1), reason('tarefa_inexistente'));
      },
    },
    {
      name: 'complete é idempotente com o mesmo lease e recusa lease alheio',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['claude'] }), NOW);
        const [l] = await q.claim({ workerId: 'w', now: NOW, leaseMs: 1000, limit: 1 });
        const c1 = await q.complete(l!.id, l!.leaseId, 'res-1', at(10));
        const c2 = await q.complete(l!.id, l!.leaseId, 'res-2', at(20));
        assert.deepEqual([c1.already, c2.already, c2.task.resultRef], [false, true, 'res-1']);
        await assert.rejects(() => q.complete(l!.id, 'lease-alheio', 'x', at(30)), reason('lease_invalida'));
      },
    },
    {
      name: 'falha retentável volta a pendente; esgotadas as tentativas vira dead; não retentável vira failed',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['claude'], maxAttempts: 2 }), NOW);
        let [l] = await claim(q, 'claude', NOW);
        assert.equal((await q.fail(l!.id, l!.leaseId, 'erro', true, at(1))).task.status, 'pending');
        [l] = await claim(q, 'claude', at(2));
        assert.equal(l!.attempt, 2);
        assert.equal((await q.fail(l!.id, l!.leaseId, 'erro', true, at(3))).task.status, 'dead');
        await q.enqueue(task({ route: ['claude'], refId: 'b' }), NOW);
        const [m] = await claim(q, 'claude', at(4));
        assert.equal((await q.fail(m!.id, m!.leaseId, 'definitivo', false, at(5))).task.status, 'failed');
        const c = await q.counts();
        assert.deepEqual([c.dead, c.failed], [1, 1]);
      },
    },
    {
      name: 'espera (retryAfterMs) é respeitada antes de a tarefa voltar a ser puxável',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['claude'] }), NOW);
        const [l] = await claim(q, 'claude', NOW);
        await q.fail(l!.id, l!.leaseId, 'erro', true, at(1), 600_000);
        assert.deepEqual(await claim(q, 'claude', at(1000)), []);
        assert.equal((await claim(q, 'claude', at(600_002))).length, 1);
      },
    },
    {
      name: 'limite passa à PRÓXIMA via, já disponível, sem consumir tentativa (maxAttempts 1) e registra as vias que bateram o limite',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ maxAttempts: 1 }), NOW);
        const [a] = await claim(q, 'opencode', NOW);
        const f1 = await q.fail(a!.id, a!.leaseId, 'limite', true, at(10), 1_800_000, { account: 'opencode', switchRoute: true });
        assert.deepEqual([f1.task.status, f1.task.routeIndex, f1.task.limitHits, f1.task.availableAt], ['pending', 1, 1, undefined]);
        assert.deepEqual(f1.task.accountsLimited.map((x) => x.account), ['opencode']);
        assert.deepEqual(await claim(q, 'opencode', at(20)), []);
        const [b] = await claim(q, 'claude', at(20));
        assert.deepEqual([b!.id === a!.id, b!.attempt], [true, 2]);
        await q.fail(b!.id, b!.leaseId, 'limite', true, at(30), 1_800_000, { account: 'claude', switchRoute: true });
        const [c] = await claim(q, 'antigravity', at(40));
        assert.equal(c!.attempt, 3);
        assert.equal((await q.complete(c!.id, c!.leaseId, 'res', at(50))).task.status, 'completed');
      },
    },
    {
      name: 'todas as vias no limite: espera a janela e recomeça pela via preferida',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['opencode', 'claude'] }), NOW);
        const [a] = await claim(q, 'opencode', NOW);
        await q.fail(a!.id, a!.leaseId, 'limite', true, at(1), 600_000, { account: 'opencode', switchRoute: true });
        const [b] = await claim(q, 'claude', at(2));
        const f = await q.fail(b!.id, b!.leaseId, 'limite', true, at(3), 600_000, { account: 'claude', switchRoute: true });
        assert.deepEqual([f.task.routeIndex, f.task.availableAt], [0, at(3 + 600_000).toISOString()]);
        assert.deepEqual(await claim(q, 'opencode', at(1000)), []);
        assert.equal((await claim(q, 'opencode', at(3 + 600_001)))[0]?.account, 'opencode');
      },
    },
    {
      name: 'redação (switchRoute falso): espera a janela e a MESMA via retoma; nenhuma outra recebe',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ kind: 'editorial_draft', route: ['claude'] }), NOW);
        const [a] = await claim(q, 'claude', NOW);
        const f = await q.fail(a!.id, a!.leaseId, 'limite', true, at(1), 900_000, { account: 'claude', switchRoute: false });
        assert.equal(f.task.routeIndex, 0);
        assert.ok(f.task.availableAt);
        for (const acc of ['opencode', 'antigravity', 'codex'] as const) assert.deepEqual(await claim(q, acc, at(900_100)), [], acc);
        assert.deepEqual(await claim(q, 'claude', at(1000)), []);
        assert.equal((await claim(q, 'claude', at(900_002)))[0]?.id, a!.id);
      },
    },
    {
      name: 'switchRoute falso não troca nem quando a rota tem mais vias',
      run: async () => {
        const q = await make();
        await q.enqueue(task({ route: ['claude', 'antigravity'] }), NOW);
        const [a] = await claim(q, 'claude', NOW);
        const f = await q.fail(a!.id, a!.leaseId, 'limite', true, at(1), 60_000, { account: 'claude', switchRoute: false });
        assert.equal(f.task.routeIndex, 0);
        assert.deepEqual(await claim(q, 'antigravity', at(2)), []);
      },
    },
  ];
  return cases;
}
