import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '@ln/auth';
import { createTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { handleCallback, handlePull, resultRefFor, signBody, type GatewayRequestLike, type OpenBotDeps, type PullResult } from '@ln/openbot';
import { createPilotWiring, pilotWiringImporter, PILOT_PROFILES, type LoadAgentsKit } from './openbot-wiring';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotResolutionStore, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from './openbot-pg';

// Fiação do piloto (DP-41) sobre o PostgreSQL de teste: o gateway da Fábrica + o sink do veredito, com um agente de mentira (em processo) respondendo
// pelos MESMOS handlers e tabelas das rotas. O kit do AgentOps (gate e applyRowPatch) é injetado; com o `@ln/agents` real o ensaio roda na árvore integrada.
const STAGING = { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1', LN_FLAGS_ON: 'openbotDispatch' } as const;
const SECRET = 'segredo-de-teste-fiacao';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const kitOk: LoadAgentsKit = async () => ({
  canDispatchNext: () => ({ allowed: true, reasons: [] }),
  verdictStreakReasons: () => [], // critério 3 do PM (2 falhas seguidas do patch do veredito): sem falha
  // o applyRowPatch do AgentOps recusa campo de medição do adaptador: o de teste recusa só `declared_model`
  applyRowPatch: ((row: unknown, patch: Record<string, unknown>) => ({ row, errors: 'declared_model' in patch ? ['campo de medição do adaptador'] : [] })) as never,
});

const closers: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of closers) await c();
});
const fresh = async () => {
  const t = await createTestDb();
  closers.push(t.close);
  return t.db as unknown as Db;
};
const req = (taskClass: GatewayRequestLike['taskClass'], key: string, input: unknown = {}): GatewayRequestLike => ({
  taskClass, route: taskClass, workflow: 'WF02', idempotencyKey: key, promptVersion: 'editorial-0.3', dataClass: 'public', excludeProviders: [], input,
});

/** O agente de mentira: puxa pela via, grava o resultado e manda o callback assinado com a trilha, pelos handlers e stores reais. */
function agentFor(db: Db) {
  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db), ledger: new PgCostLedger(db, () => NOW), health: new PgHealthStore(db), callbacks: new PgCallbackStore(db),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW, requireDerivedResultRef: true,
    pilot: { enabled: true, rows: new PgPilotRowStore(db, () => NOW), state: new PgPilotStateStore(db), gate: () => ({ allowed: true, reasons: [] }) },
  };
  const io = new PgTaskIo(db, () => NOW);
  const sign = (o: unknown) => { const body = JSON.stringify(o); return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() }; };
  let n = 0;
  return async (account: 'claude' | 'codex' | 'opencode', model: string, stage: string) => {
    const [t] = ((await handlePull(deps, sign({ workerId: `fake-${account}`, account }))).body as PullResult).tasks;
    if (!t) return null;
    await io.putResultFor(resultRefFor(t.id, t.attempt), t.id, { de: account });
    const usage = { executionId: `ex-${t.id}-${t.attempt}`, taskId: t.id, leaseId: t.leaseId, model, lane: (account === 'opencode' ? 'opencode' : 'subscription') as 'opencode' | 'subscription', account, costMicro: 0 };
    await handleCallback(deps, sign({
      callbackId: `cb-${++n}-${t.id}`, taskId: t.id, leaseId: t.leaseId, outcome: 'completed', resultRef: resultRefFor(t.id, t.attempt), usage,
      trace: { stage, account, startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), articleId: 'art-9', promptVersion: 'editorial-0.3' },
    }));
    return t;
  };
}

