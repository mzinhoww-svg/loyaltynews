/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@ln/db';
import { PgLeaseQueue, PgTaskIo } from '@ln/workers/openbot-pg';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../_lib/testkit';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';
import { CliError, run, sign } from '../../../../../packages/openbot/bin/ln-openbot-agent.mjs';

// O CLIENTE DO AGENTE (packages/openbot/bin/ln-openbot-agent.mjs) contra as ROTAS REAIS: é por ele que o modelo do OpenBot assina e conversa com a API,
// sem nunca ver o segredo. Prova a assinatura, o ciclo pull -> input -> result -> done, a idempotência, o limite e as recusas. Nenhuma rede, nenhum OpenBot.
const SECRET = 'segredo-de-teste-do-cliente-' + 'x'.repeat(8);
const BASE = 'https://staging.exemplo.example/api/openbot';
let app: Awaited<ReturnType<typeof makeApp>>;
const ROUTES: Record<string, { POST: (r: Request) => Promise<Response> }> = { pull, heartbeat, callback, 'io/input': ioInput, 'io/result': ioResult } as any;

const health = { status: 'ok', service: 'loyaltynews-web', version: 'teste', env: 'staging', flags: [] as string[] };
let signedCalls = 0;
let edge503 = false; // simula servidor anterior ao 423: a borda troca o corpo do pull por HTML
let override: ((path: string) => Response | null) | null = null; // respostas fixas por rota (testes de saída do smoke)
let pullCalls = 0;
const fetchImpl = (async (url: string, init: RequestInit) => {
  if (String(url) === 'https://staging.exemplo.example/api/health') return Response.json(health);
  const path = String(url).slice(BASE.length + 1);
  signedCalls += 1;
  if (path === 'pull') pullCalls += 1;
  const forced = override?.(path);
  if (forced) return forced;
  if (edge503 && path === 'pull') return new Response('<!doctype html><html data-kind="502"></html>', { status: 503, headers: { 'content-type': 'text/html', 'x-vertra-error': '1' } });
  return ROUTES[path]!.POST(new Request(`http://localhost:3000/api/openbot/${path}`, { method: 'POST', headers: init.headers as Record<string, string>, body: init.body as string }));
}) as unknown as typeof fetch;
const env = (account: string = 'codex', extra: Record<string, string> = {}) => ({ LN_API_BASE: BASE, LN_AGENT_ACCOUNT: account, LN_HMAC_SECRET_FILE: '/cofre/ln-hmac', ...extra });
const files: Record<string, string> = { '/cofre/ln-hmac': `${SECRET}\n`, '/tmp/result.json': JSON.stringify({ verdict: 'pass', claims: [] }) };
const io = () => ({ fetchImpl, now: () => app.clock.now.getTime(), readFile: ((p: string) => { if (!(p in files)) throw new Error('sem arquivo'); return files[p]!; }) as any });
const cli = (argv: string[], e: Record<string, string | undefined> = env()) => run(argv, e, io());
const refusal = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof CliError ? `${e.code}${e.status ? `:${e.status}` : ''}` : `outro:${String(e)}`));

async function seed(n: number, kind = 'fact_check', route: string[] = ['codex']) {
  await new PgTaskIo(app.db as any, app.deps.now).putInput(`gw-cli-${n}`, { claims: ['x'] }, { taskClass: 'factcheck', promptVersion: 'editorial-0.3', reviewedDraftTaskId: 'task-rascunho-1', articleId: 'art-2026-0001' });
  await new PgLeaseQueue(app.db as any).enqueue({ kind: kind as any, profileId: 'ln_pilot_checador', refId: `gw-cli-${n}`, idempotencyKey: `cli-${n}`, dataClass: 'public', maxCostMicro: 1, route: route as any }, app.clock.now);
}

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  health.env = 'staging';
  health.flags = [];
  signedCalls = 0;
  pullCalls = 0;
  override = null;
  edge503 = false;
  process.env.OPENBOT_HMAC_SECRET = SECRET;
  delete process.env.OPENBOT_HMAC_SECRET_PREVIOUS;
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
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

