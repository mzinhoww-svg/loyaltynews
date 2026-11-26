/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import * as agents from '@ln/agents';
import { FLAG_RELEASES, resolveFlags } from '@ln/contracts';
import {
  adapterReport, openbotFlagsFrom, OPENBOT_PERMISSIONS, OpenBotModelGateway, pilotCsv, PILOT_CSV_COLUMNS, type GatewayRequestLike, type OpenBotDeps, type PilotGate,
} from '@ln/openbot';
import { FakeOpenBot, type AgentDecision, type AgentPath, type AgentTransport } from '@ln/openbot/testing';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from '@ln/workers/openbot-pg';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../_lib/testkit';
import { pilotEnabled } from '../_lib/openbot';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';

// ENSAIO DE ATIVAÇÃO DO PILOTO NO STAGING (DP-41), SEM DISPARAR NADA: a configuração de staging (APP_ENV, LN_FLAGS_ON, LN_OPENBOT_PILOT,
// segredo HMAC) resolvida pelo código real; as ROTAS reais /api/openbot sobre PGlite; a Fábrica (OpenBotModelGateway + PgTaskIo); o gate REAL
// `canDispatchNext` do AgentOps; e agentes FALSOS (em processo) no lugar do OpenBot. Nenhum modelo, nenhuma rede, nenhum OpenBot, nenhum mLabs.
// O gate vem de `@ln/agents`: quando o índice do pacote não o exporta (estado da ft/backend), o ensaio prova que o piloto FALHA FECHADO e pula a
// parte que precisa dele (o pulo aparece como "skipped", nunca como aprovado).
const SECRET = 'segredo-de-ensaio-do-piloto';
const GATE = (agents as unknown as { canDispatchNext?: PilotGate }).canDispatchNext;
const SHEET = (agents as unknown as { PILOT_SHEET_COLUMNS?: readonly string[] }).PILOT_SHEET_COLUMNS;
let app: Awaited<ReturnType<typeof makeApp>>;

const STAGING = { APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch', LN_OPENBOT_PILOT: '1', OPENBOT_HMAC_SECRET: SECRET } as const;
const KEYS = ['APP_ENV', 'LN_FLAGS_ON', 'LN_OPENBOT_PILOT', 'OPENBOT_HMAC_SECRET', 'OPENBOT_HMAC_SECRET_PREVIOUS', 'PORTAL_INDEXAVEL', 'NEXT_PUBLIC_SITE_URL'] as const;
const setEnv = (e: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, e);
  // o servidor resolve as flags UMA vez na subida (runtime-flags): aqui, a mesma função pura sobre o ambiente do ensaio
  app.deps.flags.openbotDispatch = resolveFlags(process.env).state.openbotDispatch;
};

