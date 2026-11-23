/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
// C1 (caminho crítico): ponta a ponta ASSINADO (HMAC) pull → heartbeat → io/input → io/result → callback, com a parada ligada NO MEIO de uma
// tarefa já entregue pela rota real, para cada motivo de parada (DISPATCH_OFF, KILL_SWITCH, PILOT_STOPPED). Fixa a matriz rota × motivo
// do PROTOCOL.md ("423 Locked", PM-2026-11-23-I, ft/backend 0a2e2c8): 423 com corpo JSON e o mesmo error.code (a borda da Vertra troca o corpo
// de 502/503/504 por HTML), nunca 5xx por decisão de parar; o callback segue aceito e registra o custo já gasto; ao tirar a parada, o ciclo volta.
// Complementa openbot.test.ts e e2e-agent.test.ts (que cobrem cada recusa isolada), sem mexer nas rotas.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { signBody } from '@ln/openbot';
import { PgLeaseQueue, PgPilotStateStore, PgTaskIo } from '@ln/workers/openbot-pg';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../_lib/testkit';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';

const SECRET = 'segredo-de-teste-c1';
let app: Awaited<ReturnType<typeof makeApp>>;
type Route = { POST: (req: Request) => Promise<Response> };

async function post(r: Route, body: unknown) {
  const raw = JSON.stringify(body);
  const ts = app.clock.now.getTime();
  const res = await r.POST(
    new Request('http://localhost:3000/api/openbot/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.9', 'x-ln-timestamp': String(ts), 'x-ln-signature': signBody(SECRET, ts, raw) },
      body: raw,
    }),
  );
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: text ? JSON.parse(text) : null };
}

