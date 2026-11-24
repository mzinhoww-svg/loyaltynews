/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../_lib/testkit';
import * as pull from './pull/route';
import * as heartbeat from './heartbeat/route';
import * as callback from './callback/route';
import * as ioInput from './io/input/route';
import * as ioResult from './io/result/route';
import { runItem11, toText, FALSE_SECRET } from '../../../../../packages/openbot/bin/ln-item11.mjs';

// ITEM 11 (sonda de assinatura, kill switch e ensaio sem modelo): o script contra as ROTAS REAIS em processo, sem rede e sem OpenBot.
// Prova que a fase `sem-segredo` só faz chamadas sem efeito e distingue servidor com e sem segredo; que a fase `com-segredo` confere os resultados
// esperados do roteiro (404 LEASE_ERROR, 423 DISPATCH_OFF / KILL_SWITCH / PILOT_STOPPED, lista vazia) e RECUSA o que não for seguro (produção, pull sem
// confirmação); e que a saída nunca contém o segredo.
const SECRET = 'segredo-de-teste-do-item11-' + 'y'.repeat(8);
const ORIGIN = 'https://staging.exemplo.example';
let app: Awaited<ReturnType<typeof makeApp>>;
const ROUTES: Record<string, { POST: (r: Request) => Promise<Response> }> = { pull, heartbeat, callback, 'io/input': ioInput, 'io/result': ioResult } as any;
const health = { status: 'ok', service: 'loyaltynews-web', version: 'teste', env: 'staging', flags: [] as string[] };
let calls: string[] = [];
let override: ((method: string, path: string) => Response | null) | null = null;

const fetchImpl = (async (url: string, init: RequestInit = {}) => {
  const u = String(url);
  const method = init.method ?? 'GET';
  calls.push(`${method} ${u.slice(ORIGIN.length)}`);
  const forced = override?.(method, u.slice(ORIGIN.length));
  if (forced) return forced;
  if (u === `${ORIGIN}/api/health`) return Response.json(health);
  if (u === `${ORIGIN}/api/ready`) return Response.json({ status: 'ok', db: 'ok', redis: 'ok' });
  if (u === `${ORIGIN}/studio/piloto`) return new Response(null, { status: 307, headers: { location: '/login' } });
  const path = u.slice(`${ORIGIN}/api/openbot/`.length);
  if (u.startsWith(`${ORIGIN}/api/openbot/`) && ROUTES[path]) {
    if (method !== 'POST') return new Response(null, { status: 405 });
    return ROUTES[path]!.POST(new Request(`http://localhost:3000/api/openbot/${path}`, { method: 'POST', headers: init.headers as Record<string, string>, body: init.body as string }));
  }
  return new Response('nao encontrado', { status: 404 });
}) as unknown as typeof fetch;

const files: Record<string, string> = { '/cofre/ln-hmac': `${SECRET}\n` };
const io = () => ({ fetchImpl, now: () => app.clock.now.getTime(), readFile: ((p: string) => { if (!(p in files)) throw new Error('sem arquivo'); return files[p]!; }) as any });
const opts = (extra: Record<string, unknown> = {}): any => ({ base: ORIGIN, account: 'codex' as const, ...extra });
const step = (r: any, start: string) => r.passos.find((s: any) => String(s.passo).startsWith(start));

