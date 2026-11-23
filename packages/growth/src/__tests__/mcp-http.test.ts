import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createReadOnlyMlabsMcpTransport, McpHttpError } from '../mlabs/mcp-http';
import { createMlabsMetricsSource } from '../metrics/mlabs-metrics';

// Transporte MCP por HTTP somente leitura, contra um servidor MCP FALSO em processo (fetch injetado). Nenhuma rede; a credencial é de teste
// e montada em tempo de execução.
const TOKEN = 'tok-' + 'T'.repeat(24);
const URL_OK = 'https://mcp.exemplo.example/mcp';
const NOW = new Date('2026-11-23T12:00:00.000Z');

interface Req { method: string; headers: Record<string, string>; body: { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } } }

/** Servidor MCP falso: initialize (cria sessão), notifications/initialized (202) e tools/call (exige sessão válida: senão 404). */
function fakeServer(
  tools: Record<string, (a: Record<string, unknown>) => unknown>,
  opts: { sse?: boolean; expireSessionOnce?: boolean; status?: number; failNotifyOnce?: boolean; initDelayMs?: number } = {},
) {
  const reqs: Req[] = [];
  const valid = new Set<string>();
  let expired = false;
  let notifyFailed = false;
  let sessions = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>));
    const body = JSON.parse(String(init.body)) as Req['body'];
    reqs.push({ method: String(init.method), headers, body });
    if (opts.status) return new Response('no', { status: opts.status });
    if (headers.authorization !== `Bearer ${TOKEN}`) return new Response('no', { status: 401 });
    const reply = (msg: unknown, h: Record<string, string> = {}) =>
      opts.sse
        ? new Response(`event: message
data: ${JSON.stringify(msg)}

`, { status: 200, headers: { 'content-type': 'text/event-stream', ...h } })
        : new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json', ...h } });
    if (body.method === 'initialize') {
      if (opts.initDelayMs) await new Promise((r) => setTimeout(r, opts.initDelayMs));
      const sid = `sess-${++sessions}`;
      valid.add(sid);
      return reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { 'mcp-session-id': sid });
    }
    if (body.method === 'notifications/initialized') {
      if (opts.failNotifyOnce && !notifyFailed) {
        notifyFailed = true;
        return new Response('indisponivel', { status: 503 });
      }
      return new Response(null, { status: 202 });
    }
    if (opts.expireSessionOnce && !expired) {
      expired = true;
      valid.clear();
    }
    if (!valid.has(headers['mcp-session-id'] ?? '')) return new Response('sessao expirada', { status: 404 });
    const t = tools[body.params?.name ?? ''];
    if (!t) return reply({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'sem a ferramenta' } });
    return reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(t(body.params?.arguments ?? {})) }] } });
  }) as unknown as typeof fetch;
  return { fetchImpl, reqs, expireAll: () => valid.clear() };
}
const refusal = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof McpHttpError ? e.reason : `outro:${String(e)}`));
const tx = (srv: { fetchImpl: typeof fetch }) => createReadOnlyMlabsMcpTransport({ url: URL_OK, token: TOKEN, fetchImpl: srv.fetchImpl });