describe('cliente do agente contra as rotas reais', () => {
  it('ciclo completo: pull, input (com meta), result e done; resultRef derivado, custo 0 na faixa de assinatura, uma linha de custo', async () => {
    await seed(1);
    const pulled = await cli(['pull']);
    const t = pulled.tasks[0];
    expect([t.kind, t.account, t.refId]).toEqual(['fact_check', 'codex', 'gw-cli-1']);
    const inp = await cli(['input', '--task', t.id, '--lease', t.leaseId]);
    expect([inp.promptVersion, inp.meta]).toEqual(['editorial-0.3', { reviewedDraftTaskId: 'task-rascunho-1', articleId: 'art-2026-0001' }]);
    const res = await cli(['result', '--task', t.id, '--lease', t.leaseId, '--file', '/tmp/result.json']);
    expect(res.resultRef).toBe(`res-${t.id}-a1`);
    const done = await cli(['done', '--task', t.id, '--lease', t.leaseId, '--result-ref', res.resultRef, '--model', 'gpt-5.1-codex', '--stage', 'factcheck', '--article', inp.meta.articleId, '--reviewed-draft', inp.meta.reviewedDraftTaskId, '--prompt-version', inp.promptVersion, '--output-valid', 'true']);
    expect(done).toMatchObject({ duplicate: false, costRecorded: true, task: { status: 'completed' } });
    const [c] = (await app.db.select().from(schema.openbotCostEntries)) as any[];
    expect(c).toMatchObject({ lane: 'subscription', account: 'codex', costMicro: 0, model: 'gpt-5.1-codex' });
    // o mesmo `done` reenviado (mesmo resultRef = mesmo callbackId) é replay: sem novo custo
    const again = await cli(['done', '--task', t.id, '--lease', t.leaseId, '--result-ref', res.resultRef, '--model', 'gpt-5.1-codex', '--stage', 'factcheck']);
    expect(again).toMatchObject({ duplicate: true, costRecorded: false });
    expect(await app.db.select().from(schema.openbotCostEntries)).toHaveLength(1);
  });

  it('pull sem tarefa devolve lista vazia; heartbeat renova; o pull da via errada não recebe a tarefa do codex', async () => {
    expect((await cli(['pull'])).tasks).toEqual([]);
    await seed(2);
    expect((await cli(['pull'], env('claude'))).tasks).toEqual([]);
    const t = (await cli(['pull'])).tasks[0];
    expect((await cli(['heartbeat', '--task', t.id, '--lease', t.leaseId])).leaseExpiresAt).toBeTruthy();
  });

  it('pull --kinds: vários agentes dividem a mesma conta e cada um só recebe o seu tipo de tarefa; tipo desconhecido é recusado antes da rede', async () => {
    await seed(7, 'fact_check', ['codex']);
    await seed(8, 'editorial_review', ['codex']);
    expect((await cli(['pull', '--kinds', 'editorial_draft'])).tasks).toEqual([]);
    const rev = (await cli(['pull', '--kinds', 'editorial_review'])).tasks;
    expect(rev.map((t: any) => t.kind)).toEqual(['editorial_review']);
    const chk = (await cli(['pull', '--kinds', 'fact_check,classification', '--limit', '5'])).tasks;
    expect(chk.map((t: any) => t.kind)).toEqual(['fact_check']);
    expect(await refusal(cli(['pull', '--kinds', 'create_post']))).toBe('uso');
    expect(await refusal(cli(['pull', '--kinds', '']))).toBe('uso');
  });

  it('limite da conta: o callback de limite deixa a tarefa pendente (sem consumir tentativa) e não grava custo', async () => {
    await seed(3);
    const t = (await cli(['pull'])).tasks[0];
    const r = await cli(['limit', '--task', t.id, '--lease', t.leaseId, '--stage', 'factcheck', '--message', 'limite da assinatura', '--resume-at', new Date(app.clock.now.getTime() + 3_600_000).toISOString()]);
    expect(r.task.status).toBe('pending');
    expect(await app.db.select().from(schema.openbotCostEntries)).toHaveLength(0);
  });

  it('falha declarada (fail) volta a tarefa como retentável; lease alheio é recusado com o código da API', async () => {
    await seed(4);
    const t = (await cli(['pull'])).tasks[0];
    expect(await refusal(cli(['done', '--task', t.id, '--lease', 'lease-alheio', '--result-ref', `res-${t.id}-a1`, '--model', 'm', '--stage', 'factcheck']))).toBe('LEASE_ERROR:409');
    const f = await cli(['fail', '--task', t.id, '--lease', t.leaseId, '--stage', 'factcheck', '--error', 'saída fora do esquema']);
    expect(f.task.status).toBe('pending');
  });
});