describe('createPilotWiring: falha fechada (nada é criado)', () => {
  it('recusa sem staging, sem LN_OPENBOT_PILOT, com a flag desligada (sem LN_FLAGS_ON) e sem o kit do AgentOps; nenhuma tarefa nasce', async () => {
    const db = await fresh();
    await expect(createPilotWiring({ ...STAGING, APP_ENV: 'production' }, db, { loadKit: kitOk })).rejects.toThrow(/APP_ENV=staging/);
    await expect(createPilotWiring({}, db, { loadKit: kitOk })).rejects.toThrow(/APP_ENV=staging/);
    await expect(createPilotWiring({ APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch' }, db, { loadKit: kitOk })).rejects.toThrow(/LN_OPENBOT_PILOT=1/);
    await expect(createPilotWiring({ APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' }, db, { loadKit: kitOk })).rejects.toThrow(/openbotDispatch está desligada/);
    await expect(createPilotWiring({ ...STAGING }, db, { loadKit: async () => null })).rejects.toThrow(/canDispatchNext\/applyRowPatch/);
    await expect(createPilotWiring({ ...STAGING }, db, { loadKit: async () => ({ canDispatchNext: () => ({ allowed: true, reasons: [] }) }) })).rejects.toThrow(/applyRowPatch/);
    // kit anterior ao critério 3 do PM (sem verdictStreakReasons): o piloto não despacha
    const kitSemCriterio3 = { ...(await kitOk()) } as Record<string, unknown>;
    delete kitSemCriterio3['verdictStreakReasons'];
    await expect(createPilotWiring({ ...STAGING }, db, { loadKit: async () => kitSemCriterio3 as never })).rejects.toThrow(/verdictStreakReasons/);
    expect(await db.select().from(schema.openbotTasks)).toHaveLength(0);
  });

  it('o importador estático entrega createPilotWiring preso ao db (para loadPilotWiring da Fábrica empacotada)', async () => {
    const db = await fresh();
    const mod = await pilotWiringImporter(db, { loadKit: kitOk })('qualquer-nome');
    expect(typeof mod['createPilotWiring']).toBe('function');
    const w = (await (mod['createPilotWiring'] as (e: unknown) => Promise<{ gateway: { invoke: unknown }; sink: { patch: unknown } }>)({ ...STAGING }));
    expect([typeof w.gateway.invoke, typeof w.sink.patch]).toEqual(['function', 'function']);
  });
});

describe('createPilotWiring: o ciclo da Fábrica', () => {
  it('invoke despacha pelo perfil do piloto, só na claude (DP-41), devolve taskId e attempt com a linha já gravada, e o sink grava o veredito pelo applyRowPatch', async () => {
    const db = await fresh();
    const agent = agentFor(db);
    let ran = false;
    const { gateway, sink } = await createPilotWiring({ ...STAGING }, db, {
      loadKit: kitOk, now: () => NOW, sleep: async () => { if (!ran) { ran = true; await agent('opencode', 'deepseek-v4.1-flash', 'triage'); } },
    });
    const r = await gateway.invoke(req('triage', 'art-9:triage:1', { pauta: 'x' }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect([r.attempt, r.provider, r.output]).toEqual([1, 'deepseek', { de: 'opencode' }]);
    const [t] = await db.select().from(schema.openbotTasks);
    expect(t).toMatchObject({ id: r.taskId, profileId: PILOT_PROFILES.triage, route: ['opencode', 'claude'], status: 'completed' });
    const rows = await new PgPilotRowStore(db, () => NOW).all();
    expect(rows.map((x) => [x.task_id, x.attempt, x.article_id, x.stage])).toEqual([[r.taskId, 1, 'art-9', 'triage']]);

    await sink.patch({ taskId: r.taskId, attempt: r.attempt, stage: 'triage', patch: { output_valid: true } });
    expect((await new PgPilotRowStore(db, () => NOW).all())[0]!.output_valid).toBe(true);
    await expect(sink.patch({ taskId: r.taskId, attempt: r.attempt, stage: 'triage', patch: { declared_model: 'outro' } })).rejects.toThrow(/patch recusado/);
    await expect(sink.patch({ taskId: 'nao-existe', attempt: 1, stage: 'triage', patch: { output_valid: true } })).rejects.toThrow(/linha do piloto inexistente/);
    expect((await new PgPilotRowStore(db, () => NOW).all())[0]!.declared_model).toBe('deepseek-v4.1-flash'); // o patch recusado não mudou nada
  });

  it('a checagem vai só ao codex e leva o id da tarefa do rascunho em meta; a Editorial pode usar o taskId devolvido', async () => {
    const db = await fresh();
    const agent = agentFor(db);
    const steps: Array<() => Promise<unknown>> = [
      () => agent('opencode', 'deepseek-v4.1-flash', 'draft'),
      () => agent('opencode', 'deepseek-v4.1-flash', 'factcheck'),
    ];
    const { gateway } = await createPilotWiring({ ...STAGING }, db, { loadKit: kitOk, now: () => NOW, sleep: async () => { const s = steps.shift(); if (s) await s(); } });
    const draft = await gateway.invoke(req('draft', 'art-9:draft:1'));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const check = await gateway.invoke(req('factcheck', 'art-9:factcheck:1', { reviewedDraftTaskId: draft.taskId }));
    expect(check.ok, JSON.stringify(check)).toBe(true);
    const tasks = await db.select().from(schema.openbotTasks);
    expect(tasks.map((x) => [x.kind, x.route, x.profileId])).toEqual(expect.arrayContaining([['editorial_draft', ['opencode'], 'ln_pilot_redator'], ['fact_check', ['opencode'], 'ln_pilot_checador']]));
    const io = (await db.select().from(schema.openbotIo)).find((x) => x.direction === 'input' && x.taskClass === 'factcheck');
    expect(io?.meta).toMatchObject({ reviewedDraftTaskId: draft.taskId });
  });

  it('kill switch da rota openbot: a chamada é recusada (kill_switch) antes de criar tarefa, e voltar a funcionar quando solto', async () => {
    const db = await fresh();
    const store = new PostgresLedgerStore(db as unknown as SqlDatabase);
    const { gateway } = await createPilotWiring({ ...STAGING, LN_OPENBOT_GATEWAY_TIMEOUT_MS: '60' }, db, { loadKit: kitOk, now: () => NOW, sleep: async () => undefined });
    await store.setKill('route:openbot', true, 'ensaio', NOW);
    const r = await gateway.invoke(req('triage', 'art-9:triage:1'));
    expect(r).toMatchObject({ ok: false, refusal: 'kill_switch' });
    expect(await db.select().from(schema.openbotTasks)).toHaveLength(0);
    await store.setKill('route:openbot', false, 'soltar', NOW);
    const again = await gateway.invoke(req('triage', 'art-9:triage:1'));
    expect(again.ok).toBe(false); // sem agente respondendo: fica na fila, não recusa por kill
    expect(!again.ok && again.refusal).toBe('model_disabled');
    expect(await db.select().from(schema.openbotTasks)).toHaveLength(1);
  }, 60_000);
});

// Com o kit REAL do AgentOps (gate e applyRowPatch de @ln/agents): só roda quando o pacote da árvore os exporta; senão fica PULADO (nunca aprovado).
const real = (await import('@ln/agents').catch(() => ({}))) as { canDispatchNext?: unknown; applyRowPatch?: unknown; verdictStreakReasons?: unknown };
describe.skipIf(typeof real.canDispatchNext !== 'function' || typeof real.applyRowPatch !== 'function' || typeof real.verdictStreakReasons !== 'function')('createPilotWiring com o kit REAL do AgentOps', () => {
  it('o carregador padrão acha o gate e o applyRowPatch; o ciclo conclui e o patch passa pela validação oficial (recusa campo de medição)', async () => {
    const db = await fresh();
    const agent = agentFor(db);
    let ran = false;
    const { gateway, sink } = await createPilotWiring({ ...STAGING, LN_OPENBOT_GATEWAY_TIMEOUT_MS: '2000' }, db, { now: () => NOW, sleep: async () => { if (!ran) { ran = true; await agent('opencode', 'deepseek-v4.1-flash', 'triage'); } } });
    const r = await gateway.invoke(req('triage', 'art-9:triage:1', { pauta: 'x' }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    await sink.patch({ taskId: r.taskId, attempt: r.attempt, stage: 'triage', patch: { output_valid: true } });
    await expect(sink.patch({ taskId: r.taskId, attempt: r.attempt, stage: 'triage', patch: { declared_model: 'outro' } })).rejects.toThrow(/patch recusado/);
    const rows = await new PgPilotRowStore(db, () => NOW).all();
    expect((real.canDispatchNext as (r: unknown) => { allowed: boolean })(rows).allowed).toBe(true); // o gate oficial aceita a linha que o adaptador gravou
  });

  // Defeito de 26/11: a Fábrica se auto-barrou (e gravou PILOT_STOPPED) por uma linha que o admin já havia tratado, porque a fiação local não passava as
  // resoluções ao portão — a rota do servidor passava. O teste falha sem `resolved` na fiação e passa com ele.
  it('linha contraditória já tratada por admin não barra a Fábrica; a mesma linha sem resolução continua parando', async () => {
    const LINHA = {
      task_id: 'task-22232792-ea32-4b30-8483-cfb385f4654e', kind: 'classification', article_id: 'art-9', source_id: 's', stage: 'triage', account: 'claude', declared_model: 'deepseek-v4.1-flash',
      prompt_version: 'editorial-0.3', started_at: NOW.toISOString(), ended_at: NOW.toISOString(), attempt: 1, outcome: 'completed', packet_chars: 100, tokens_measured: false,
      published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false,
    } as never;
    const wiring = async (db: Db, agent: ReturnType<typeof agentFor>) => {
      let first = true;
      return createPilotWiring({ ...STAGING, LN_OPENBOT_GATEWAY_TIMEOUT_MS: '60' }, db, {
        now: () => NOW,
        sleep: async () => { if (first) { first = false; await agent('opencode', 'deepseek-v4.1-flash', 'triage'); } },
      });
    };

    // (a) sem resolução: o portão RECUSA e o piloto para (o comportamento do defeito)
    const db1 = await fresh();
    await new PgPilotRowStore(db1, () => NOW).upsert(LINHA);
    const w1 = await wiring(db1, agentFor(db1));
    const blocked = await w1.gateway.invoke(req('triage', 'art-9:triage:1', { pauta: 'x' }));
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.detail).toBe('PILOT_STOPPED');
    expect(await db1.select().from(schema.openbotTasks)).toHaveLength(0);
    expect((await new PgPilotStateStore(db1).get())?.reasons).toContainEqual(expect.stringMatching(/^canDispatchNext_recusou/));

    // (b) com a resolução do admin na fiação: a MESMA linha não barra e o ciclo conclui
    const db2 = await fresh();
    await new PgPilotRowStore(db2, () => NOW).upsert(LINHA);
    const res = await new PgPilotResolutionStore(db2, () => NOW).resolve(LINHA.task_id, 1, 'admin-teste', 'linha contraditória tratada no teste', 'editorial_invalid');
    expect(res.result).toBe('created');
    const w2 = await wiring(db2, agentFor(db2));
    const okNow = await w2.gateway.invoke(req('triage', 'art-9:triage:2', { pauta: 'y' }));
    expect(okNow.ok, JSON.stringify(okNow)).toBe(true);
    expect(await new PgPilotStateStore(db2).get()).toBeNull();
  }, 60_000);
});
