/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { signBody } from '@ln/openbot';
import { PgLeaseQueue } from '@ln/workers/openbot-pg';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../_lib/testkit';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';
import { PgTaskIo } from '@ln/workers/openbot-pg';

// Rotas do OpenBot (ADR-003) sobre o PostgreSQL: assinatura HMAC no corpo cru, flag openbotDispatch, kill switch, fila com lease,
// callback idempotente com custo, estouro de teto e saúde.
const SECRET = 'segredo-de-teste-openbot';
const PREV = 'segredo-anterior-de-teste';
let app: Awaited<ReturnType<typeof makeApp>>;
const NOW = () => app.clock.now.getTime();
const queue = () => new PgLeaseQueue(app.db as any, (() => { let n = 0; return () => `t${++n}-${Math.random().toString(36).slice(2, 8)}`; })());

type Route = typeof pull;
async function post(r: Route, body: unknown, opts: { secret?: string | null; ts?: number; raw?: string; headers?: Record<string, string> } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? NOW();
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.9', ...(opts.headers ?? {}) };
  if (opts.secret !== null) {
    headers['x-ln-timestamp'] = String(ts);
    headers['x-ln-signature'] = signBody(opts.secret ?? SECRET, ts, raw);
  }
  const res = await r.POST(new Request('http://localhost:3000/api/openbot/x', { method: 'POST', headers, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

/** resultRef derivado (o callback de completed só aceita `res-<taskId>-a<tentativa>`). */
const R = (t: { id: string; attempt?: number }, attempt = t.attempt ?? 1) => `res-${t.id}-a${attempt}`;
const task = (n: number, over: Record<string, unknown> = {}) => ({
  kind: 'editorial_draft' as const, profileId: 'writer_pontos', refId: `art-${n}`, idempotencyKey: `idem-${n}`, dataClass: 'public' as const, maxCostMicro: 1_000_000, ...over,
});
const usage = (t: { id: string; leaseId: string }, over: Record<string, unknown> = {}) => ({
  executionId: `exec-${t.id}`, taskId: t.id, leaseId: t.leaseId, model: 'anthropic/claude-sonnet-5.5', generationIds: ['gen-1'],
  promptTokens: 1000, completionTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 400_000, ...over,
});

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  process.env.OPENBOT_HMAC_SECRET = SECRET;
  delete process.env.OPENBOT_HMAC_SECRET_PREVIOUS;
  app.deps.flags.openbotDispatch = true;
});
afterEach(async () => {
  for (const tbl of [schema.openbotCostEntries, schema.openbotCallbacks, schema.openbotHealth, schema.openbotPilotRows, schema.openbotPilotState, schema.openbotIo, schema.openbotTasks, schema.budgetKillSwitch]) await app.db.delete(tbl as any);
});
afterAll(async () => {
  delete process.env.OPENBOT_HMAC_SECRET;
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe('autenticação (HMAC no corpo cru)', () => {
  it('sem cabeçalhos, assinatura errada, corpo adulterado, janela de tempo e sem segredo configurado: 401, sem efeito', async () => {
    await queue().enqueue(task(1), app.clock.now);
    expect((await post(pull, { workerId: 'w1' }, { secret: null })).status).toBe(401);
    expect((await post(pull, { workerId: 'w1' }, { secret: 'outro-segredo' })).status).toBe(401);
    expect((await post(pull, { workerId: 'w1' }, { ts: NOW() - 10 * 60_000 })).status).toBe(401);
    const adulterado = JSON.stringify({ workerId: 'w1' });
    const ts = NOW();
    const res = await pull.POST(new Request('http://localhost:3000/api/openbot/pull', { method: 'POST', headers: { 'x-ln-timestamp': String(ts), 'x-ln-signature': signBody(SECRET, ts, adulterado) }, body: JSON.stringify({ workerId: 'w1', limit: 10 }) }));
    expect(res.status).toBe(401);
    delete process.env.OPENBOT_HMAC_SECRET;
    expect((await post(pull, { workerId: 'w1' })).status).toBe(401); // sem segredo configurado, falha fechada
    process.env.OPENBOT_HMAC_SECRET = SECRET;
    expect(await queue().counts()).toMatchObject({ pending: 1, leased: 0 }); // nada foi entregue
    expect(await app.db.select().from(schema.openbotHealth)).toHaveLength(0); // nem a saúde foi marcada
  });

  it('o segredo ANTERIOR ainda vale durante a rotação; corpo acima de 64 KB é recusado', async () => {
    process.env.OPENBOT_HMAC_SECRET_PREVIOUS = PREV;
    expect((await post(pull, { workerId: 'w1' }, { secret: PREV })).status).toBe(200);
    const grande = JSON.stringify({ workerId: 'w1', pad: 'x'.repeat(70_000) });
    expect((await post(pull, null, { raw: grande })).status).toBe(413);
  });
});

describe('flag openbotDispatch e kill switch', () => {
  it('flag desligada: pull não entrega (423 DISPATCH_OFF) e a tarefa fica pendente; heartbeat e callback seguem para fechar o que estava em curso', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    app.deps.flags.openbotDispatch = false;
    const off = await post(pull, { workerId: 'w1' });
    expect(off).toMatchObject({ status: 423, body: { error: { code: 'DISPATCH_OFF' } } });
    expect((await post(heartbeat, { taskId: t!.id, leaseId: t!.leaseId })).status).toBe(200);
    expect((await post(callback, { callbackId: 'cb-1', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: R(t!) })).status).toBe(200);
  });

  it('kill switch global ou da rota openbot bloqueia pull e heartbeat (423); rota de outro assunto não bloqueia; o callback segue aceito e registra o custo já gasto', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    const store = new PostgresLedgerStore(app.db as unknown as SqlDatabase);
    await store.setKill('route:economy', true, 'outra rota', app.clock.now);
    expect((await post(heartbeat, { taskId: t!.id, leaseId: t!.leaseId })).status).toBe(200);
    await store.setKill('route:openbot', true, 'parar o openbot', app.clock.now);
    for (const [r, b] of [[pull, { workerId: 'w1' }], [heartbeat, { taskId: t!.id, leaseId: t!.leaseId }]] as const) {
      expect((await post(r as Route, b)).body.error.code, JSON.stringify(b)).toBe('KILL_SWITCH');
    }
    await store.setKill('route:openbot', false, 'voltar', app.clock.now);
    await store.setKill('global', true, 'parada geral', app.clock.now);
    expect((await post(pull, { workerId: 'w1' })).status).toBe(423);
    expect((await q.get(t!.id))!.status).toBe('leased'); // nada mudou durante a parada
    // o custo já gasto não pode se perder: o callback é aceito mesmo parado
    const cb = await post(callback, { callbackId: 'cb-k', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: R(t!), usage: usage(t!) });
    expect(cb).toMatchObject({ status: 200, body: { costRecorded: true } });
  });
});

describe('fila com lease sobre o PostgreSQL', () => {
  it('pull entrega só ids e limites, marca a saúde e respeita limit/kinds; a mesma tarefa não vai a dois detentores', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    await q.enqueue(task(2, { kind: 'fact_check' }), app.clock.now);
    const a = await post(pull, { workerId: 'w1', limit: 1, kinds: ['fact_check'] });
    expect(a.status).toBe(200);
    expect(a.body.tasks).toHaveLength(1);
    expect(a.body.tasks[0]).toMatchObject({ kind: 'fact_check', refId: 'art-2', attempt: 1 });
    expect(Object.keys(a.body.tasks[0]).sort()).toEqual(['account', 'attempt', 'dataClass', 'id', 'kind', 'leaseExpiresAt', 'leaseId', 'maxCostMicro', 'profileId', 'refId']); // nada de conteúdo
    const b = await post(pull, { workerId: 'w2', limit: 5 });
    expect(b.body.tasks.map((t: any) => t.refId)).toEqual(['art-1']); // a outra já está com w1
    expect((await app.db.select().from(schema.openbotHealth))[0]).toMatchObject({ id: 'pull', workerId: 'w2' });
  });

  it('lease vencido volta a ser entregue (nova tentativa) e o detentor antigo perde o direito', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t1] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 1000, limit: 1 });
    const depois = new Date(app.clock.now.getTime() + 5000);
    const [t2] = await q.claim({ workerId: 'w2', now: depois, leaseMs: 1000, limit: 1 });
    expect(t2).toMatchObject({ id: t1!.id, attempt: 2 });
    expect(t2!.leaseId).not.toBe(t1!.leaseId);
    await expect(q.heartbeat(t1!.id, t1!.leaseId, depois, 1000)).rejects.toMatchObject({ reason: 'lease_invalida' });
  });

  it('heartbeat renova; lease inexistente/inválida: 404/409', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    const h = await post(heartbeat, { taskId: t!.id, leaseId: t!.leaseId });
    expect(h.status).toBe(200);
    expect(h.body.leaseExpiresAt).toBeTruthy();
    expect((await post(heartbeat, { taskId: t!.id, leaseId: 'lease-errado' })).status).toBe(409);
    expect((await post(heartbeat, { taskId: 'nao-existe', leaseId: 'x' })).status).toBe(404);
    expect((await post(heartbeat, { taskId: 'a b', leaseId: 'x' })).status).toBe(400);
  });
});