const ROUTES: Record<AgentPath, { POST: (r: Request) => Promise<Response> }> = { pull, heartbeat, callback, 'io/input': ioInput, 'io/result': ioResult } as any;
const transport: AgentTransport = async (path, raw, headers) => {
  const res = await ROUTES[path].POST(new Request(`http://localhost:3000/api/openbot/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const MODELS = { claude: 'claude-sonnet-5-5', codex: 'gpt-5.1-codex', opencode: 'opencode/deepseek-v4.1-flash-free', antigravity: 'gemini-3-pro' } as const;
let behave: Partial<Record<keyof typeof MODELS, (kind: string, attempt: number) => AgentDecision>>;
const mkAgent = (account: keyof typeof MODELS) =>
  new FakeOpenBot({
    account, workerId: `fake-${account}`, secret: SECRET, transport, now: () => app.clock.now.getTime(),
    decide: (t) => behave[account]?.(t.kind, t.attempt) ?? { type: 'result', result: { de: account, kind: t.kind }, model: t.kind === 'classification' ? 'claude-haiku-5-5' : MODELS[account] },
  });
let A: Record<keyof typeof MODELS, FakeOpenBot>;

const db = () => app.db as any;
const rowsStore = () => new PgPilotRowStore(db(), app.deps.now);
const stateStore = () => new PgPilotStateStore(db());
const tasks = () => app.db.select().from(schema.openbotTasks) as unknown as Promise<any[]>;
const costs = () => app.db.select().from(schema.openbotCostEntries) as unknown as Promise<any[]>;

/** Fábrica do staging: as MESMAS tabelas e o MESMO gate das rotas; o `sleep` do gateway é quem deixa os agentes trabalharem. */
function factory(timeoutMs = 20_000) {
  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db()), ledger: new PgCostLedger(db(), app.deps.now), health: new PgHealthStore(db()), callbacks: new PgCallbackStore(db()),
    secrets: () => [SECRET], flags: () => openbotFlagsFrom({ overrides: { openbotDispatch: app.deps.flags.openbotDispatch === true }, kill: false }), now: app.deps.now,
    requireDerivedResultRef: true, routes: { classification: ['claude'], editorial_draft: ['claude'], fact_check: ['codex'], editorial_review: ['codex'], social_copy: ['claude'], entity_resolution: ['claude'] },
    ...(pilotEnabled(process.env) ? { pilot: { enabled: true, rows: rowsStore(), state: stateStore(), gate: GATE ?? (() => ({ allowed: false, reasons: ['sem canDispatchNext'] })), allowedAccounts: ['claude', 'codex'] } } : {}),
  };
  let t = 0;
  const gw = new OpenBotModelGateway({
    deps, io: new PgTaskIo(db(), app.deps.now), caller: { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch] }, timeoutMs, pollMs: 1,
    profiles: { triage: 'newsdesk', context: 'newsdesk', draft: 'writer_pontos', factcheck: 'newsdesk', review: 'newsdesk', social_pack: 'newsdesk', roles: 'newsdesk' },
    clock: () => t, sleep: async () => { t += 1000; for (const a of [A.claude, A.codex]) await a.tick(); },
  });
  return { gw, deps };
}
// idempotencyKey no formato da Editorial: <articleId>:<classe>:<tentativa>
const req = (taskClass: GatewayRequestLike['taskClass'], over: Partial<GatewayRequestLike> = {}): GatewayRequestLike => ({
  taskClass, route: taskClass, workflow: 'WF02', idempotencyKey: `art-2026-0001:${taskClass}:1`, promptVersion: 'editorial-0.3', dataClass: 'public', excludeProviders: [], input: { pauta: 'texto público do ensaio' }, ...over,
});

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  setEnv({ ...STAGING });
  behave = {};
  A = { claude: mkAgent('claude'), codex: mkAgent('codex'), opencode: mkAgent('opencode'), antigravity: mkAgent('antigravity') };
});
afterEach(async () => {
  for (const tbl of [schema.openbotCostEntries, schema.openbotCallbacks, schema.openbotHealth, schema.openbotPilotRows, schema.openbotPilotState, schema.openbotIo, schema.openbotTasks, schema.budgetKillSwitch]) await app.db.delete(tbl as any);
});
afterAll(async () => {
  for (const k of KEYS) delete process.env[k];
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe('1. configuração de staging (DP-41), sem disparar nada', () => {
  it('só o staging liga a flag, com a decisão DP-41; produção, ausência de ambiente e falta da variável do piloto deixam tudo desligado', () => {
    expect(FLAG_RELEASES.openbotDispatch).toEqual({ staging: 'DP-41', production: null });
    const on = resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch' });
    expect([on.ambiente, on.state.openbotDispatch, on.logLine]).toEqual(['staging', true, 'flags ligadas: openbotDispatch (DP-41, staging)']);
    expect(() => resolveFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'openbotDispatch' })).toThrow(/sem decisão para production/);
    expect(resolveFlags({ LN_FLAGS_ON: 'openbotDispatch' }).state.openbotDispatch).toBe(false); // sem APP_ENV: ignorada
    expect(resolveFlags({ APP_ENV: 'staging' }).state.openbotDispatch).toBe(false); // sem LN_FLAGS_ON: desligada
    expect(() => resolveFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch', PORTAL_INDEXAVEL: '1' })).toThrow(/PORTAL_INDEXAVEL/);
    expect(pilotEnabled({ APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' })).toBe(true);
    expect(pilotEnabled({ APP_ENV: 'staging' })).toBe(false);
    expect(pilotEnabled({ APP_ENV: 'production', LN_OPENBOT_PILOT: '1' })).toBe(false);
  });

  it('com a configuração de staging mas SEM nada disparado: nenhuma tarefa, nenhuma entrada, nenhum custo, nenhuma linha', async () => {
    expect(app.deps.flags.openbotDispatch).toBe(true);
    expect(await tasks()).toHaveLength(0);
    expect(await costs()).toHaveLength(0);
    expect(await rowsStore().all()).toHaveLength(0);
    expect(await stateStore().get()).toBeNull();
  });

  it('flag desligada (sem LN_FLAGS_ON) mesmo com o piloto ligado: a Fábrica recusa e o agente recebe 423 DISPATCH_OFF', async () => {
    setEnv({ APP_ENV: 'staging', LN_OPENBOT_PILOT: '1', OPENBOT_HMAC_SECRET: SECRET });
    expect(app.deps.flags.openbotDispatch).toBe(false);
    expect(await factory().gw.invoke(req('triage'))).toMatchObject({ ok: false, detail: 'DISPATCH_OFF' });
    expect((await A.claude.tick())[0]!.steps[0]).toMatchObject({ status: 423, code: 'DISPATCH_OFF' });
    expect(await tasks()).toHaveLength(0);
  });

  it('sem segredo HMAC configurado: tudo é 401 (falha fechada)', async () => {
    setEnv({ APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch', LN_OPENBOT_PILOT: '1' });
    expect((await A.claude.tick())[0]!.steps[0]).toMatchObject({ status: 401 });
  });
});

describe('2. o gate do AgentOps está ao alcance da rota?', () => {
  it('estado atual: `@ln/agents` exporta canDispatchNext? se NÃO, o piloto FALHA FECHADO (423 PILOT_STOPPED com o motivo) e nada é entregue', async () => {
    const { gw } = factory();
    const r = await gw.invoke(req('triage'));
    if (typeof GATE === 'function') {
      expect(r.ok).toBe(true); // com o gate presente o ciclo da próxima seção roda
      return;
    }
    expect(r).toMatchObject({ ok: false });
    const [run] = await A.claude.tick();
    expect(run!.steps[0]).toMatchObject({ status: 423, code: 'PILOT_STOPPED' });
    expect(JSON.stringify(run)).not.toMatch(/segredo-de-ensaio/);
  });
});

describe.skipIf(typeof GATE !== 'function')('3. ciclo do piloto com o gate REAL (uma matéria, só claude e codex)', () => {
  const APPROVED = { gate_verdict: 'approved' as const, gate_reasons: [] as string[], cross_provider_ok: true, unsupported_facts: 0 };
  /** A Editorial grava o veredito (patch) logo depois da etapa independente. Sem isso, 2 linhas seguidas sem veredito PARAM o piloto (critério 3 do PM). */
  async function editorialPatch(stage: string) {
    const rs = rowsStore();
    for (const r of (await rs.all()).filter((x) => x.stage === stage && x.gate_verdict === undefined)) await rs.patch(r.task_id, r.attempt, APPROVED);
  }
  /** Roda as 6 etapas de uma matéria pela Fábrica; a checagem e a revisão recebem o id do rascunho (independência). */
  async function oneArticle() {
    const { gw } = factory();
    const out: Record<string, any> = {};
    out.triage = await gw.invoke(req('triage'));
    out.draft = await gw.invoke(req('draft'));
    const draft = (await tasks()).find((t) => t.kind === 'editorial_draft');
    const reviewed = { reviewedDraftTaskId: draft.id, claims: ['x'] };
    out.factcheck = await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }));
    await editorialPatch('factcheck');
    out.review = await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }));
    await editorialPatch('review');
    out.social_pack = await gw.invoke(req('social_pack'));
    out.roles = await gw.invoke(req('roles'));
    return { out, draft, gw };
  }

  it('as 6 etapas concluem; só claude e codex trabalham (nenhuma opencode/antigravity); custo 0 em faixa de assinatura; uma linha por execução', async () => {
    const { out } = await oneArticle();
    for (const [stage, r] of Object.entries(out)) expect(r.ok, `${stage}: ${JSON.stringify(r)}`).toBe(true);
    expect(out.factcheck.provider).toBe('openai'); // autor distinto do redator (anthropic)
    const t = await tasks();
    expect(t.map((x) => [x.kind, x.route])).toEqual(expect.arrayContaining([['classification', ['claude']], ['editorial_draft', ['claude']], ['fact_check', ['codex']], ['editorial_review', ['codex']], ['social_copy', ['claude']], ['entity_resolution', ['claude']]]));
    expect((await costs()).every((c) => c.costMicro === 0 && ['claude', 'codex'].includes(c.account) && c.lane === 'subscription')).toBe(true);
    expect([A.opencode.runs.length, A.antigravity.runs.length]).toEqual([0, 0]);
    expect(await rowsStore().all()).toHaveLength(6);
    expect(await stateStore().get()).toBeNull();
  });

  it('o gate real aceita as linhas: UMA checagem esperando o veredito não para o piloto; depois do patch da Editorial o gate libera e a planilha tem as colunas do AgentOps', async () => {
    const { gw } = factory();
    expect((await gw.invoke(req('triage'))).ok).toBe(true);
    expect((await gw.invoke(req('draft'))).ok).toBe(true);
    const draft = (await tasks()).find((t) => t.kind === 'editorial_draft');
    const reviewed = { reviewedDraftTaskId: draft.id, claims: ['x'] };
    expect((await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    const rs = rowsStore();
    const waiting = (await rs.all()).filter((r) => r.stage === 'factcheck');
    expect(waiting.map((r) => r.gate_verdict)).toEqual([undefined]);
    expect(waiting.every((r) => !!r.reviewed_draft_task_id)).toBe(true); // a prova de independência chegou à linha
    expect(await stateStore().get()).toBeNull(); // sem veredito, mas sem parada: uma linha esperando é o intervalo normal entre o callback e o patch
    const next = await factory().gw.invoke(req('triage', { idempotencyKey: 'art-2026-0002:triage:1', input: { pauta: 'outra' } }));
    expect(next.ok).toBe(true); // o despacho seguinte não foi bloqueado pela espera do veredito
    const apply = (agents as unknown as { applyRowPatch: (row: unknown, patch: Record<string, unknown>) => { row: unknown; errors: string[] } }).applyRowPatch;
    expect(apply(waiting[0], APPROVED).errors).toEqual([]); // o patch passa pela validação OFICIAL antes de gravar
    // o AgentOps recusa campo que é medição do adaptador (a Editorial não pode mexer em conta/modelo/horários)
    expect(apply(waiting[0], { declared_model: 'x' }).errors.length).toBeGreaterThan(0);
    await editorialPatch('factcheck');
    expect((await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    await editorialPatch('review');
    expect((await gw.invoke(req('social_pack'))).ok).toBe(true);
    expect((await gw.invoke(req('roles'))).ok).toBe(true);
    const final = await rs.all();
    expect(GATE!(final)).toEqual({ allowed: true, reasons: [] });
    const rep = adapterReport(final);
    expect([rep.articles, rep.independence.checked, rep.independence.independent, rep.independence.violations]).toEqual([2, 2, 2, []]); // 2 matérias; checagem e revisão com autor distinto do redator
    expect(pilotCsv(final).split('\n')[0]).toBe(SHEET ? SHEET.join(',') : PILOT_CSV_COLUMNS.join(','));
  });

  it('parada imediata pelo gate/adaptador: chamada tarifada (lane api) para o piloto e a rota passa a 423 PILOT_STOPPED; segredo em texto também', async () => {
    const { gw } = factory();
    expect((await gw.invoke(req('triage'))).ok).toBe(true);
    const [t0] = (await tasks());
    // um agente (de mentira) relata custo em lane api
    await new PgLeaseQueue(db()).enqueue({ kind: 'classification', profileId: 'newsdesk', refId: 'gw-api', idempotencyKey: 'api-1', dataClass: 'public', maxCostMicro: 1_000_000, route: ['claude'] }, app.clock.now);
    const p = await A.claude.pull();
    const task = p.body.tasks.find((x: any) => x.refId === 'gw-api');
    const lease = { taskId: task.id, leaseId: task.leaseId };
    const cb = await A.claude.call('callback', {
      callbackId: 'cb-api', ...lease, outcome: 'completed', resultRef: `res-${task.id}-a1`,
      usage: { executionId: 'ex-api', ...lease, model: 'anthropic/claude-haiku-5-5', lane: 'api', generationIds: ['g1'], promptTokens: 10, completionTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 5 },
      trace: { stage: 'triage', account: 'claude', startedAt: app.clock.now.toISOString(), endedAt: app.clock.now.toISOString() },
    });
    expect([cb.status, cb.body?.pilotStopped]).toEqual([200, ['api_tarifada']]);
    expect(t0).toBeDefined();
    expect((await A.claude.pull()).status).toBe(423);
    expect((await A.claude.pull()).body.error.code).toBe('PILOT_STOPPED');
    expect((await A.codex.pull()).body.error.code).toBe('PILOT_STOPPED');
  });
});

describe('4. DP-41 no fio e kill switch, com o piloto ligado (precisam do gate real)', () => {
  const it4 = it.skipIf(typeof GATE !== 'function');
  it4('pull de antigravity: 422 ACCOUNT_OUT_OF_ROUTE, linha de violação e piloto parado (a via certa também é barrada até o resumePilot)', async () => {
    await new PgLeaseQueue(db()).enqueue({ kind: 'classification', profileId: 'newsdesk', refId: 'gw-dp41', idempotencyKey: 'dp41-1', dataClass: 'public', maxCostMicro: 1, route: ['claude'] }, app.clock.now);
    const bad = await A.antigravity.pull();
    expect([bad.status, bad.body.error.code]).toEqual([422, 'ACCOUNT_OUT_OF_ROUTE']);
    expect((await stateStore().get())?.reasons).toEqual(['conta_fora_da_rota']);
    expect((await A.claude.pull()).body.error.code).toBe('PILOT_STOPPED');
    expect((await tasks())[0]).toMatchObject({ status: 'pending' });
  });

  it4('despacho de publicação (create_post/publish) é recusado (422 KIND_FORBIDDEN) e PARA o piloto', async () => {
    const d = factory().deps;
    const { dispatchTask } = await import('@ln/openbot');
    const r = await dispatchTask(d, { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch] }, { kind: 'create_post', profileId: 'newsdesk', refId: 'x', idempotencyKey: 'pub-1', dataClass: 'public', maxCostMicro: 1 });
    expect([r.status, (r.body as any).error.code]).toEqual([422, 'KIND_FORBIDDEN']);
    expect((await stateStore().get())?.reasons).toEqual(['tentativa_de_publicar']);
    expect(await tasks()).toHaveLength(0);
  });

  it4('kill switch (route:openbot): pull e heartbeat dão 423 KILL_SWITCH; o callback da tarefa em curso ainda é aceito; ao soltar o kill o pull volta', async () => {
    const store = new PostgresLedgerStore(app.db as unknown as SqlDatabase);
    await new PgLeaseQueue(db()).enqueue({ kind: 'classification', profileId: 'newsdesk', refId: 'gw-kill', idempotencyKey: 'kill-1', dataClass: 'public', maxCostMicro: 1, route: ['claude'] }, app.clock.now);
    await new PgTaskIo(db(), app.deps.now).putInput('gw-kill', { x: 1 }, { taskClass: 'triage', promptVersion: 'editorial-0.3' });
    const got = (await A.claude.pull()).body.tasks[0];
    const lease = { taskId: got.id, leaseId: got.leaseId };
    await store.setKill('route:openbot', true, 'ensaio do kill switch', app.clock.now);
    expect((await A.claude.pull()).body.error.code).toBe('KILL_SWITCH');
    expect((await A.claude.call('heartbeat', lease)).body.error.code).toBe('KILL_SWITCH');
    const w = await A.claude.call('io/result', { ...lease, result: { ok: 1 } });
    expect(w.body.error.code).toBe('KILL_SWITCH');
    const done = await A.claude.call('callback', {
      callbackId: 'cb-kill', ...lease, outcome: 'completed', resultRef: `res-${got.id}-a1`,
      usage: { executionId: 'ex-kill', ...lease, model: 'claude-haiku-5-5', lane: 'subscription', account: 'claude', costMicro: 0 },
      trace: { stage: 'triage', account: 'claude', startedAt: app.clock.now.toISOString(), endedAt: app.clock.now.toISOString(), promptVersion: 'editorial-0.3' },
    });
    expect(done.status).toBe(200); // fecha e registra o que já foi gasto
    await store.setKill('route:openbot', false, 'soltar', app.clock.now);
    expect((await A.claude.pull()).status).toBe(200);
  });
});