describe('sonda de assinatura (sem tocar dado)', () => {
  it('heartbeat de uma tarefa que não existe: com o segredo certo a API assina como válido (404 LEASE_ERROR); com o errado, 401; nada é criado', async () => {
    app.deps.flags.openbotDispatch = false; // a sonda vale com o despacho DESLIGADO (como no passo 6.1 do roteiro): o pull nunca é sonda: é operacional (grava atividade e, ligado, reserva tarefa)
    expect((await cli(['pull']).catch((e: CliError) => e)).code).toBe('DISPATCH_OFF');
    expect(await refusal(cli(['heartbeat', '--task', 'sonda-inexistente', '--lease', 'sonda']))).toBe('LEASE_ERROR:404');
    files['/cofre/errado2'] = 'segredo-errado';
    expect(await refusal(cli(['heartbeat', '--task', 'sonda-inexistente', '--lease', 'sonda'], env('codex', { LN_HMAC_SECRET_FILE: '/cofre/errado2' })))).toBe('UNAUTHORIZED:401');
    expect(await app.db.select().from(schema.openbotTasks)).toHaveLength(0);
  });
});

describe('borda da Vertra: 5xx sem corpo da API', () => {
  it('503 em HTML (a borda troca o corpo) vira UPSTREAM_503 com orientação de parar; 401 com JSON da API continua com o código da API', async () => {
    const edge = (async () => new Response('<!doctype html><html data-kind="502"></html>', { status: 503, headers: { 'content-type': 'text/html', 'x-vertra-error': '1' } })) as unknown as typeof fetch;
    const e: any = await run(['pull'], env(), { ...io(), fetchImpl: edge }).catch((x) => x);
    expect([e.code, e.status]).toEqual(['UPSTREAM_503', 503]);
    expect(e.message).toMatch(/pare o ciclo/);
    expect(e.stop).toBe(true);
    expect(e.message).not.toMatch(/segredo-de-teste/);
    files['/cofre/errado3'] = 'segredo-errado-3';
    const e401: any = await run(['pull'], env('codex', { LN_HMAC_SECRET_FILE: '/cofre/errado3' }), io()).catch((x) => x);
    expect(e401.code).toBe('UNAUTHORIZED');
    // 503 COM corpo JSON da API (fora da borda, ex. testes locais) mantém o código da API
    const api = (async () => new Response(JSON.stringify({ error: { code: 'DISPATCH_OFF', message: 'desligado' } }), { status: 503, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    expect(((await run(['pull'], env(), { ...io(), fetchImpl: api }).catch((x) => x)) as any).code).toBe('DISPATCH_OFF');
  });
});

describe('423 Locked (PM-2026-11-23-I): o LN travado de propósito', () => {
  it('done sem --started-at usa a hora do pull: duração maior que 1 s com LN_AGENT_STATE_DIR', async () => {
    await seed(25);
    const dir = mkdtempSync(join(tmpdir(), 'ln-cli-'));
    try {
      const e = env('codex', { LN_AGENT_STATE_DIR: dir });
      let nowMs = app.clock.now.getTime();
      const io2 = { ...io(), now: () => nowMs };
      const pulled = await run(['pull'], e, io2 as never);
      const t = pulled.tasks[0];
      const res = await run(['result', '--task', t.id, '--lease', t.leaseId, '--file', '/tmp/result.json'], e, io2 as never);
      let sent: any = null;
      const capture = (async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/callback')) sent = JSON.parse(String(init.body));
        return fetchImpl(url as never, init);
      }) as unknown as typeof fetch;
      nowMs += 5_000;
      await run(['done', '--task', t.id, '--lease', t.leaseId, '--result-ref', res.resultRef, '--model', 'gpt-5.1-codex', '--stage', 'factcheck'], e, { ...io2, fetchImpl: capture } as never);
      expect(sent.trace.startedAt).toBe(new Date(app.clock.now.getTime()).toISOString());
      expect(Date.parse(sent.trace.endedAt) - Date.parse(sent.trace.startedAt)).toBeGreaterThan(1_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DISPATCH_OFF, KILL_SWITCH e PILOT_STOPPED em 423 com corpo JSON mantêm o código da API e mandam PARAR o ciclo (stop), sem repetir em laço', async () => {
    for (const code of ['DISPATCH_OFF', 'KILL_SWITCH', 'PILOT_STOPPED']) {
      let calls = 0;
      const locked = (async () => {
        calls++;
        return new Response(JSON.stringify({ error: { code, message: 'travado de propósito' } }), { status: 423, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      const e: any = await run(['pull'], env(), { ...io(), fetchImpl: locked }).catch((x) => x);
      expect([e.code, e.status, e.stop], code).toEqual([code, 423, true]);
      expect(e.message).toMatch(/423 Locked: pare o ciclo e não repita em laço/);
      expect(calls, 'uma só chamada: o cliente nunca repete sozinho').toBe(1);
    }
    // 423 sem corpo da API (não deveria acontecer): ainda para o ciclo
    const bare = (async () => new Response('', { status: 423 })) as unknown as typeof fetch;
    const e2: any = await run(['pull'], env(), { ...io(), fetchImpl: bare }).catch((x) => x);
    expect([e2.code, e2.stop]).toEqual(['LOCKED', true]);
  });

  it('erros que NÃO são travamento (401, 409) não mandam parar: o agente decide pelo código', async () => {
    files['/cofre/errado4'] = 'segredo-errado-4';
    const e: any = await run(['pull'], env('codex', { LN_HMAC_SECRET_FILE: '/cofre/errado4' }), io()).catch((x) => x);
    expect([e.code, e.stop]).toEqual(['UNAUTHORIZED', false]);
  });
});

describe('423 Locked pelas rotas REAIS (ft/backend 0a2e2c8): o código chega ao agente, que para o ciclo', () => {
  it('despacho desligado: pull = 423 DISPATCH_OFF com stop; a sonda de assinatura (heartbeat) continua passando', async () => {
    app.deps.flags.openbotDispatch = false;
    const e: any = await cli(['pull']).catch((x) => x);
    expect([e.code, e.status, e.stop]).toEqual(['DISPATCH_OFF', 423, true]);
    expect(await refusal(cli(['heartbeat', '--task', 'sonda-inexistente', '--lease', 'sonda']))).toBe('LEASE_ERROR:404');
  });

  it('kill switch (route:openbot): pull, heartbeat, input e result = 423 KILL_SWITCH com stop; soltando o kill o pull volta', async () => {
    await seed(9);
    const t = (await cli(['pull'])).tasks[0];
    const store = new PostgresLedgerStore(app.db as unknown as SqlDatabase);
    await store.setKill('route:openbot', true, 'ensaio do 423', app.clock.now);
    const lease = ['--task', t.id, '--lease', t.leaseId];
    for (const argv of [['pull'], ['heartbeat', ...lease], ['input', ...lease], ['result', ...lease, '--file', '/tmp/result.json']]) {
      const e: any = await cli(argv).catch((x) => x);
      expect([e.code, e.status, e.stop], argv[0]).toEqual(['KILL_SWITCH', 423, true]);
    }
    await store.setKill('route:openbot', false, 'soltar', app.clock.now);
    expect((await cli(['heartbeat', ...lease])).leaseExpiresAt).toBeTruthy();
  });
});

describe('smoke: a verificação do roteiro em um comando, sem efeito e SEM pull', () => {
  const step = (r: any, name: string) => r.checks.find((c: any) => c.step === name);
  const clean = (r: unknown) => expect(JSON.stringify(r)).not.toMatch(/segredo-de-teste|v1=|x-ln-signature/);

  it('despacho desligado e segredo certo: tudo PASS (health, flag, assinatura por heartbeat e io/input); nada criado, nenhum pull, nenhuma atividade gravada', async () => {
    app.deps.flags.openbotDispatch = false;
    const r = await cli(['smoke']);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c: any) => [c.step, c.verdict])).toEqual([['health', 'PASS'], ['flag openbotDispatch', 'PASS'], ['assinatura (heartbeat)', 'PASS'], ['assinatura (io/input)', 'PASS']]);
    expect(step(r, 'health').observed).toEqual({ env: 'staging', version: 'teste', flags: [] });
    expect(pullCalls).toBe(0);
    expect(await app.db.select().from(schema.openbotTasks)).toHaveLength(0);
    expect(await app.db.select().from(schema.openbotHealth)).toHaveLength(0);
    clean(r);
  });

  it('NUNCA reserva tarefa nem grava atividade, mesmo se o despacho LIGAR depois da leitura do health (health diz desligado, o servidor está ligado): fila e atividade intactas', async () => {
    app.deps.flags.openbotDispatch = true; // o servidor JÁ está ligado...
    health.flags = []; // ...mas o /api/health lido pelo smoke ainda diz desligado
    await seed(30);
    const r = await cli(['smoke']);
    expect(r.ok).toBe(true);
    expect(pullCalls).toBe(0);
    const [t] = (await app.db.select().from(schema.openbotTasks)) as any[];
    expect([t.status, t.leaseId ?? null]).toEqual(['pending', null]);
    expect(await app.db.select().from(schema.openbotHealth)).toHaveLength(0); // markPull nunca rodou
    expect(await app.db.select().from(schema.openbotCostEntries)).toHaveLength(0);
  });

  it('despacho ligado (health e servidor): também sem pull; a tarefa pendente segue pendente sem lease', async () => {
    app.deps.flags.openbotDispatch = true;
    health.flags = ['openbotDispatch'];
    await seed(31);
    const r = await cli(['smoke', '--expect-dispatch', 'on']);
    expect(r.ok).toBe(true);
    expect(pullCalls).toBe(0);
    const [t] = (await app.db.select().from(schema.openbotTasks)) as any[];
    expect([t.status, t.leaseId ?? null]).toEqual(['pending', null]);
  });

  it('segredo errado: FAIL nas duas sondas, com a dica local, sem vazar; servidor sem segredo: FAIL sem_segredo', async () => {
    app.deps.flags.openbotDispatch = false;
    files['/cofre/errado5'] = 'segredo-errado-5';
    const r = await cli(['smoke'], env('codex', { LN_HMAC_SECRET_FILE: '/cofre/errado5' }));
    expect(r.ok).toBe(false);
    expect([step(r, 'assinatura (heartbeat)').verdict, step(r, 'assinatura (io/input)').verdict]).toEqual(['FAIL', 'FAIL']);
    expect(step(r, 'assinatura (heartbeat)')).toMatchObject({ observed: '401 assinatura recusada', note: expect.stringMatching(/segredo diferente/) });
    expect(JSON.stringify(r)).not.toContain('segredo-errado-5');
    clean(r);
    delete process.env.OPENBOT_HMAC_SECRET;
    const s = await cli(['smoke']);
    expect(step(s, 'assinatura (heartbeat)')).toMatchObject({ verdict: 'FAIL', observed: '401 sem_segredo', note: 'o servidor não tem o segredo HMAC configurado' });
  });

  it('a saída NUNCA repete texto do servidor: mensagem, código estranho e versão/flags inválidas são trocados por texto local', async () => {
    const hostile = 'TEXTO-DO-SERVIDOR-xyz <script>';
    override = (path) => (path === 'heartbeat' ? Response.json({ error: { code: 'UNAUTHORIZED', message: hostile } }, { status: 401, headers: { 'x-ln-signature': 'v1=abc' } }) : path === 'io/input' ? Response.json({ error: { code: 'codigo estranho ' + hostile, message: hostile } }, { status: 418 }) : null);
    (health as any).version = hostile;
    (health as any).flags = ['openbotDispatch', hostile];
    const r = await cli(['smoke']);
    const out = JSON.stringify(r);
    expect(out).not.toContain('TEXTO-DO-SERVIDOR');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('v1=abc');
    expect(step(r, 'health').observed).toEqual({ env: 'staging', version: 'desconhecida', flags: null });
    expect(step(r, 'assinatura (heartbeat)')).toMatchObject({ verdict: 'FAIL', observed: '401 assinatura recusada' });
    expect(step(r, 'assinatura (io/input)')).toMatchObject({ verdict: 'FAIL', observed: '418 CODIGO_DESCONHECIDO' });
  });

  it('flags ausente ou inválida = estado DESCONHECIDO (WARN com --expect-dispatch any; FAIL se o operador esperava off/on)', async () => {
    (health as any).flags = undefined;
    const any = await cli(['smoke']);
    expect(step(any, 'flag openbotDispatch')).toMatchObject({ verdict: 'WARN', observed: 'desconhecida' });
    const off = await cli(['smoke', '--expect-dispatch', 'off']);
    expect(step(off, 'flag openbotDispatch')).toMatchObject({ verdict: 'FAIL', observed: 'desconhecida' });
    expect(off.ok).toBe(false);
  });

  it('PASS da assinatura só para 404 LEASE_ERROR ou 423 de parada PREVISTA; 423 desconhecido, LOCKED sem JSON ou 404 de outro tipo = FAIL', async () => {
    override = (path) => (path === 'heartbeat' ? new Response('', { status: 423 }) : path === 'io/input' ? Response.json({ error: { code: 'OUTRA_COISA', message: 'x' } }, { status: 423 }) : null);
    const r = await cli(['smoke']);
    expect([step(r, 'assinatura (heartbeat)').verdict, step(r, 'assinatura (io/input)').verdict]).toEqual(['FAIL', 'FAIL']);
    expect(step(r, 'assinatura (heartbeat)').observed).toBe('423 LOCKED');
    expect(step(r, 'assinatura (io/input)').observed).toBe('423 OUTRA_COISA');
    override = (path) => (path === 'heartbeat' ? Response.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }) : null);
    expect(step(await cli(['smoke']), 'assinatura (heartbeat)').verdict).toBe('FAIL');
  });

  it('kill switch e piloto parado (423 previstos): a assinatura PASSA e o smoke segue ok', async () => {
    app.deps.flags.openbotDispatch = false;
    const store = new PostgresLedgerStore(app.db as unknown as SqlDatabase);
    await store.setKill('route:openbot', true, 'smoke', app.clock.now);
    const k = await cli(['smoke']);
    expect(step(k, 'assinatura (heartbeat)')).toMatchObject({ verdict: 'PASS', observed: '423 KILL_SWITCH' });
    expect(k.ok).toBe(true);
    await store.setKill('route:openbot', false, 'soltar', app.clock.now);
    override = (path) => (path === 'heartbeat' || path === 'io/input' ? Response.json({ error: { code: 'PILOT_STOPPED', message: 'x' } }, { status: 423 }) : null);
    const p = await cli(['smoke']);
    expect(step(p, 'assinatura (io/input)')).toMatchObject({ verdict: 'PASS', observed: '423 PILOT_STOPPED' });
  });

  it('--expect-dispatch confere a flag (FAIL se diferente) e recusa valor inválido antes da rede', async () => {
    app.deps.flags.openbotDispatch = false;
    const r = await cli(['smoke', '--expect-dispatch', 'on']);
    expect([r.ok, step(r, 'flag openbotDispatch').verdict]).toEqual([false, 'FAIL']);
    expect(await refusal(cli(['smoke', '--expect-dispatch', 'talvez']))).toBe('uso');
  });

  it('PRODUÇÃO (health env diferente de staging): recusa e NÃO envia nenhuma chamada assinada; app fora do ar também', async () => {
    health.env = 'production';
    const r = await cli(['smoke']);
    expect([r.ok, r.refused, signedCalls]).toEqual([false, 'ambiente_nao_staging', 0]);
    expect(r.checks).toHaveLength(1);
    const down = (async () => new Response('x', { status: 502 })) as unknown as typeof fetch;
    const d = await run(['smoke'], env(), { ...io(), fetchImpl: down });
    expect([d.ok, d.refused]).toEqual([false, 'sem_health']);
  });
});

describe('segurança do cliente', () => {
  it('segredo errado: 401 com o código da API; o segredo e a assinatura nunca aparecem na mensagem', async () => {
    files['/cofre/errado'] = 'outro-segredo-qualquer';
    const e: any = await cli(['pull'], env('codex', { LN_HMAC_SECRET_FILE: '/cofre/errado' })).catch((x) => x);
    expect([e.code, e.status]).toEqual(['UNAUTHORIZED', 401]);
    expect(`${e.message} ${JSON.stringify(e)}`).not.toMatch(/outro-segredo|v1=|segredo-de-teste/);
  });

  it('configuração recusada antes de qualquer rede: sem segredo, URL http, conta fora da DP-41, flag desconhecida (nunca --secret)', async () => {
    expect(await refusal(cli(['pull'], { LN_API_BASE: BASE, LN_AGENT_ACCOUNT: 'codex' }))).toBe('config');
    expect(await refusal(cli(['pull'], env('codex', { LN_API_BASE: 'http://staging.exemplo.example/api/openbot' })))).toBe('config');
    for (const account of ['antigravity', '', 'deterministic']) expect(await refusal(cli(['pull'], env(account))), account).toBe('config');
    expect(await refusal(cli(['pull', '--secret', 'abc']))).toBe('uso');
    expect(await refusal(cli(['pull', '--limit', '99']))).toBe('uso');
    expect(await refusal(cli(['done', '--task', 'a b', '--lease', 'l', '--result-ref', 'r', '--model', 'm', '--stage', 'factcheck']))).toBe('uso');
    expect(await refusal(cli(['done', '--task', 't', '--lease', 'l', '--result-ref', 'r', '--model', 'm', '--stage', 'check_edit']))).toBe('uso');
    expect(await refusal(cli(['publicar']))).toBe('uso');
    expect(await app.db.select().from(schema.openbotHealth)).toHaveLength(0); // nada chegou às rotas
  });

  it('a assinatura do cliente é a mesma de signBody de @ln/openbot (HMAC-SHA256 de "<ts>.<corpo>")', async () => {
    const { signBody } = await import('@ln/openbot');
    expect(sign('s', 1700000000000, '{"a":1}')).toBe(signBody('s', 1700000000000, '{"a":1}'));
  });
});