beforeAll(async () => {
  app = await makeApp();
}, 120_000);
beforeEach(() => {
  health.env = 'staging';
  health.flags = [];
  calls = [];
  override = null;
  process.env.OPENBOT_HMAC_SECRET = SECRET;
  delete process.env.OPENBOT_HMAC_SECRET_PREVIOUS;
  app.deps.flags.openbotDispatch = false;
});
afterAll(async () => {
  delete process.env.OPENBOT_HMAC_SECRET;
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe('item 11, fase sem-segredo (sem segredo nenhum)', () => {
  it('servidor COM segredo: tudo 401 UNAUTHORIZED, a assinatura falsa é recusada e o veredito é "não (provável)"', async () => {
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect(r.ok).toBe(true);
    expect(r.servidorSemSegredo).toBe('nao (provavel)');
    for (const route of ['pull', 'heartbeat', 'io/input', 'io/result', 'callback']) expect(step(r, `POST /api/openbot/${route} sem cabeçalhos`).observado).toMatch(/^401 UNAUTHORIZED \((assinatura_recusada|sem_segredo)\)$/);
    expect(step(r, 'POST /api/openbot/heartbeat com assinatura FALSA').observado).toContain('assinatura_recusada');
    expect(step(r, 'GET /api/openbot/pull').observado).toBe(405);
    expect(step(r, 'GET /studio/piloto').observado).toBe(307);
    expect(step(r, 'smoke').veredito).toBe('PASS');
    expect(r.passos.at(-1)).toMatchObject({ veredito: 'NAO_EXECUTADO' });
  });

  it('servidor SEM segredo (OPENBOT_HMAC_SECRET ausente): reconhece sem_segredo e diz isso com todas as letras', async () => {
    delete process.env.OPENBOT_HMAC_SECRET;
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect(r.ok).toBe(true);
    expect(r.servidorSemSegredo).toBe('sim');
    expect(step(r, 'POST /api/openbot/heartbeat com assinatura FALSA').nota).toContain('NÃO tem o segredo');
  });

  it('não faz NENHUM pull, nem assinado nem sem assinatura que reserve tarefa: só POST sem cabeçalho (401), GETs e a sonda do smoke', async () => {
    await runItem11(opts({ fase: 'sem-segredo' }), io());
    // o `pull` sem cabeçalho é 401 (nada entregue); o cliente do smoke nunca chama pull
    expect(calls.filter((c) => c === 'POST /api/openbot/pull')).toHaveLength(1);
  });

  it('PRODUÇÃO (health env diferente de staging): recusa e não envia mais NADA além do GET /api/health', async () => {
    health.env = 'production';
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect([r.ok, r.recusado]).toEqual([false, 'ambiente_nao_staging']);
    expect(calls).toEqual(['GET /api/health']);
  });

  it('app fora do ar / borda em HTML: FAIL nomeado, sem seguir adiante', async () => {
    override = () => new Response('<!doctype html><html data-kind="502"></html>', { status: 502, headers: { 'content-type': 'text/html' } });
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect([r.ok, r.recusado]).toEqual([false, 'sem_health']);
    expect(calls).toHaveLength(1);
  });

  it('um 423 sem assinatura é FAIL (a assinatura tem de ser conferida ANTES de travar) e 5xx da borda é FAIL', async () => {
    override = (m, p) => (m === 'POST' && p === '/api/openbot/pull' ? Response.json({ error: { code: 'DISPATCH_OFF', message: 'x' } }, { status: 423 }) : null);
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect(r.ok).toBe(false);
    expect(step(r, 'POST /api/openbot/pull sem cabeçalhos')).toMatchObject({ veredito: 'FAIL', observado: '423 DISPATCH_OFF' });
    override = (m, p) => (m === 'POST' && p === '/api/openbot/callback' ? new Response('<html>', { status: 503 }) : null);
    expect(step(await runItem11(opts({ fase: 'sem-segredo' }), io()), 'POST /api/openbot/callback sem cabeçalhos').veredito).toBe('FAIL');
  });

  it('GET /studio/piloto que abre sem sessão (200) e GET na rota que responde 2xx são FAIL', async () => {
    override = (m, p) => (p === '/studio/piloto' ? new Response('planilha', { status: 200 }) : m === 'GET' && p === '/api/openbot/pull' ? new Response('{}', { status: 200 }) : null);
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    expect([step(r, 'GET /studio/piloto').veredito, step(r, 'GET /api/openbot/pull').veredito]).toEqual(['FAIL', 'FAIL']);
  });

  it('a saída nunca traz o segredo, o valor falso nem a assinatura, e texto hostil do servidor não é repetido', async () => {
    override = (m, p) => (m === 'POST' && p === '/api/openbot/io/result' ? Response.json({ error: { code: 'UNAUTHORIZED', message: `<script>alert(1)</script> ${SECRET}` } }, { status: 401 }) : null);
    const r = await runItem11(opts({ fase: 'sem-segredo' }), io());
    const out = JSON.stringify(r) + toText(r);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(FALSE_SECRET);
    expect(out).not.toContain('<script>');
    expect(out).not.toMatch(/v1=[0-9a-f]{64}/);
  });
});

describe('item 11, fase com-segredo (o segredo só passa pelo cliente, lido do arquivo do cofre)', () => {
  const com = (estado: string, extra: Record<string, unknown> = {}) => runItem11(opts({ fase: 'com-segredo', estado, secretFile: '/cofre/ln-hmac', ...extra }), io());

  it('desligado: smoke PASS 404 LEASE_ERROR, pull = 423 DISPATCH_OFF (stop) e segredo errado = 401 assinatura_recusada', async () => {
    const r = await com('desligado', { confirmoDespachoDesligado: true });
    expect(r.ok).toBe(true);
    expect(step(r, '1.')).toMatchObject({ veredito: 'PASS', observado: expect.stringContaining('404 LEASE_ERROR') });
    expect(step(r, '2.')).toMatchObject({ veredito: 'PASS', observado: '423 DISPATCH_OFF stop' });
    expect(step(r, '3.')).toMatchObject({ veredito: 'PASS', observado: '401 assinatura_recusada' });
    expect(JSON.stringify(r) + toText(r)).not.toContain(SECRET);
  });

  it('desligado SEM a confirmação (ou com a flag ligada): recusa e NÃO faz pull', async () => {
    const semConfirmo = await com('desligado');
    expect([semConfirmo.ok, semConfirmo.recusado]).toEqual([false, 'precondicao']);
    health.flags = ['openbotDispatch'];
    const ligada = await com('desligado', { confirmoDespachoDesligado: true });
    expect([ligada.ok, ligada.recusado]).toEqual([false, 'precondicao']);
    expect(calls.filter((c) => c.includes('/api/openbot/'))).toEqual([]);
  });

  it('ligado e fila vazia: smoke --expect-dispatch on PASS e pull devolve lista vazia', async () => {
    health.flags = ['openbotDispatch'];
    app.deps.flags.openbotDispatch = true;
    const r = await com('ligado', { confirmoFilaVazia: true });
    expect(r.ok).toBe(true);
    expect(step(r, '4. pull')).toMatchObject({ veredito: 'PASS', observado: 'lista vazia' });
  });

  it('ligado SEM a confirmação da fila vazia (ou com a flag desligada): recusa e NÃO faz pull', async () => {
    health.flags = ['openbotDispatch'];
    expect((await com('ligado')).recusado).toBe('precondicao');
    health.flags = [];
    expect((await com('ligado', { confirmoFilaVazia: true })).recusado).toBe('precondicao');
    expect(calls.filter((c) => c.includes('/api/openbot/'))).toEqual([]);
  });

  it('ligado com tarefa na fila: o pull reservaria e o script marca FAIL (pede para parar)', async () => {
    health.flags = ['openbotDispatch'];
    override = (m, p) => (m === 'POST' && p === '/api/openbot/pull' ? Response.json({ tasks: [{ taskId: 't' }], leaseMs: 1, serverTime: 'x' }, { status: 200 }) : null);
    const r = await com('ligado', { confirmoFilaVazia: true });
    expect(step(r, '4. pull').veredito).toBe('FAIL');
  });

  it('kill switch ligado: smoke PASS 423 KILL_SWITCH nas duas sondas e pull 423 KILL_SWITCH; o callback em curso fica como NAO_EXECUTADO', async () => {
    const store = new PostgresLedgerStore(app.db as unknown as SqlDatabase);
    await store.setKill('route:openbot', true, 'item11', app.clock.now);
    try {
      const r = await com('kill');
      expect(r.ok).toBe(true);
      expect(step(r, '6. smoke')).toMatchObject({ veredito: 'PASS', observado: expect.stringContaining('423 KILL_SWITCH') });
      expect(step(r, '6. pull')).toMatchObject({ veredito: 'PASS', observado: '423 KILL_SWITCH stop' });
      expect(step(r, '6. callback').veredito).toBe('NAO_EXECUTADO');
    } finally {
      await store.setKill('route:openbot', false, 'soltar', app.clock.now);
    }
  });

  it('kill switch DESLIGADO quando o estado pedido é kill: FAIL (o script não assume o estado, confere)', async () => {
    const r = await com('kill');
    expect(r.ok).toBe(false);
    expect(step(r, '6. pull').veredito).toBe('FAIL');
  });

  it('piloto parado (423 PILOT_STOPPED): smoke PASS e pull 423 PILOT_STOPPED', async () => {
    override = (m, p) => (m === 'POST' && ['/api/openbot/pull', '/api/openbot/heartbeat', '/api/openbot/io/input'].includes(p) ? Response.json({ error: { code: 'PILOT_STOPPED', message: 'x' } }, { status: 423 }) : null);
    const r = await com('parado');
    expect(r.ok).toBe(true);
    expect(step(r, '8. pull')).toMatchObject({ veredito: 'PASS', observado: '423 PILOT_STOPPED stop' });
  });

  it('segredo ausente no arquivo: erro de configuração, sem chamada assinada; produção recusa antes de tudo', async () => {
    files['/cofre/vazio'] = '';
    const r = await runItem11(opts({ fase: 'com-segredo', estado: 'kill', secretFile: '/cofre/vazio' }), io());
    expect(r.ok).toBe(false);
    expect(calls.filter((c) => c.includes('/api/openbot/'))).toEqual([]);
    await expect(runItem11(opts({ fase: 'com-segredo', estado: 'kill' }), io())).rejects.toMatchObject({ code: 'config' });
    health.env = 'production';
    calls = [];
    const p = await com('kill');
    expect([p.ok, p.recusado, calls]).toEqual([false, 'ambiente_nao_staging', ['GET /api/health']]);
  });

  it('argumentos inválidos: fase e estado desconhecidos são recusados antes da rede', async () => {
    await expect(runItem11(opts({ fase: 'tudo' }), io())).rejects.toMatchObject({ code: 'uso' });
    await expect(runItem11(opts({ fase: 'com-segredo', estado: 'talvez', secretFile: '/cofre/ln-hmac' }), io())).rejects.toMatchObject({ code: 'uso' });
    expect(calls).toEqual([]);
  });
});
