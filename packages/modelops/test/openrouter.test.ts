import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, checkEvidence, type OpenRouterResponse } from '../src/openrouter.ts';
import { SimulatedOpenRouterClient } from '../src/openrouter.mock.ts';
import { selectClient, createRealOpenRouterClient, OPENROUTER_URL } from '../src/openrouter-client.ts';

test('corpo da requisição: coleta negada, parâmetros exigidos, sem lista de modelos nem plugins', () => {
  const body = buildRequestBody({
    openrouterId: 'anthropic/claude-haiku-5.5',
    messages: [{ role: 'user', content: 'oi' }],
    maxTokens: 300,
    zdrRequired: false,
  });
  assert.equal(body.provider.data_collection, 'deny');
  assert.equal(body.provider.require_parameters, true);
  assert.equal('zdr' in body.provider, false);
  assert.equal('models' in body, false, 'lista de modelos é proibida');
  assert.equal('plugins' in body, false, 'busca web é proibida');
});

test('ZDR entra no corpo quando o trabalho é editorial não publicado', () => {
  const body = buildRequestBody({
    openrouterId: 'anthropic/claude-haiku-5.5',
    messages: [],
    maxTokens: 1,
    zdrRequired: true,
  });
  assert.equal(body.provider.zdr, true);
});

const full: OpenRouterResponse = {
  id: 'g-1',
  model: 'anthropic/claude-haiku-5.5',
  usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 5 },
  generation: { model: 'anthropic/claude-haiku-5.5', provider_name: 'X', total_cost: 0.001 },
};

test('evidência completa passa; campos faltando ou divergentes são listados', () => {
  assert.deepEqual(checkEvidence(full), []);
  const noGen = { ...full, generation: undefined };
  assert.ok(checkEvidence(noGen).includes('generation'));
  const diverge = { ...full, generation: { ...full.generation, model: 'openai/outro' } };
  assert.ok(checkEvidence(diverge).includes('generation.model'));
});

test('cliente padrão é simulado e não faz rede; flag sem chave falha de forma explícita', async () => {
  let netCalls = 0;
  const spy = (async () => {
    netCalls += 1;
    return new Response('{}');
  }) as typeof fetch;

  const simulated = selectClient({});
  assert.ok(simulated instanceof SimulatedOpenRouterClient);
  await simulated.chat(buildRequestBody({ openrouterId: 'x/y', messages: [], maxTokens: 1, zdrRequired: false }));
  assert.equal(netCalls, 0, 'simulado não usa rede');

  assert.ok(selectClient({ OPENROUTER_API_KEY: 'k' }, spy) instanceof SimulatedOpenRouterClient, 'chave sozinha não liga o real');
  assert.throws(() => selectClient({ LN_MODELOPS_REAL_CALLS: '1' }), /OPENROUTER_API_KEY ausente/);
});

test('cliente real: chamada HTTP com chave no cabeçalho, sem vazar a chave em erro', async () => {
  const seen: { url: string; auth: string | undefined; body: string }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({ url: String(url), auth: headers.Authorization, body: String(init?.body) });
    return new Response(JSON.stringify(full), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const client = selectClient({ LN_MODELOPS_REAL_CALLS: '1', OPENROUTER_API_KEY: 'sk-SEGREDO-123' }, fake);
  const body = buildRequestBody({ openrouterId: 'anthropic/claude-haiku-5.5', messages: [], maxTokens: 1, zdrRequired: false });
  const resp = await client.chat(body);
  assert.equal(resp.id, 'g-1');
  assert.equal(seen[0]?.url, OPENROUTER_URL);
  assert.equal(seen[0]?.auth, 'Bearer sk-SEGREDO-123');
  assert.ok(seen[0]?.body.includes('"data_collection":"deny"'));

  const failing = createRealOpenRouterClient('sk-SEGREDO-123', (async () => new Response('x', { status: 500 })) as typeof fetch);
  await assert.rejects(
    failing.chat(body),
    (err: Error) => /HTTP 500/.test(err.message) && !err.message.includes('SEGREDO'),
  );
});

test('cliente simulado: registra chamadas e falha quando pedido', async () => {
  const sim = new SimulatedOpenRouterClient({ failFirst: 1 });
  const body = buildRequestBody({ openrouterId: 'x/y', messages: [], maxTokens: 1, zdrRequired: false });
  await assert.rejects(sim.chat(body));
  const ok = await sim.chat(body);
  assert.equal(sim.calls.length, 2);
  assert.equal(ok.generation?.provider_name, 'SIMULADO', 'resposta simulada é marcada');
});
