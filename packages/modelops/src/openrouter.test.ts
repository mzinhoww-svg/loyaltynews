import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildRequestBody, checkEvidence, isNoChargeStatus, ProviderRejectedError, type OpenRouterResponse } from './openrouter';
import { SimulatedOpenRouterClient } from './openrouter.mock';
import { selectClient, createRealOpenRouterClient, createOpenRouterCreditsReader, OPENROUTER_URL } from './openrouter-client';

const POLICY_ON = { rules: { production_enabled: true } };
const POLICY_OFF = { rules: { production_enabled: false } };

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

test('seleção: padrão simulado sem rede; flag desligada ignora a chave; flag ligada sem chave falha', async () => {
  let netCalls = 0;
  const spy = (async () => {
    netCalls += 1;
    return new Response('{}');
  }) as typeof fetch;

  const simulated = selectClient({ policy: POLICY_OFF });
  assert.ok(simulated instanceof SimulatedOpenRouterClient);
  await simulated.chat(buildRequestBody({ openrouterId: 'x/y', messages: [], maxTokens: 1, zdrRequired: false }));
  assert.equal(netCalls, 0, 'simulado não usa rede');

  assert.ok(selectClient({ policy: POLICY_ON, apiKey: 'k' }, spy) instanceof SimulatedOpenRouterClient, 'chave sozinha não liga o real');
  assert.throws(
    () => selectClient({ policy: POLICY_ON, flags: { modelosHabilitados: true } }),
    /chave do OpenRouter está ausente/,
  );
  // Política habilitada com flag desligada: continua simulado (gate formal: production_enabled E flag).
  assert.ok(
    selectClient({ policy: POLICY_ON, apiKey: 'k', flags: { modelosHabilitados: false } }, spy) instanceof SimulatedOpenRouterClient,
  );
  assert.ok(
    selectClient({ policy: POLICY_OFF, apiKey: 'k', flags: { modelosHabilitados: true } }, spy) instanceof SimulatedOpenRouterClient,
    'política desligada bloqueia mesmo com flag ligada',
  );
  assert.equal(netCalls, 0, 'nenhuma seleção acima usa a rede');
});

test('cliente real: chamada HTTP com chave no cabeçalho, sem vazar a chave em erro', async () => {
  const seen: { url: string; auth: string | undefined; body: string }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({ url: String(url), auth: headers.Authorization, body: String(init?.body) });
    return new Response(JSON.stringify(full), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const client = selectClient({ policy: POLICY_ON, apiKey: 'sk-SEGREDO-123', flags: { modelosHabilitados: true } }, fake);
  const body = buildRequestBody({ openrouterId: 'anthropic/claude-haiku-5.5', messages: [], maxTokens: 1, zdrRequired: false });
  const resp = await client.chat(body);
  assert.equal(resp.id, 'g-1');
  assert.equal(seen[0]?.url, OPENROUTER_URL);
  assert.equal(seen[0]?.auth, 'Bearer sk-SEGREDO-123');
  assert.ok(seen[0]?.body.includes('"data_collection":"deny"'));
});

test('classificação de falha: 429 é rejeição sem cobrança; 500, rede e resposta ilegível são incertas', async () => {
  const body = buildRequestBody({ openrouterId: 'x/y', messages: [], maxTokens: 1, zdrRequired: false });
  const key = 'sk-SEGREDO-123';

  const rejected = createRealOpenRouterClient(key, (async () => new Response('x', { status: 429 })) as typeof fetch);
  await assert.rejects(rejected.chat(body), (err: unknown) => err instanceof ProviderRejectedError && err.status === 429);

  const server = createRealOpenRouterClient(key, (async () => new Response('x', { status: 500 })) as typeof fetch);
  await assert.rejects(server.chat(body), (err: unknown) => {
    return !(err instanceof ProviderRejectedError) && /incerto/.test((err as Error).message) && !(err as Error).message.includes('SEGREDO');
  });

  const network = createRealOpenRouterClient(key, (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch);
  await assert.rejects(network.chat(body), (err: unknown) => !(err instanceof ProviderRejectedError) && /incerto/.test((err as Error).message));

  const badJson = createRealOpenRouterClient(key, (async () => new Response('não é json', { status: 200 })) as typeof fetch);
  await assert.rejects(badJson.chat(body), (err: unknown) => !(err instanceof ProviderRejectedError) && /incerto/.test((err as Error).message));
});

test('códigos sem cobrança são exatamente os da política; os demais são incertos', () => {
  for (const s of [400, 401, 402, 403, 404, 422, 429]) assert.equal(isNoChargeStatus(s), true, `HTTP ${s}`);
  for (const s of [408, 500, 502, 503, 504]) assert.equal(isNoChargeStatus(s), false, `HTTP ${s}`);
});

test('leitor de saldo: total de créditos menos uso; formato inesperado falha fechado', async () => {
  const okReader = createOpenRouterCreditsReader('k', (async () =>
    new Response(JSON.stringify({ data: { total_credits: 5, total_usage: 0.77 } }), { status: 200 })) as typeof fetch);
  assert.equal(await okReader(), 4.23);

  const badReader = createOpenRouterCreditsReader('k', (async () =>
    new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch);
  await assert.rejects(badReader(), /formato inesperado/);
});

test('cliente simulado: registra chamadas e falha quando pedido', async () => {
  const sim = new SimulatedOpenRouterClient({ failFirst: 1, failKind: 'rejected' });
  const body = buildRequestBody({ openrouterId: 'x/y', messages: [], maxTokens: 1, zdrRequired: false });
  await assert.rejects(sim.chat(body), (err: unknown) => err instanceof ProviderRejectedError);
  const ok = await sim.chat(body);
  assert.equal(sim.calls.length, 2);
  assert.equal(ok.generation?.provider_name, 'SIMULADO', 'resposta simulada é marcada');
});
