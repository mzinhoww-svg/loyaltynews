/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import * as agents from '@ln/agents';
import { resolveFlags } from '@ln/contracts';
import { openbotFlagsFrom, OPENBOT_PERMISSIONS, OpenBotModelGateway, PILOT_PERMISSIONS, resumePilot, STOP, type GatewayRequestLike, type OpenBotDeps, type PilotGate, type PilotVerdictStreak } from '@ln/openbot';
import { FakeOpenBot, type AgentPath, type AgentTransport } from '@ln/openbot/testing';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from '@ln/workers/openbot-pg';
import { makeApp } from '../_lib/testkit';
import { pilotEnabled } from '../_lib/openbot';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';

// CRITÉRIO 3 DE PARADA DO PM (24/11): o patch do veredito falha 2 vezes SEGUIDAS (checagem/revisão concluídas sem `gate_verdict`, `pilot_row_patch_failed`) e o piloto PARA.
// As ROTAS reais /api/openbot sobre PGlite (elas montam o piloto com o kit REAL do AgentOps: `canDispatchNext` + `verdictStreakReasons`), a Fábrica (OpenBotModelGateway)
// e agentes FALSOS em processo. O bug que isto cobre: `pilotBlock` filtrava as linhas que ESPERAM o veredito antes do gate, e é só nelas que a sequência aparece.
// Roda só quando `@ln/agents` exporta o critério (ft/agents ab7bba3 ou posterior); senão fica PULADO (nunca aprovado) e o piloto falha fechado (teste da seção 3).
const SECRET = 'segredo-de-ensaio-do-criterio-3';
const kit = agents as unknown as { canDispatchNext?: PilotGate; verdictStreakReasons?: PilotVerdictStreak };
const HAS_KIT = typeof kit.canDispatchNext === 'function' && typeof kit.verdictStreakReasons === 'function';
let app: Awaited<ReturnType<typeof makeApp>>;