describe('transporte MCP por HTTP (somente leitura)', () => {
  test('initialize → notifications/initialized → tools/call, com Bearer e a sessão; o resultado é o JSON do texto', async () => {
    const srv = fakeServer({ list_profiles: () => ({ items: [{ id: 'ext_p' }], totalCount: 1 }) });
    const r = await tx(srv).call('list_profiles', {});
    assert.deepEqual(r, { items: [{ id: 'ext_p' }], totalCount: 1 });
    assert.deepEqual(srv.reqs.map((q) => q.body.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.equal(srv.reqs[2]!.headers['mcp-session-id'], 'sess-1');
    assert.ok(srv.reqs.every((q) => q.method === 'POST' && q.headers.authorization === `Bearer ${TOKEN}`));
    await tx(srv).call('list_profiles', {}); // outro transporte: outra sessão
    const t = tx(srv);
    await t.call('list_profiles', {});
    await t.call('list_profiles', {});
    assert.equal(srv.reqs.filter((q) => q.body.method === 'initialize').length, 3, 'um transporte inicializa uma vez só');
  });

  test('resposta em SSE (data:) também é lida', async () => {
    const srv = fakeServer({ get_channel: () => ({ ok: true }) }, { sse: true });
    assert.deepEqual(await tx(srv).call('get_channel', { pageId: 'x' }), { ok: true });
  });

  test('ferramenta de ESCRITA é recusada antes de qualquer requisição (nem initialize)', async () => {
    const srv = fakeServer({});
    for (const w of ['create_post', 'prepare_media_upload', 'upload_media', 'delete_post', 'send_chat_message']) {
      await assert.rejects(() => tx(srv).call(w, {}), /fora da lista de leitura/, w);
    }
    assert.equal(srv.reqs.length, 0);
  });

  test('configuração inválida (URL http, credencial na URL, token vazio ou com quebra de linha) é recusada na criação', () => {
    for (const o of [{ url: 'http://mcp.exemplo.example/mcp', token: TOKEN }, { url: 'https://u:p@mcp.exemplo.example/mcp', token: TOKEN }, { url: URL_OK, token: '' }, { url: URL_OK, token: 'a\nb' }, { url: 'não é url', token: TOKEN }]) {
      assert.throws(() => createReadOnlyMlabsMcpTransport(o), (e) => e instanceof McpHttpError && e.reason === 'config_invalida');
    }
  });

  test('falhas: 401, 5xx, ferramenta recusada, texto que não é JSON, tempo esgotado; o token e o corpo nunca vazam na mensagem', async () => {
    assert.equal(await refusal(createReadOnlyMlabsMcpTransport({ url: URL_OK, token: 'outro-token-errado', fetchImpl: fakeServer({}).fetchImpl }).call('list_profiles', {})), 'http');
    assert.equal(await refusal(tx(fakeServer({}, { status: 503 })).call('list_profiles', {})), 'http');
    assert.equal(await refusal(tx(fakeServer({})).call('list_profiles', {})), 'ferramenta_recusou');
    const naoJson = fakeServer({ list_profiles: () => 1 });
    const orig = naoJson.fetchImpl;
    const bad = (async (u: string, i: RequestInit) => {
      const b = JSON.parse(String(i.body)) as { method: string; id: number };
      if (b.method === 'tools/call') return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: 'isto não é json' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return orig(u, i);
    }) as unknown as typeof fetch;
    assert.equal(await refusal(createReadOnlyMlabsMcpTransport({ url: URL_OK, token: TOKEN, fetchImpl: bad }).call('list_profiles', {})), 'resposta_nao_json');
    const slow = (async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    assert.equal(await refusal(createReadOnlyMlabsMcpTransport({ url: URL_OK, token: TOKEN, fetchImpl: slow }).call('list_profiles', {})), 'tempo_esgotado');
    const e = await createReadOnlyMlabsMcpTransport({ url: URL_OK, token: 'outro-token-errado', fetchImpl: fakeServer({}).fetchImpl }).call('list_profiles', {}).catch((x: Error) => x);
    assert.doesNotMatch(`${(e as Error).message} ${JSON.stringify(e)}`, /outro-token|Bearer|mcp\.exemplo/);
  });

  test('sessão expirada (404): recomeça UMA vez com sessão nova e a chamada conclui', async () => {
    const srv = fakeServer({ list_profiles: () => ({ ok: 1 }) }, { expireSessionOnce: true });
    assert.deepEqual(await tx(srv).call('list_profiles', {}), { ok: 1 });
    assert.equal(srv.reqs.filter((q) => q.body.method === 'initialize').length, 2);
  });
});

describe('inicialização da sessão: recuperação e concorrência', () => {
  const inits = (srv: { reqs: Req[] }) => srv.reqs.filter((q) => q.body.method === 'initialize').length;
  const confirms = (srv: { reqs: Req[] }) => srv.reqs.filter((q) => q.body.method === 'notifications/initialized').length;
  const calls = (srv: { reqs: Req[] }) => srv.reqs.filter((q) => q.body.method === 'tools/call');

  test('503 na confirmação de inicialização: a sessão NÃO fica pronta; a leitura falha e a seguinte reinicializa e funciona', async () => {
    const srv = fakeServer({ list_profiles: () => ({ ok: 1 }) }, { failNotifyOnce: true });
    const t = tx(srv);
    assert.equal(await refusal(t.call('list_profiles', {})), 'http');
    assert.equal(calls(srv).length, 0, 'nenhuma leitura foi enviada com a sessão não confirmada');
    assert.deepEqual(await t.call('list_profiles', {}), { ok: 1 });
    assert.deepEqual([inits(srv), confirms(srv)], [2, 2]);
    assert.deepEqual(await t.call('list_profiles', {}), { ok: 1 });
    assert.equal(inits(srv), 2, 'depois de confirmada a sessão é reaproveitada');
  });

  test('leituras simultâneas compartilham UMA inicialização e a mesma sessão (uma confirmação só)', async () => {
    const srv = fakeServer({ list_profiles: () => ({ ok: 1 }), list_channels: () => [] }, { initDelayMs: 10 });
    const t = tx(srv);
    const [a, b, c] = await Promise.all([t.call('list_profiles', {}), t.call('list_channels', {}), t.call('list_profiles', {})]);
    assert.deepEqual([a, b, c], [{ ok: 1 }, [], { ok: 1 }]);
    assert.deepEqual([inits(srv), confirms(srv)], [1, 1]);
    assert.deepEqual([...new Set(calls(srv).map((q) => q.headers['mcp-session-id']))], ['sess-1']);
  });

  test('inicialização que falha com leituras simultâneas: todas recusam, nada fica guardado e a próxima funciona', async () => {
    const srv = fakeServer({ list_profiles: () => ({ ok: 1 }) }, { failNotifyOnce: true, initDelayMs: 10 });
    const t = tx(srv);
    const r = await Promise.all([refusal(t.call('list_profiles', {})), refusal(t.call('list_profiles', {}))]);
    assert.deepEqual(r, ['http', 'http']);
    assert.equal(inits(srv), 1, 'as duas esperaram a mesma tentativa');
    assert.deepEqual(await t.call('list_profiles', {}), { ok: 1 });
    assert.equal(inits(srv), 2);
  });

  test('sessão expirada com leituras simultâneas: UMA nova sessão para as duas, e as duas concluem', async () => {
    const srv = fakeServer({ list_profiles: () => ({ ok: 1 }) }, { initDelayMs: 10 });
    const t = tx(srv);
    await t.call('list_profiles', {});
    srv.expireAll();
    const out = await Promise.all([t.call('list_profiles', {}), t.call('list_profiles', {})]);
    assert.deepEqual(out, [{ ok: 1 }, { ok: 1 }]);
    assert.equal(inits(srv), 2, 'uma sessão nova, não uma por leitura');
    assert.deepEqual(calls(srv).slice(-2).map((q) => q.headers['mcp-session-id']), ['sess-2', 'sess-2']);
  });

  test('o token nunca vai na confirmação de inicialização com falha (mensagem do erro sem corpo nem segredo)', async () => {
    const srv = fakeServer({}, { failNotifyOnce: true });
    const e = await tx(srv).call('list_profiles', {}).catch((x: Error) => x);
    assert.doesNotMatch(`${(e as Error).message} ${JSON.stringify(e)}`, /indisponivel|tok-|Bearer/);
  });
});

describe('fonte de métricas sobre o transporte MCP por HTTP (servidor falso)', () => {
  test('lê perfil, canal, posts e seguidores só com ferramentas de leitura', async () => {
    const srv = fakeServer({
      list_profiles: () => ({ items: [{ id: 'ext_p', active: true, connectedChannels: ['LINKEDIN'] }], totalCount: 1 }),
      list_channels: () => [{ id: 'ext_c', name: 'Loyalty News', channel: 'linkedin', active: true }],
      list_published_posts: () => ({ posts: [], totalCount: 0, hasMore: false }),
      get_follower_growth: () => ({ status: 'ok', timeline: [{ date: '2026-11-22T00:00:00.000Z', followerCount: 0 }], summary: { startFollowers: 0, endFollowers: 0, totalGrowth: 0 } }),
    });
    const m = await createMlabsMetricsSource({ transport: tx(srv), now: () => NOW }).read();
    assert.deepEqual([m.published.status, m.published.count, m.followers.status, m.followers.current], ['ok', 0, 'ok', 0]);
    const called = srv.reqs.filter((q) => q.body.method === 'tools/call').map((q) => q.body.params!.name).sort();
    assert.deepEqual(called, ['get_follower_growth', 'list_channels', 'list_profiles', 'list_published_posts']);
  });
});