describe('callback assinado e idempotente, com custo', () => {
  it('conclui a tarefa, registra o custo uma vez e o replay do mesmo callbackId não tem efeito', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    const body = { callbackId: 'cb-1', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: R(t!), usage: usage(t!) };
    const r1 = await post(callback, body);
    expect(r1).toMatchObject({ status: 200, body: { duplicate: false, costRecorded: true, overrun: false, pauseModelCalls: false } });
    expect(r1.body.task).toMatchObject({ status: 'completed' });
    const r2 = await post(callback, body);
    expect(r2.body).toMatchObject({ duplicate: true, costRecorded: false });
    // mesmo executionId com OUTRO callbackId: o custo não é contado de novo
    const r3 = await post(callback, { ...body, callbackId: 'cb-2' });
    expect(r3.status === 200 ? r3.body.costRecorded : false).toBe(false);
    const custos = await app.db.select().from(schema.openbotCostEntries);
    expect(custos).toHaveLength(1);
    expect(custos[0]).toMatchObject({ executionId: `exec-${t!.id}`, costMicro: 400_000, overrun: false });
    expect((await q.get(t!.id))).toMatchObject({ status: 'completed', resultRef: R(t!) });
  });

  it('custo desconhecido, de outra tarefa ou outro lease: 422 sem efeito e SEM consumir o callbackId (pode reenviar corrigido)', async () => {
    const q = queue();
    await q.enqueue(task(1), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    const base = { callbackId: 'cb-1', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: R(t!) };
    expect((await post(callback, { ...base, usage: usage(t!, { costMicro: null }) })).body.error.code).toBe('USAGE_INVALID');
    expect((await post(callback, { ...base, usage: usage(t!, { costMicro: 1.5 }) })).status).toBe(422);
    expect((await post(callback, { ...base, usage: usage({ id: t!.id, leaseId: 'outro' }) })).body.error.code).toBe('USAGE_MISMATCH');
    expect((await q.get(t!.id))!.status).toBe('leased');
    expect(await app.db.select().from(schema.openbotCostEntries)).toHaveLength(0);
    expect((await post(callback, { ...base, usage: usage(t!) })).status).toBe(200); // o mesmo callbackId, agora válido
  });

  it('custo acima do teto da tarefa fica registrado como estouro; acima do teto mensal pausa as chamadas de modelo', async () => {
    const q = queue();
    await q.enqueue(task(1, { maxCostMicro: 100_000 }), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    const r = await post(callback, { callbackId: 'cb-1', taskId: t!.id, leaseId: t!.leaseId, outcome: 'completed', resultRef: R(t!), usage: usage(t!, { costMicro: 51_000_000 }) });
    expect(r.body).toMatchObject({ costRecorded: true, overrun: true, pauseModelCalls: true, budget: { status: 'estourado' } });
    expect((await app.db.select().from(schema.openbotCostEntries))[0]).toMatchObject({ overrun: true, costMicro: 51_000_000 });
  });

  it('falha com nova tentativa volta a pendente; sem nova tentativa ou esgotada vira failed/dead; lease expirado no callback: 409', async () => {
    const q = queue();
    await q.enqueue(task(1, { maxAttempts: 1 }), app.clock.now);
    await q.enqueue(task(2), app.clock.now);
    const [a, b] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 2 });
    expect((await post(callback, { callbackId: 'f1', taskId: a!.id, leaseId: a!.leaseId, outcome: 'failed', error: 'timeout', retryable: true })).body.task.status).toBe('dead'); // 1 tentativa só
    expect((await post(callback, { callbackId: 'f2', taskId: b!.id, leaseId: b!.leaseId, outcome: 'failed', error: 'timeout', retryable: true })).body.task.status).toBe('pending');
    const [b2] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    expect((await post(callback, { callbackId: 'f3', taskId: b2!.id, leaseId: b2!.leaseId, outcome: 'failed', error: 'regra', retryable: false })).body.task.status).toBe('failed');
    await q.enqueue(task(3), app.clock.now);
    const [c] = await q.claim({ workerId: 'w1', now: new Date(app.clock.now.getTime() - 10 * 60_000), leaseMs: 1000, limit: 1 }); // lease já vencido no relógio da API
    expect((await post(callback, { callbackId: 'f4', taskId: c!.id, leaseId: c!.leaseId, outcome: 'completed', resultRef: R(c!) })).status).toBe(409);
  });
});