const ENV = { APP_ENV: 'staging', LN_FLAGS_ON: 'openbotDispatch', LN_OPENBOT_PILOT: '1', OPENBOT_HMAC_SECRET: SECRET } as const;
const KEYS = ['APP_ENV', 'LN_FLAGS_ON', 'LN_OPENBOT_PILOT', 'OPENBOT_HMAC_SECRET', 'OPENBOT_HMAC_SECRET_PREVIOUS', 'PORTAL_INDEXAVEL', 'NEXT_PUBLIC_SITE_URL'] as const;
const setEnv = (e: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, e);
  app.deps.flags.openbotDispatch = resolveFlags(process.env).state.openbotDispatch;
};
const ROUTES: Record<AgentPath, { POST: (r: Request) => Promise<Response> }> = { pull, heartbeat, callback, 'io/input': ioInput, 'io/result': ioResult } as any;
const transport: AgentTransport = async (path, raw, headers) => {
  const res = await ROUTES[path].POST(new Request(`http://localhost:3000/api/openbot/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const mkAgent = (account: 'claude' | 'codex') =>
  new FakeOpenBot({
    account, workerId: `fake-${account}`, secret: SECRET, transport, now: () => app.clock.now.getTime(),
    decide: (t) => ({ type: 'result', result: { de: account, kind: t.kind }, model: account === 'claude' ? (t.kind === 'classification' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5') : 'gpt-5.1-codex' }),
  });
let A: { claude: FakeOpenBot; codex: FakeOpenBot };

const db = () => app.db as any;
const rowsStore = () => new PgPilotRowStore(db(), app.deps.now);
const stateStore = () => new PgPilotStateStore(db());
const tasks = () => app.db.select().from(schema.openbotTasks) as unknown as Promise<any[]>;
const APPROVED = { gate_verdict: 'approved' as const, gate_reasons: [] as string[], cross_provider_ok: true, unsupported_facts: 0 };
/** A Editorial grava o veredito (patch) das linhas de uma etapa que ainda esperam. Sem isso, cada linha fica "concluída sem veredito". */
async function editorialPatch(stage: string) {
  const rs = rowsStore();
  for (const r of (await rs.all()).filter((x) => x.stage === stage && x.gate_verdict === undefined)) await rs.patch(r.task_id, r.attempt, APPROVED);
}
const waiting = async () => (await rowsStore().all()).filter((r) => ['factcheck', 'review'].includes(r.stage) && r.outcome === 'completed' && r.gate_verdict === undefined);

/** Fábrica do staging: as MESMAS tabelas e o MESMO kit das rotas; o `sleep` do gateway é quem deixa os agentes trabalharem. */
function factory() {
  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db()), ledger: new PgCostLedger(db(), app.deps.now), health: new PgHealthStore(db()), callbacks: new PgCallbackStore(db()),
    secrets: () => [SECRET], flags: () => openbotFlagsFrom({ overrides: { openbotDispatch: app.deps.flags.openbotDispatch === true }, kill: false }), now: app.deps.now, requireDerivedResultRef: true, routes: { classification: ['claude'], editorial_draft: ['claude'], fact_check: ['codex'], editorial_review: ['codex'], social_copy: ['claude'], entity_resolution: ['claude'] },
    ...(pilotEnabled(process.env) ? { pilot: { enabled: true, rows: rowsStore(), state: stateStore(), gate: kit.canDispatchNext!, verdictStreak: kit.verdictStreakReasons!, allowedAccounts: ['claude', 'codex'] } } : {}),
  };
  let t = 0;
  const gw = new OpenBotModelGateway({
    deps, io: new PgTaskIo(db(), app.deps.now), caller: { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch, PILOT_PERMISSIONS.admin] }, timeoutMs: 20_000, pollMs: 1,
    profiles: { triage: 'newsdesk', context: 'newsdesk', draft: 'writer_pontos', factcheck: 'newsdesk', review: 'newsdesk', social_pack: 'newsdesk', roles: 'newsdesk' },
    clock: () => t, sleep: async () => { t += 1000; for (const a of [A.claude, A.codex]) await a.tick(); },
  });
  return { gw, deps };
}
const req = (taskClass: GatewayRequestLike['taskClass'], over: Partial<GatewayRequestLike> = {}): GatewayRequestLike => ({
  taskClass, route: taskClass, workflow: 'WF02', idempotencyKey: `art-2026-0001:${taskClass}:1`, promptVersion: 'editorial-0.3', dataClass: 'public', excludeProviders: [], input: { pauta: 'texto público do ensaio' }, ...over,
});
/** triagem + rascunho, e devolve a entrada de checagem/revisão (com o id do rascunho: independência). */
async function untilDraft(gw: OpenBotModelGateway) {
  expect((await gw.invoke(req('triage'))).ok).toBe(true);
  expect((await gw.invoke(req('draft'))).ok).toBe(true);
  const draft = (await tasks()).find((t) => t.kind === 'editorial_draft');
  return { reviewedDraftTaskId: draft.id, claims: ['x'] };
}

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  setEnv({ ...ENV });
  A = { claude: mkAgent('claude'), codex: mkAgent('codex') };
});
afterEach(async () => {
  for (const tbl of [schema.openbotCostEntries, schema.openbotCallbacks, schema.openbotHealth, schema.openbotPilotRows, schema.openbotPilotState, schema.openbotIo, schema.openbotTasks, schema.budgetKillSwitch]) await app.db.delete(tbl as any);
});
afterAll(async () => {
  for (const k of KEYS) delete process.env[k];
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe.skipIf(!HAS_KIT)('critério 3 do PM com o kit REAL do AgentOps e as rotas reais', () => {
  it('UMA checagem sem veredito não para o piloto: a Fábrica segue e a rota de pull entrega (200)', async () => {
    const { gw } = factory();
    const reviewed = await untilDraft(gw);
    expect((await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    expect(await waiting()).toHaveLength(1);
    expect(await stateStore().get()).toBeNull();
    expect((await gw.invoke(req('triage', { idempotencyKey: 'art-2026-0002:triage:1', input: { pauta: 'outra' } }))).ok).toBe(true);
    expect((await A.claude.pull()).status).toBe(200);
  });

  it('DUAS seguidas (checagem e revisão concluídas sem veredito): o despacho é recusado e as rotas de pull de claude E codex respondem 423 PILOT_STOPPED; o motivo fica gravado', async () => {
    const { gw } = factory();
    const reviewed = await untilDraft(gw);
    expect((await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    expect((await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true); // 1 esperando: a revisão ainda é despachada
    expect(await waiting()).toHaveLength(2);
    // a própria linha pela API do kit: é a sequência que o AgentOps manda parar
    expect(kit.verdictStreakReasons!(await rowsStore().all()).length).toBe(1);
    const next = await gw.invoke(req('social_pack'));
    expect(next.ok).toBe(false);
    const stop = await stateStore().get();
    expect(stop?.reasons.join(' ')).toContain(STOP.verdictStreak);
    for (const a of [A.claude, A.codex]) {
      const r = await a.pull();
      expect([r.status, r.body.error.code]).toEqual([423, 'PILOT_STOPPED']);
    }
    // parada de verdade: o Pg guarda o motivo e nada foi entregue ao agente
    expect((await tasks()).filter((t) => t.kind === 'social_copy')).toEqual([]);
  });

  it('o veredito entre duas falhas zera a sequência (falha, patch, falha): o piloto segue', async () => {
    const { gw } = factory();
    const reviewed = await untilDraft(gw);
    expect((await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    await editorialPatch('factcheck');
    expect((await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }))).ok).toBe(true);
    expect(await waiting()).toHaveLength(1);
    expect((await gw.invoke(req('social_pack'))).ok).toBe(true);
    expect(await stateStore().get()).toBeNull();
  });

  it('retomada: só depois do patch dos vereditos (409 PILOT_STILL_INVALID antes), e então as rotas voltam a entregar', async () => {
    const { gw, deps } = factory();
    const reviewed = await untilDraft(gw);
    await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }));
    await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }));
    expect((await gw.invoke(req('social_pack'))).ok).toBe(false);
    const admin = { id: 'admin', permissions: [PILOT_PERMISSIONS.admin] };
    expect(await resumePilot(deps, admin)).toMatchObject({ status: 409, body: { error: { code: 'PILOT_STILL_INVALID' } } });
    await editorialPatch('factcheck');
    await editorialPatch('review');
    expect(await resumePilot(deps, admin)).toMatchObject({ status: 200, body: { resumed: true } });
    expect((await A.claude.pull()).status).toBe(200);
    expect((await gw.invoke(req('social_pack'))).ok).toBe(true);
  });
});

describe('ligação das rotas: sem o critério no kit o piloto não despacha', () => {
  it('a rota monta o piloto com `verdictStreak` do kit real (a parada acontece pela ROTA, não só pela Fábrica)', async () => {
    if (!HAS_KIT) return; // sem o critério no kit, o teste acima fica pulado e a ligação falha fechada (closedStreak)
    const { gw } = factory();
    const reviewed = await untilDraft(gw);
    await gw.invoke(req('factcheck', { excludeProviders: ['anthropic'], input: reviewed }));
    await gw.invoke(req('review', { excludeProviders: ['anthropic'], input: reviewed }));
    // nenhum despacho da Fábrica depois: quem para é o `pull` da rota real
    expect((await A.codex.pull()).body.error.code).toBe('PILOT_STOPPED');
  });
});