const PILOT_ENV = { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' };
const pilotOn = () => Object.assign(process.env, PILOT_ENV);
const pilotOff = () => {
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
};

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  process.env.OPENBOT_HMAC_SECRET = SECRET;
  delete process.env.OPENBOT_HMAC_SECRET_PREVIOUS;
  app.deps.flags.openbotDispatch = true;
  pilotOff();
});
afterEach(async () => {
  pilotOff();
  for (const tbl of [schema.openbotCostEntries, schema.openbotCallbacks, schema.openbotHealth, schema.openbotPilotRows, schema.openbotPilotState, schema.openbotIo, schema.openbotTasks, schema.budgetKillSwitch]) await app.db.delete(tbl as any);
});
afterAll(async () => {
  delete process.env.OPENBOT_HMAC_SECRET;
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

/** Enfileira uma tarefa com entrada gravada (como a Fábrica faria) e a puxa pela ROTA real assinada. */
async function entregue(n: number, pullBody: Record<string, unknown> = {}) {
  const q = new PgLeaseQueue(app.db as any);
  await q.enqueue({ kind: 'editorial_draft', profileId: 'writer_pontos', refId: `c1-${n}`, idempotencyKey: `c1-idem-${n}`, dataClass: 'public', maxCostMicro: 1_000_000 }, app.clock.now);
  await new PgTaskIo(app.db as any, app.deps.now).putInput(`c1-${n}`, { pauta: 'conteúdo público de teste' }, { taskClass: 'draft', promptVersion: 'editorial-0.2' });
  const r = await post(pull, { workerId: 'w-c1', ...pullBody });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const t = r.body.data?.tasks?.[0] ?? r.body.tasks?.[0] ?? r.body.data?.[0];
  expect(t?.leaseId, JSON.stringify(r.body)).toBeTruthy();
  return { id: t.taskId ?? t.id, leaseId: t.leaseId as string, attempt: (t.attempt ?? 1) as number };
}

async function sonda(t: { id: string; leaseId: string; attempt: number }, pullBody: Record<string, unknown> = {}) {
  const lease = { taskId: t.id, leaseId: t.leaseId };
  return {
    pull: await post(pull, { workerId: 'w-c1', ...pullBody }),
    heartbeat: await post(heartbeat, lease),
    ioInput: await post(ioInput, lease),
    ioResult: await post(ioResult, { ...lease, result: { texto: 'rascunho de teste' } }),
  };
}

type Esperado = Record<'pull' | 'heartbeat' | 'ioInput' | 'ioResult', 200 | 423>;
/** A matriz do PROTOCOL.md ("423 Locked"): DISPATCH_OFF só recusa o pull (o que está em curso fecha); parada e piloto parado recusam as 4 rotas. */
const MATRIZ: { motivo: 'DISPATCH_OFF' | 'KILL_SWITCH' | 'PILOT_STOPPED'; esperado: Esperado }[] = [
  { motivo: 'DISPATCH_OFF', esperado: { pull: 423, heartbeat: 200, ioInput: 200, ioResult: 200 } },
  { motivo: 'KILL_SWITCH', esperado: { pull: 423, heartbeat: 423, ioInput: 423, ioResult: 423 } },
  { motivo: 'PILOT_STOPPED', esperado: { pull: 423, heartbeat: 423, ioInput: 423, ioResult: 423 } },
];

const ligar = async (m: (typeof MATRIZ)[number]['motivo']) => {
  if (m === 'DISPATCH_OFF') app.deps.flags.openbotDispatch = false;
  if (m === 'KILL_SWITCH') await new PostgresLedgerStore(app.db as unknown as SqlDatabase).setKill('route:openbot', true, 'parada de teste C1', app.clock.now);
  if (m === 'PILOT_STOPPED') await new PgPilotStateStore(app.db as any).stop('parada de teste C1', app.clock.now.toISOString());
};
const desligar = async (m: (typeof MATRIZ)[number]['motivo']) => {
  if (m === 'DISPATCH_OFF') app.deps.flags.openbotDispatch = true;
  if (m === 'KILL_SWITCH') await new PostgresLedgerStore(app.db as unknown as SqlDatabase).setKill('route:openbot', false, 'voltar', app.clock.now);
  if (m === 'PILOT_STOPPED') await app.db.delete(schema.openbotPilotState as any); // o resumePilot do Studio faz isso com auditoria; aqui só o estado
};

describe('C1: pull → heartbeat → io → callback assinados, com a parada ligada no meio da tarefa', () => {
  for (const { motivo, esperado } of MATRIZ) {
    it(`${motivo}: matriz por rota (423 JSON com o código, nunca 5xx), callback aceito com o custo, e o ciclo volta ao tirar a parada`, async () => {
      const piloto = motivo === 'PILOT_STOPPED';
      if (piloto) pilotOn();
      const via = piloto ? { account: 'claude' } : {};
      const t = await entregue(1, via);
      expect((await post(heartbeat, { taskId: t.id, leaseId: t.leaseId })).status).toBe(200); // em curso, antes da parada

      await ligar(motivo);
      const s = await sonda(t, via);
      for (const [rota, r] of Object.entries(s) as [keyof Esperado, Awaited<ReturnType<typeof post>>][]) {
        expect(r.status, `${motivo} em ${rota}: ${JSON.stringify(r.body)}`).toBe(esperado[rota]);
        expect(r.status, 'decisão de parar nunca vira 5xx (a borda troca o corpo)').toBeLessThan(500);
        expect(r.contentType, `${motivo} em ${rota}`).toMatch(/^application\/json/);
        if (r.status === 423) {
          expect(r.body.error.code, `${motivo} em ${rota}`).toBe(motivo);
          expect(typeof r.body.error.message).toBe('string');
        }
      }
      if (piloto) expect(s.pull.body.error.details).toContain('parada de teste C1'); // o motivo da parada chega ao agente

      // o custo já gasto não se perde: o callback é aceito durante a parada
      const ref = esperado.ioResult === 200 ? s.ioResult.body.data.resultRef : `res-${t.id}-a${t.attempt}`;
      const usage = piloto
        ? { executionId: `exec-${t.id}`, taskId: t.id, leaseId: t.leaseId, model: 'anthropic/claude-sonnet-5.5', lane: 'subscription', account: 'claude', costMicro: 0 }
        : { executionId: `exec-${t.id}`, taskId: t.id, leaseId: t.leaseId, model: 'anthropic/claude-sonnet-5.5', generationIds: ['gen-1'], promptTokens: 1000, completionTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 400_000 };
      const trace = piloto ? { trace: { stage: 'draft', account: 'claude', promptVersion: 'editorial-0.2', startedAt: app.clock.now.toISOString(), endedAt: app.clock.now.toISOString() } } : {};
      const cb = await post(callback, { callbackId: `cb-${motivo}`, taskId: t.id, leaseId: t.leaseId, outcome: piloto ? 'failed' : 'completed', ...(piloto ? { retryable: false } : { resultRef: ref }), usage, ...trace });
      expect(cb.status, `callback em ${motivo}: ${JSON.stringify(cb.body)}`).toBe(200);
      const custos = await app.db.select().from(schema.openbotCostEntries as any);
      expect(custos, 'o custo da execução ficou registrado uma vez').toHaveLength(1);

      // tirar a parada: o ciclo volta (nova tarefa é entregue pela rota real)
      await desligar(motivo);
      const t2 = await entregue(2, via);
      expect(t2.id).not.toBe(t.id);
    }, 60_000);
  }

  // Sem assinatura: a ordem das checagens decide o que um chamador SEM o segredo descobre. Desde ft/backend 59eed1b não há exceção: a assinatura
  // vem antes de QUALQUER parada (despacho desligado, kill switch, piloto parado), em todas as rotas do agente.
  const semAssinatura = async (r: Route, body: unknown) =>
    (await r.POST(new Request('http://localhost:3000/api/openbot/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).status;

  it('sem assinatura, com kill switch ou piloto parado: 401 em pull, heartbeat, io/input e io/result (a assinatura vem antes da parada)', async () => {
    const lease = { taskId: 'task-x', leaseId: 'lease-x' };
    for (const motivo of ['KILL_SWITCH', 'PILOT_STOPPED'] as const) {
      if (motivo === 'PILOT_STOPPED') pilotOn();
      await ligar(motivo);
      expect(await semAssinatura(pull, { workerId: 'w', account: 'claude' }), `${motivo} pull`).toBe(401);
      expect(await semAssinatura(heartbeat, lease), `${motivo} heartbeat`).toBe(401);
      expect(await semAssinatura(ioInput, lease), `${motivo} io/input`).toBe(401);
      expect(await semAssinatura(ioResult, { ...lease, result: {} }), `${motivo} io/result`).toBe(401);
      await desligar(motivo);
      pilotOff();
    }
  });

  it('despacho desligado (sem kill): sem assinatura ou com segredo errado o pull dá 401 (o estado da flag não aparece); com assinatura válida, 423 DISPATCH_OFF; nada é entregue', async () => {
    // Decisão do Backend 1 (ft/backend 59eed1b): o HMAC vem antes do DISPATCH_OFF, igual ao kill switch.
    app.deps.flags.openbotDispatch = false;
    await new PgLeaseQueue(app.db as any).enqueue({ kind: 'editorial_draft', profileId: 'writer_pontos', refId: 'c1-x', idempotencyKey: 'c1-idem-x', dataClass: 'public', maxCostMicro: 1_000_000 }, app.clock.now);
    const sem = await pull.POST(new Request('http://localhost:3000/api/openbot/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"workerId":"w"}' }));
    expect(sem.status).toBe(401);
    expect(JSON.stringify(await sem.json())).not.toMatch(/DISPATCH_OFF|despacho/i);
    const raw = '{"workerId":"w"}';
    const ts = app.clock.now.getTime();
    const errado = await pull.POST(new Request('http://localhost:3000/api/openbot/pull', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ln-timestamp': String(ts), 'x-ln-signature': signBody('segredo-errado', ts, raw) }, body: raw }));
    expect(errado.status).toBe(401);
    const ok = await post(pull, { workerId: 'w' });
    expect([ok.status, ok.body.error.code]).toEqual([423, 'DISPATCH_OFF']);
    expect(await semAssinatura(heartbeat, { taskId: 'task-x', leaseId: 'lease-x' })).toBe(401);
    expect(await semAssinatura(ioInput, { taskId: 'task-x', leaseId: 'lease-x' })).toBe(401);
    expect(await semAssinatura(callback, { callbackId: 'cb-x', taskId: 'task-x', leaseId: 'lease-x', outcome: 'failed' })).toBe(401);
    expect(await new PgLeaseQueue(app.db as any).counts()).toMatchObject({ pending: 1, leased: 0 }); // nada foi entregue
  });
});