describe('estado no banco', () => {
  it('idempotencyKey: enfileirar a mesma chave duas vezes cria uma tarefa só; contagens por estado', async () => {
    const q = queue();
    expect((await q.enqueue(task(1), app.clock.now)).created).toBe(true);
    expect((await q.enqueue(task(1), app.clock.now)).created).toBe(false);
    expect(await app.db.select().from(schema.openbotTasks).where(eq(schema.openbotTasks.idempotencyKey, 'idem-1'))).toHaveLength(1);
    expect(await q.counts()).toEqual({ pending: 1, leased: 0, completed: 0, failed: 0, dead: 0 });
  });

  it('o banco recusa o que o contrato recusa (classe de dado restrita, teto zero, lease incoerente)', async () => {
    const q = queue();
    await expect(q.enqueue(task(1, { dataClass: 'restricted' }), app.clock.now)).rejects.toBeDefined();
    await expect(q.enqueue(task(2, { maxCostMicro: 0 }), app.clock.now)).rejects.toBeDefined();
    await q.enqueue(task(3), app.clock.now);
    await expect(app.db.update(schema.openbotTasks).set({ status: 'leased' }).where(eq(schema.openbotTasks.refId, 'art-3'))).rejects.toBeDefined();
  });
});

// ---------- conteúdo (TaskIo) para o agente, resultRef derivado e piloto ----------
describe('rotas do agente: io/input e io/result (presas ao lease vivo)', () => {
  const io = () => new PgTaskIo(app.db as any, app.deps.now);
  async function leased(n = 1, kind: string = 'editorial_draft') {
    const q = queue();
    await q.enqueue(task(n, { kind, refId: `gw-${n}` }), app.clock.now);
    const [t] = await q.claim({ workerId: 'w1', now: app.clock.now, leaseMs: 120_000, limit: 1 });
    return { q, t: t! };
  }

  it('entrada: só com assinatura e lease vivo; devolve conteúdo, classe, versão do prompt e meta; sem entrada 404', async () => {
    const { t } = await leased();
    await io().putInput('gw-1', { pauta: 'conteúdo público' }, { taskClass: 'draft', promptVersion: 'editorial-0.2', reviewedDraftTaskId: 'task-rascunho-1' });
    const ok = await post(ioInput, { taskId: t.id, leaseId: t.leaseId });
    expect(ok).toMatchObject({ status: 200, body: { data: { refId: 'gw-1', input: { pauta: 'conteúdo público' }, taskClass: 'draft', promptVersion: 'editorial-0.2', meta: { reviewedDraftTaskId: 'task-rascunho-1' } } } });
    expect((await post(ioInput, { taskId: t.id, leaseId: t.leaseId }, { secret: null })).status).toBe(401);
    expect((await post(ioInput, { taskId: t.id, leaseId: t.leaseId }, { secret: 'outro' })).status).toBe(401);
    expect((await post(ioInput, { taskId: t.id, leaseId: 'lease-errado' })).status).toBe(409);
    expect((await post(ioInput, { taskId: 'nao-existe', leaseId: 'x' })).status).toBe(404);
    expect((await post(ioInput, { taskId: t.id })).status).toBe(400);
    await app.db.delete(schema.openbotIo as any);
    expect((await post(ioInput, { taskId: t.id, leaseId: t.leaseId })).status).toBe(404); // lease vivo, sem entrada gravada
  });

  it('o lease antigo morre quando a tarefa é reentregue; a via seguinte (lease novo) lê a MESMA entrada', async () => {
    const { q, t } = await leased(2);
    await io().putInput('gw-2', { x: 1 }, { taskClass: 'draft', promptVersion: 'v' });
    const depois = new Date(app.clock.now.getTime() + 10 * 60_000);
    const [novo] = await q.claim({ workerId: 'w2', now: depois, leaseMs: 40 * 60_000, limit: 1 }); // o lease de w1 venceu; w2 pega com validade longa
    expect(novo!.id).toBe(t.id);
    expect((await post(ioInput, { taskId: t.id, leaseId: t.leaseId })).status).toBe(409); // o lease antigo não vale mais
    expect((await post(ioInput, { taskId: t.id, leaseId: novo!.leaseId })).body.data.input).toEqual({ x: 1 });
  });

  it('kill switch bloqueia a leitura e a gravação (423)', async () => {
    const { t } = await leased(3);
    await io().putInput('gw-3', { x: 1 }, { taskClass: 'draft', promptVersion: 'v' });
    await new PostgresLedgerStore(app.db as unknown as SqlDatabase).setKill('global', true, 'parada geral', app.clock.now);
    expect((await post(ioInput, { taskId: t.id, leaseId: t.leaseId })).body.error.code).toBe('KILL_SWITCH');
    expect((await post(ioResult, { taskId: t.id, leaseId: t.leaseId, result: { a: 1 } })).body.error.code).toBe('KILL_SWITCH');
  });

  it('resultado: resultRef derivado, primeira gravação vence, repetir devolve o mesmo, conteúdo diferente na mesma tentativa = 409, teto de 256 KB', async () => {
    const { t } = await leased(4);
    const a = await post(ioResult, { taskId: t.id, leaseId: t.leaseId, result: { texto: 'rascunho' } });
    expect(a).toMatchObject({ status: 200, body: { data: { resultRef: `res-${t.id}-a1` } } });
    expect((await post(ioResult, { taskId: t.id, leaseId: t.leaseId, result: { texto: 'rascunho' } })).body.data.resultRef).toBe(`res-${t.id}-a1`);
    expect((await post(ioResult, { taskId: t.id, leaseId: t.leaseId, result: { texto: 'OUTRO' } })).status).toBe(409);
    expect(await io().getResult(`res-${t.id}-a1`)).toEqual({ texto: 'rascunho' }); // a primeira gravação ficou
    const { t: t2 } = await leased(5);
    expect((await post(ioResult, { taskId: t2.id, leaseId: t2.leaseId, result: 'x'.repeat(300 * 1024) })).status).toBe(413);
    expect((await post(ioResult, { taskId: t2.id, leaseId: t2.leaseId })).status).toBe(400); // sem result
    expect((await post(ioResult, { taskId: t2.id, leaseId: 'errado', result: {} })).status).toBe(409);
  });

  it('o callback de completed só aceita o resultRef derivado (422 RESULT_REF_MISMATCH) e NÃO consome o callbackId; o certo, com o mesmo callbackId, fecha a tarefa e o resultado fica legível pela Fábrica', async () => {
    const { q, t } = await leased(6);
    const { body } = await post(ioResult, { taskId: t.id, leaseId: t.leaseId, result: { ok: true } });
    const base = { callbackId: 'cb-rr', taskId: t.id, leaseId: t.leaseId, outcome: 'completed' };
    for (const bad of [undefined, 'res-de-outra-tarefa-a1', `res-${t.id}-a2`]) {
      const r = await post(callback, { ...base, ...(bad ? { resultRef: bad } : {}) });
      expect([r.status, r.body.error.code]).toEqual([422, 'RESULT_REF_MISMATCH']);
    }
    expect((await q.get(t.id))!.status).toBe('leased');
    const good = await post(callback, { ...base, resultRef: body.data.resultRef });
    expect(good).toMatchObject({ status: 200, body: { duplicate: false, task: { status: 'completed' } } });
    expect(await io().getResult(body.data.resultRef)).toEqual({ ok: true });
  });
});

