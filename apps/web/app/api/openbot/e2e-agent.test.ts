/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { openbotFlagsFrom, OPENBOT_PERMISSIONS, OpenBotModelGateway, type OpenBotDeps, type GatewayRequestLike } from '@ln/openbot';
import { FakeOpenBot, type AgentDecision, type AgentPath, type AgentTransport } from '@ln/openbot/testing';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgTaskIo } from '@ln/workers/openbot-pg';
import { makeApp } from '../_lib/testkit';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';

// TESTE DE PONTA A PONTA LOCAL (ADR-003): Fábrica (OpenBotModelGateway + PgTaskIo) -> fila PostgreSQL -> AGENTE FALSO do OpenBot
// (pull -> io/input -> io/result -> callback HMAC) pelas ROTAS REAIS de /api/openbot, sobre o PGlite do testkit.
// Parte 1: flag `openbotDispatch` DESLIGADA (o padrão do contrato). Parte 2: ligada SÓ aqui, no ambiente de teste (a flag volta a
// desligar no fim e o contrato continua desligado). Nada chama OpenBot, modelo ou rede: o agente é um objeto em processo.
const SECRET = 'segredo-e2e-somente-teste';
let app: Awaited<ReturnType<typeof makeApp>>;

const ROUTES: Record<AgentPath, { POST: (r: Request) => Promise<Response> }> = {
  pull, heartbeat, callback, 'io/input': ioInput, 'io/result': ioResult,
} as any;
const transport: AgentTransport = async (path, raw, headers) => {
  const res = await ROUTES[path].POST(new Request(`http://localhost:3000/api/openbot/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

type Behaviors = { [account: string]: (kind: string, attempt: number) => AgentDecision };
let behaviors: Behaviors;
const MODELS = { claude: 'claude-sonnet-5-5', codex: 'gpt-5.1-codex', opencode: 'opencode/deepseek-v4.1-flash-free', antigravity: 'gemini-3-pro' } as const;
const agent = (account: keyof typeof MODELS) =>
  new FakeOpenBot({
    account, workerId: `fake-${account}`, secret: SECRET, transport, now: () => app.clock.now.getTime(),
    decide: (t) => behaviors[account]?.(t.kind, t.attempt) ?? { type: 'result', result: { de: account, kind: t.kind }, model: MODELS[account] },
  });
let agents: Record<keyof typeof MODELS, FakeOpenBot>;

/** Fábrica: gateway sobre as MESMAS tabelas das rotas. O `sleep` do gateway é quem deixa os agentes trabalharem (determinístico, sem timers). */
function factory(timeoutMs = 20_000) {
  const flags = () => openbotFlagsFrom({ overrides: { openbotDispatch: app.deps.flags.openbotDispatch === true }, kill: false });
  const db = app.db as any;
  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db), ledger: new PgCostLedger(db, app.deps.now), health: new PgHealthStore(db), callbacks: new PgCallbackStore(db),
    secrets: () => [SECRET], flags, now: app.deps.now, requireDerivedResultRef: true,
  };
  let t = 0;
  const gw = new OpenBotModelGateway({
    deps, io: new PgTaskIo(db, app.deps.now), caller: { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch] }, timeoutMs, pollMs: 1,
    profiles: { triage: 'writer_pontos', context: 'writer_pontos', draft: 'writer_pontos', factcheck: 'writer_pontos', review: 'writer_pontos', social_pack: 'writer_pontos', roles: 'writer_pontos' },
    clock: () => t,
    sleep: async () => {
      t += 1000;
      for (const a of [agents.opencode, agents.codex, agents.antigravity, agents.claude]) await a.tick();
    },
  });
  return { gw, deps };
}
const req = (over: Partial<GatewayRequestLike> = {}): GatewayRequestLike => ({
  taskClass: 'draft', route: 'draft', workflow: 'WF02', idempotencyKey: 'e2e-1', promptVersion: 'editorial-0.2', dataClass: 'public', excludeProviders: [], input: { pauta: 'texto público' }, ...over,
});
const tasks = () => app.db.select().from(schema.openbotTasks) as unknown as Promise<any[]>;
const costs = () => app.db.select().from(schema.openbotCostEntries) as unknown as Promise<any[]>;
const callbacks = () => app.db.select().from(schema.openbotCallbacks) as unknown as Promise<any[]>;
const inputs = () => app.db.select().from(schema.openbotIo) as unknown as Promise<any[]>;

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  process.env.OPENBOT_HMAC_SECRET = SECRET;
  delete process.env.OPENBOT_HMAC_SECRET_PREVIOUS;
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
  app.deps.flags.openbotDispatch = false; // todo teste começa no padrão do contrato: desligada
  behaviors = {};
  agents = { claude: agent('claude'), codex: agent('codex'), opencode: agent('opencode'), antigravity: agent('antigravity') };
});
afterEach(async () => {
  for (const tbl of [schema.openbotCostEntries, schema.openbotCallbacks, schema.openbotHealth, schema.openbotPilotRows, schema.openbotPilotState, schema.openbotIo, schema.openbotTasks, schema.budgetKillSwitch]) await app.db.delete(tbl as any);
});
afterAll(async () => {
  delete process.env.OPENBOT_HMAC_SECRET;
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe('E2E parte 1: flag openbotDispatch DESLIGADA (padrão do contrato)', () => {
  it('o contrato entrega a flag desligada e o ambiente de teste parte dela', () => {
    expect(FLAG_DEFAULTS.openbotDispatch).toBe(false);
    expect(app.deps.flags.openbotDispatch).toBe(false);
  });

  it('a Fábrica não despacha NEM grava entrada; o agente puxa e recebe 423 DISPATCH_OFF; nada é lido, gravado ou cobrado', async () => {
    const { gw } = factory();
    const r = await gw.invoke(req());
    expect(r).toMatchObject({ ok: false, refusal: 'model_disabled', detail: 'DISPATCH_OFF' });
    expect(await tasks()).toHaveLength(0);
    expect(await inputs()).toHaveLength(0); // nenhuma entrada órfã no armazém

    for (const a of Object.values(agents)) {
      const [run] = await a.tick();
      expect(run).toMatchObject({ decision: 'sem_entrada', steps: [{ path: 'pull', status: 423, code: 'DISPATCH_OFF' }] });
    }
    expect(await costs()).toHaveLength(0);
    expect(await callbacks()).toHaveLength(0);
  });

  it('uma tarefa JÁ em curso quando a flag é desligada ainda fecha (io/input, io/result, callback), para não perder o que foi gasto; um novo pull não entrega', async () => {
    app.deps.flags.openbotDispatch = true;
    const q = new PgLeaseQueue(app.db as any);
    await new PgTaskIo(app.db as any, app.deps.now).putInput('gw-curso', { x: 1 }, { taskClass: 'factcheck', promptVersion: 'p' });
    await q.enqueue({ kind: 'fact_check', profileId: 'writer_pontos', refId: 'gw-curso', idempotencyKey: 'curso', dataClass: 'public', maxCostMicro: 1, route: ['codex'] }, app.clock.now);
    const p = await agents.codex.pull();
    expect(p.status).toBe(200);
    app.deps.flags.openbotDispatch = false; // desligada com a tarefa já entregue
    const run = await agents.codex.run(p.body.tasks[0]);
    expect(run.steps.map((s) => [s.path, s.status])).toEqual([['io/input', 200], ['io/result', 200], ['callback', 200]]);
    expect((await tasks())[0]).toMatchObject({ status: 'completed' });
    expect((await agents.codex.tick())[0]!.steps[0]).toMatchObject({ status: 423, code: 'DISPATCH_OFF' });
  });
});

describe('E2E parte 2: flag LIGADA só no ambiente de teste', () => {
  beforeEach(() => {
    app.deps.flags.openbotDispatch = true;
  });

  it('ciclo completo: redação (claude) -> checagem independente (codex) com reviewedDraftTaskId; custo 0 na faixa de assinatura; ids derivados; callback registrado', async () => {
    const { gw } = factory();
    const draft = await gw.invoke(req());
    expect(draft).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5', output: { de: 'claude', kind: 'editorial_draft' }, usage: { costMicrosUsd: 0 } });
    const draftTask = (await tasks()).find((t) => t.kind === 'editorial_draft');
    expect(draftTask).toMatchObject({ status: 'completed', resultRef: `res-${draftTask.id}-a1` });

    let seenMeta: unknown;
    behaviors.codex = (kind) => ({ type: 'result', result: { verdict: 'pass', kind }, model: MODELS.codex });
    const orig = agents.codex.call.bind(agents.codex);
    agents.codex.call = async (path, body, over) => {
      const r = await orig(path, body, over);
      if (path === 'io/input' && r.status === 200) seenMeta = r.body.data.meta;
      return r;
    };
    const check = await gw.invoke(req({ taskClass: 'factcheck', route: 'factcheck', idempotencyKey: 'e2e-check', excludeProviders: ['anthropic'], input: { reviewedDraftTaskId: draftTask.id, claims: ['x'] } }));
    expect(check).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-5.1-codex', output: { verdict: 'pass' } });
    expect(seenMeta).toEqual({ reviewedDraftTaskId: draftTask.id }); // a prova de independência chega ao agente por meta, nunca pelo fio da fila

    const all = await tasks();
    expect(all.map((t) => t.status)).toEqual(['completed', 'completed']);
    const c = await costs();
    expect(c).toHaveLength(2);
    expect(c.every((e) => e.costMicro === 0 && e.overrun === false)).toBe(true);
    expect(c.map((e) => e.lane).sort()).toEqual(['subscription', 'subscription']);
    expect(await callbacks()).toHaveLength(2);
    // a claude não executou a checagem e a codex não escreveu o rascunho
    expect(agents.claude.runs.map((r) => r.kind)).toEqual(expect.arrayContaining(['editorial_draft']));
    expect(agents.claude.runs.some((r) => r.kind === 'fact_check')).toBe(false);
    expect(agents.codex.runs.some((r) => r.kind === 'editorial_draft')).toBe(false);
    // só ids no fio: o corpo do pull não carrega conteúdo
    const pulled = [...agents.codex.replies, ...agents.claude.replies].flatMap((r) => r.body?.tasks ?? []);
    for (const t of pulled) expect(JSON.stringify(t)).not.toMatch(/texto público|claims|Rascunho/);
  });

  it('limite da codex na checagem: passa à antigravity (sem consumir tentativa); modelo de outra família mantém a independência', async () => {
    const { gw } = factory();
    behaviors.codex = () => ({ type: 'limit', message: 'limite atingido', resumeInMs: 3_600_000 });
    const r = await gw.invoke(req({ taskClass: 'factcheck', route: 'factcheck', idempotencyKey: 'e2e-lim', excludeProviders: ['anthropic'], input: { claims: ['y'] } }));
    expect(r).toMatchObject({ ok: true, provider: 'google', model: 'gemini-3-pro' });
    const [t] = await tasks();
    expect(t).toMatchObject({ status: 'completed', routeIndex: 1 });
    expect(agents.codex.runs.map((x) => x.decision)).toEqual(['limit']);
    expect(agents.antigravity.runs.at(-1)).toMatchObject({ decision: 'result', account: 'antigravity' });
    expect((await costs())[0]).toMatchObject({ lane: 'antigravity', costMicro: 0 });
  });

  it('antigravity hospedando um Claude NÃO é independente de um redator Claude: a Fábrica recusa pelo modelo declarado', async () => {
    const { gw } = factory();
    behaviors.codex = () => ({ type: 'limit', message: 'limite', resumeInMs: 3_600_000 });
    behaviors.antigravity = () => ({ type: 'result', result: { verdict: 'pass' }, model: 'claude-sonnet-5-5' });
    const r = await gw.invoke(req({ taskClass: 'factcheck', route: 'factcheck', idempotencyKey: 'e2e-ind', excludeProviders: ['anthropic'], input: {} }));
    expect(r).toMatchObject({ ok: false, refusal: 'no_independent_provider' });
  });

  it('redação nunca troca de via: no limite espera a janela (pending_timeout) e a MESMA tarefa é retomada pela claude depois, com a tentativa 2', async () => {
    const { gw } = factory(5_000);
    let first = true;
    behaviors.claude = () => {
      if (first) {
        first = false;
        return { type: 'limit', message: 'limite da assinatura', resumeInMs: 10 * 60_000 };
      }
      return { type: 'result', result: { texto: 'retomado' }, model: MODELS.claude };
    };
    const a = await gw.invoke(req({ idempotencyKey: 'e2e-draft-lim' }));
    expect(a).toMatchObject({ ok: false, refusal: 'model_disabled' });
    expect((a as any).detail).toMatch(/pending_timeout/);
    expect((await tasks())).toHaveLength(1);
    for (const other of [agents.codex, agents.opencode, agents.antigravity]) expect(other.runs.filter((r) => r.kind === 'editorial_draft')).toEqual([]); // nenhuma outra via recebeu
    const taskId = (await tasks())[0].id;

    app.clock.now = new Date(app.clock.now.getTime() + 11 * 60_000); // a janela voltou
    const b = await factory(5_000).gw.invoke(req({ idempotencyKey: 'e2e-draft-lim' }));
    expect(b).toMatchObject({ ok: true, output: { texto: 'retomado' } });
    const all = await tasks();
    expect(all).toHaveLength(1); // a mesma tarefa
    expect(all[0]).toMatchObject({ id: taskId, status: 'completed', routeIndex: 0, resultRef: `res-${taskId}-a2` });
  });

  it('recusas no fio: assinatura errada/ausente/vencida, lease alheio, resultRef de outra tarefa, replay do callback e escrita depois de concluída', async () => {
    const q = new PgLeaseQueue(app.db as any);
    const io = new PgTaskIo(app.db as any, app.deps.now);
    for (const n of [1, 2]) {
      await io.putInput(`gw-w${n}`, { n }, { taskClass: 'factcheck', promptVersion: 'p' });
      await q.enqueue({ kind: 'fact_check', profileId: 'writer_pontos', refId: `gw-w${n}`, idempotencyKey: `w${n}`, dataClass: 'public', maxCostMicro: 1, route: ['codex'] }, app.clock.now);
    }
    const a = agents.codex;
    const got = await a.pull(2);
    const [t1, t2] = got.body.tasks as any[];
    const lease = { taskId: t1.id, leaseId: t1.leaseId };

    // autenticação
    expect((await a.call('io/input', lease, { secret: null })).status).toBe(401);
    expect((await a.call('io/input', lease, { secret: 'outro-segredo' })).status).toBe(401);
    expect((await a.call('io/input', lease, { ts: app.clock.now.getTime() - 10 * 60_000 })).status).toBe(401);
    expect((await a.call('callback', null, { raw: '{"callbackId":"x"}', secret: 'outro-segredo' })).status).toBe(401);
    // lease alheio
    expect((await a.call('io/input', { taskId: t1.id, leaseId: t2.leaseId })).status).toBe(409);
    expect((await a.call('io/result', { taskId: t1.id, leaseId: 'lease-errado', result: {} })).status).toBe(409);

    // resultRef: o agente grava, mas só o derivado fecha; o da outra tarefa é recusado e NÃO consome o callbackId
    const w1 = await a.call('io/result', { ...lease, result: { v: 1 } });
    const w2 = await a.call('io/result', { taskId: t2.id, leaseId: t2.leaseId, result: { v: 2 } });
    const body = (ref: string) => ({
      callbackId: 'cb-fixo', ...lease, outcome: 'completed', resultRef: ref,
      usage: { executionId: 'ex-fixo', ...lease, model: MODELS.codex, lane: 'subscription', account: 'codex', costMicro: 0 },
    });
    const bad = await a.call('callback', body(w2.body.data.resultRef));
    expect([bad.status, bad.body.error.code]).toEqual([422, 'RESULT_REF_MISMATCH']);
    expect((await tasks()).find((t) => t.id === t1.id)).toMatchObject({ status: 'leased' });
    const ok = await a.call('callback', body(w1.body.data.resultRef));
    expect(ok).toMatchObject({ status: 200, body: { duplicate: false, costRecorded: true } });
    // replay do mesmo callbackId: 200 duplicate, sem novo custo
    const dup = await a.call('callback', body(w1.body.data.resultRef));
    expect(dup).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(await costs()).toHaveLength(1);
    // depois de concluída o lease não vale mais para ler nem gravar
    expect((await a.call('io/input', lease)).status).toBe(409);
    expect((await a.call('io/result', { ...lease, result: { v: 'outro' } })).status).toBe(409);
  });

  it('via fora da rota: a claude não recebe tarefa da codex; trilha com outra conta é recusada (422) e a tarefa segue com o lease', async () => {
    const q = new PgLeaseQueue(app.db as any);
    await new PgTaskIo(app.db as any, app.deps.now).putInput('gw-rt', { x: 1 }, { taskClass: 'factcheck', promptVersion: 'p' });
    await q.enqueue({ kind: 'fact_check', profileId: 'writer_pontos', refId: 'gw-rt', idempotencyKey: 'rt', dataClass: 'public', maxCostMicro: 1, route: ['codex'] }, app.clock.now);
    expect((await agents.claude.pull()).body.tasks).toEqual([]); // via errada: nada
    const [t] = (await agents.codex.pull()).body.tasks as any[];
    const lease = { taskId: t.id, leaseId: t.leaseId };
    const w = await agents.codex.call('io/result', { ...lease, result: { v: 1 } });
    const wrong = await agents.codex.call('callback', {
      callbackId: 'cb-rt', ...lease, outcome: 'completed', resultRef: w.body.data.resultRef,
      usage: { executionId: 'ex-rt', ...lease, model: MODELS.claude, lane: 'subscription', account: 'claude', costMicro: 0 },
      trace: { stage: 'factcheck', account: 'claude', startedAt: app.clock.now.toISOString(), endedAt: app.clock.now.toISOString() },
    });
    expect(wrong.status).toBe(422);
    expect((await tasks())[0]).toMatchObject({ status: 'leased' });
    expect(await costs()).toHaveLength(0);
  });

  it('piloto (staging + LN_OPENBOT_PILOT=1) sem o gate do AgentOps (@ln/agents sem canDispatchNext, por mock): o agente é recusado (423 PILOT_STOPPED) e nada é entregue; sem a variável, segue normal', async () => {
    vi.doMock('@ln/agents', () => ({}));
    const q = new PgLeaseQueue(app.db as any);
    await new PgTaskIo(app.db as any, app.deps.now).putInput('gw-pl', { x: 1 }, { taskClass: 'factcheck', promptVersion: 'p' });
    await q.enqueue({ kind: 'fact_check', profileId: 'writer_pontos', refId: 'gw-pl', idempotencyKey: 'pl', dataClass: 'public', maxCostMicro: 1, route: ['codex'] }, app.clock.now);
    Object.assign(process.env, { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' });
    const [run] = await agents.codex.tick();
    vi.doUnmock('@ln/agents');
    expect(run!.steps[0]).toMatchObject({ path: 'pull', status: 423, code: 'PILOT_STOPPED' });
    expect((await tasks())[0]).toMatchObject({ status: 'pending' });
    delete process.env.APP_ENV;
    delete process.env.LN_OPENBOT_PILOT;
    expect((await agents.codex.tick())[0]).toMatchObject({ decision: 'result' });
  });

  it('desligar a flag no fim volta ao estado inicial: o agente é recusado de novo (a flag do teste nunca vaza)', async () => {
    app.deps.flags.openbotDispatch = false;
    expect((await agents.codex.tick())[0]!.steps[0]).toMatchObject({ status: 423, code: 'DISPATCH_OFF' });
  });
});
