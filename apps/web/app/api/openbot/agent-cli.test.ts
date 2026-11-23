/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { PgLeaseQueue, PgTaskIo } from '@ln/workers/openbot-pg';
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

const fetchImpl = (async (url: string, init: RequestInit) => {
  const path = String(url).slice(BASE.length + 1);
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
    app.deps.flags.openbotDispatch = false; // a sonda vale com o despacho DESLIGADO (como no passo 6.1 do roteiro): o pull daria 503 antes de conferir a assinatura
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
    for (const account of ['opencode', 'antigravity', '', 'deterministic']) expect(await refusal(cli(['pull'], env(account))), account).toBe('config');
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