describe('PgTaskIo (a Fábrica grava a entrada no mesmo processo)', () => {
  it('putInput é idempotente: mesmo conteúdo (ordem das chaves não importa) = nada a fazer; conteúdo diferente = InputConflict; teto de 512 KB', async () => {
    const io = new PgTaskIo(app.db as any, app.deps.now);
    const meta = { taskClass: 'draft' as const, promptVersion: 'v1' };
    await io.putInput('gw-x', { a: 1, b: [1, 2] }, meta);
    await io.putInput('gw-x', { b: [1, 2], a: 1 }, meta);
    await expect(io.putInput('gw-x', { a: 2 }, meta)).rejects.toMatchObject({ name: 'InputConflict' });
    await expect(io.putInput('gw-y', 'x'.repeat(600 * 1024), meta)).rejects.toMatchObject({ name: 'IoTooLargeError' });
    await io.putInput('gw-z', 'x'.repeat(400 * 1024), meta); // entrada grande cabe (até 512 KB)
    expect(await io.getResult('gw-x')).toBeNull(); // entrada não é resultado
  });
});

describe('piloto (só staging, só com decisão registrada) e gate do AgentOps', () => {
  const on = () => Object.assign(process.env, { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' });
  const off = () => {
    delete process.env.APP_ENV;
    delete process.env.LN_OPENBOT_PILOT;
  };
  afterEach(off);

  it('sem APP_ENV=staging E LN_OPENBOT_PILOT=1 o piloto não existe (produção ou só uma das duas variáveis); pull sem account funciona como antes', async () => {
    for (const env of [{ APP_ENV: 'production', LN_OPENBOT_PILOT: '1' }, { APP_ENV: 'staging' }, { LN_OPENBOT_PILOT: '1' }]) {
      off();
      Object.assign(process.env, env);
      expect((await post(pull, { workerId: 'w1' })).status, JSON.stringify(env)).toBe(200);
    }
  });

  it('piloto ligado com o gate REAL do AgentOps (@ln/agents exporta canDispatchNext) e sem linhas pendentes: o pull exige a via e entrega', async () => {
    await queue().enqueue(task(8), app.clock.now);
    on();
    expect((await post(pull, { workerId: 'w1' })).status).toBe(400); // piloto: o pull informa a via
    const r = await post(pull, { workerId: 'w1', account: 'claude' });
    expect(r.status).toBe(200);
    off();
  });

  it('piloto ligado: sem o gate do AgentOps (@ln/agents sem canDispatchNext) FALHA FECHADO com o motivo, nada é entregue', async () => {
    await queue().enqueue(task(7), app.clock.now);
    vi.doMock('@ln/agents', () => ({}));
    on();
    expect((await post(pull, { workerId: 'w1' })).status).toBe(400); // piloto: o pull informa a via
    const r = await post(pull, { workerId: 'w1', account: 'claude' });
    vi.doUnmock('@ln/agents');
    expect(r).toMatchObject({ status: 423, body: { error: { code: 'PILOT_STOPPED' } } });
    expect(JSON.stringify(r.body)).toMatch(/canDispatchNext/);
    off();
    expect(await queue().counts()).toMatchObject({ pending: 1, leased: 0 });
  });
});
