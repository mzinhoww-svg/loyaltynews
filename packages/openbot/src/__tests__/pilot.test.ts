import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ApiError } from '@ln/contracts';
import {
  adapterReport, dispatchTask, getOpenBotStatus, handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore,
  InMemoryLeaseQueue, InMemoryPilotRowStore, InMemoryPilotState, OPENBOT_PERMISSIONS, PILOT_CSV_COLUMNS, PILOT_PERMISSIONS, pilotCsv, redactText,
  resumePilot, signBody, STOP, type CallbackResult, type Caller, type OpenBotDeps, type PilotGate, type PilotRow, type PullResult, type SignedRequest,
} from '../index';

const SECRET = 'segredo-de-teste-piloto';
let clock = new Date('2026-11-23T12:00:00.000Z');
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms); };
const iso = (offsetMs = 0) => new Date(clock.getTime() + offsetMs).toISOString();

const ADMIN: Caller = { id: 'u', permissions: [OPENBOT_PERMISSIONS.dispatch, OPENBOT_PERMISSIONS.read, PILOT_PERMISSIONS.admin] };
const isErr = (b: unknown): b is ApiError => typeof b === 'object' && b !== null && 'error' in b;
const code = (b: unknown) => (isErr(b) ? b.error.code : undefined);
const ok = <T>(r: { status: number; body: T | ApiError }): T => {
  assert.ok(!isErr(r.body), JSON.stringify(r.body));
  return r.body as T;
};
const signed = (obj: unknown): SignedRequest => {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(SECRET, clock.getTime(), body), timestampMs: clock.getTime() };
};

/** Gate de teste com a MESMA semântica de paradas do `canDispatchNext` do AgentOps (a conferência real entra com ft/agents). */
const gate: PilotGate = (rows) => {
  const reasons: string[] = [];
  rows.forEach((r, i) => {
    if (r.published_attempt) reasons.push(`linha ${i + 1}: tentativa de publicar`);
    if (r.tarifada_api_call) reasons.push(`linha ${i + 1}: chamada à API tarifada`);
    if (r.secret_in_log) reasons.push(`linha ${i + 1}: segredo em log`);
    if (r.tool_outside_contract) reasons.push(`linha ${i + 1}: ferramenta fora do contrato`);
  });
  return { allowed: reasons.length === 0, reasons };
};

let deps: OpenBotDeps;
let rows: InMemoryPilotRowStore;
let state: InMemoryPilotState;
let n = 0;
let gateImpl: PilotGate;

beforeEach(() => {
  clock = new Date('2026-11-23T12:00:00.000Z');
  rows = new InMemoryPilotRowStore();
  state = new InMemoryPilotState();
  gateImpl = gate;
  deps = {
    queue: new InMemoryLeaseQueue(() => `lease-${++n}`),
    ledger: new InMemoryCostLedger(),
    health: new InMemoryHealthStore(),
    callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET],
    flags: () => ({ dispatchEnabled: true, kill: false }),
    now: () => clock,
    pilot: { enabled: true, rows, state, gate: (r) => gateImpl(r) },
  };
});

const dispatch = (over: Record<string, unknown> = {}) => dispatchTask(deps, ADMIN, {
  kind: 'classification', profileId: 'newsdesk', refId: 'art-1', idempotencyKey: `k-${n++}`, dataClass: 'public', maxCostMicro: 1, ...over,
});
const pull = async (account: string, kinds?: string[]) => ok<PullResult>(await handlePull(deps, signed({ workerId: `agent-${account}`, account, ...(kinds ? { kinds } : {}) }))).tasks[0];
const free = (t: { id: string; leaseId: string }, account: 'claude' | 'codex' | 'opencode' | 'antigravity', model: string) => ({
  executionId: `ex-${t.id}-${account}-${n++}`, taskId: t.id, leaseId: t.leaseId, model,
  lane: account === 'opencode' ? 'opencode' : account === 'antigravity' ? 'antigravity' : 'subscription', account, costMicro: 0,
});
const trace = (stage: string, account: string, over: Record<string, unknown> = {}) => ({ stage, account, startedAt: iso(-1000), endedAt: iso(), packetChars: 1200, ...over });
const callback = (t: { id: string; leaseId: string }, body: Record<string, unknown>) => handleCallback(deps, signed({ callbackId: `cb-${n++}`, taskId: t.id, leaseId: t.leaseId, ...body }));

describe('piloto: o pull exige a via e a trilha é obrigatória', () => {
  test('pull sem account no piloto é 400; com account só recebe tarefas da sua via', async () => {
    await dispatch();
    assert.equal((await handlePull(deps, signed({ workerId: 'w' }))).status, 400);
    assert.equal(await pull('claude'), undefined);
    assert.equal(await pull('codex'), undefined);
    const t = await pull('opencode');
    assert.equal(t?.account, 'opencode');
  });

  test('callback sem trilha no piloto é 422 TRACE_REQUIRED; trilha de outra conta que o custo é 422 TRACE_MISMATCH', async () => {
    await dispatch();
    const t = (await pull('opencode'))!;
    const r = await callback(t, { outcome: 'completed', usage: free(t, 'opencode', 'opencode/deepseek-v4.1-flash-free') });
    assert.equal(code(r.body), 'TRACE_REQUIRED');
    const r2 = await callback(t, { outcome: 'completed', usage: free(t, 'opencode', 'x'), trace: trace('triage', 'claude') });
    assert.equal(code(r2.body), 'TRACE_MISMATCH');
    assert.equal((await rows.all()).length, 0);
  });
});

describe('piloto: limite da conta troca de via (e redação nunca troca)', () => {
  test('pauta: opencode bate o limite → vai ao claude → ao antigravity; a conta usada fica na linha; a retomada observada é marcada', async () => {
    await dispatch();
    const a = (await pull('opencode'))!;
    const lim = ok<CallbackResult>(await callback(a, {
      outcome: 'failed', error: 'limite',
      usage: free(a, 'opencode', 'opencode/deepseek-v4.1-flash-free'),
      trace: trace('triage', 'opencode', { limit: { message: 'Free limit reached. Contato: dev@exemplo.com', at: iso() } }),
    }));
    assert.equal(lim.nextAccount, 'claude');
    assert.equal(lim.task?.status, 'pending');
    assert.equal(await pull('opencode'), undefined, 'a via que bateu o limite não puxa de novo');

    const b = (await pull('claude'))!;
    assert.equal(b.id, a.id);
    ok(await callback(b, { outcome: 'failed', usage: free(b, 'claude', 'claude-haiku-5-5'), trace: trace('triage', 'claude', { limit: { message: 'limite do Claude', at: iso() } }) }));
    const c = (await pull('antigravity'))!;
    assert.equal(c.id, a.id);
    tick(60_000);
    const done = ok<CallbackResult>(await callback(c, { outcome: 'completed', resultRef: 'res-1', usage: free(c, 'antigravity', 'gemini-3.8-flash'), trace: trace('triage', 'antigravity', { promptVersion: 'editorial-0.2', sourceId: 'senado-noticias' }) }));
    assert.equal(done.task?.status, 'completed');

    const r = await rows.all();
    assert.deepEqual(r.map((x) => [x.attempt, x.account, x.outcome]), [[1, 'opencode', 'pending_limit'], [2, 'claude', 'pending_limit'], [3, 'antigravity', 'completed']]);
    assert.equal(r[0]!.limit_message?.includes('dev@exemplo.com'), false, 'e-mail mascarado na mensagem de limite');
    assert.ok(r[0]!.limit_message?.includes('[e-mail]'));
    assert.equal(r[2]!.declared_model, 'gemini-3.8-flash');
    assert.equal(r[2]!.source_id, 'senado-noticias');
    assert.equal(r[2]!.tokens_measured, false);
    assert.equal(r[2]!.tarifada_api_call, false);
    // retomada observada: a primeira conclusão depois do limite marca `account_resumed_at` da mesma conta, quando ela volta a aceitar
    assert.equal(r[0]!.account_resumed_at, undefined);
  });

  test('a conta que bateu o limite e volta a concluir tem a retomada observada gravada', async () => {
    await dispatch({ route: ['opencode'], refId: 'art-2' });
    const a = (await pull('opencode'))!;
    ok(await callback(a, { outcome: 'failed', usage: free(a, 'opencode', 'm'), trace: trace('triage', 'opencode', { limit: { message: 'limite', at: iso(), resumeAt: iso(600_000) } }) }));
    tick(600_001);
    const b = (await pull('opencode'))!;
    ok(await callback(b, { outcome: 'completed', resultRef: 'r', usage: free(b, 'opencode', 'm'), trace: { ...trace('triage', 'opencode'), startedAt: iso(-10), endedAt: iso() } }));
    const first = (await rows.all()).find((x) => x.attempt === 1)!;
    assert.equal(first.outcome, 'pending_limit');
    assert.equal(first.account_resumed_at, new Date(clock.getTime() - 10).toISOString());
  });

  test('checagem: codex bate o limite → antigravity; revisão idem', async () => {
    for (const kind of ['fact_check', 'editorial_review']) {
      await dispatch({ kind, refId: `art-${kind}` });
      const a = (await pull('codex', [kind]))!;
      const r = ok<CallbackResult>(await callback(a, { outcome: 'failed', usage: free(a, 'codex', 'gpt-6.2-sol'), trace: trace(kind === 'fact_check' ? 'factcheck' : 'review', 'codex', { limit: { message: 'limite', at: iso() } }) }));
      assert.equal(r.nextAccount, 'antigravity', kind);
      assert.equal((await pull('antigravity', [kind]))?.id, a.id);
    }
  });

  test('redação NUNCA troca de via: no limite espera e a mesma via retoma; nenhuma outra recebe', async () => {
    await dispatch({ kind: 'editorial_draft', profileId: 'writer_programas', refId: 'art-d' });
    const a = (await pull('claude', ['editorial_draft']))!;
    const r = ok<CallbackResult>(await callback(a, { outcome: 'failed', usage: free(a, 'claude', 'claude-sonnet-5-5'), trace: trace('draft', 'claude', { limit: { message: 'limite', at: iso(), resumeAt: iso(900_000) } }) }));
    assert.equal(r.nextAccount, null);
    for (const acc of ['opencode', 'antigravity', 'codex']) assert.equal(await pull(acc), undefined, acc);
    tick(900_001);
    assert.equal((await pull('claude', ['editorial_draft']))?.id, a.id);
  });

  test('o limite não consome tentativa: mesmo com maxAttempts 1 a tarefa segue pelas vias', async () => {
    await dispatch({ maxAttempts: 1, refId: 'art-3' });
    const a = (await pull('opencode'))!;
    ok(await callback(a, { outcome: 'failed', usage: free(a, 'opencode', 'm'), trace: trace('triage', 'opencode', { limit: { message: 'limite', at: iso() } }) }));
    const b = (await pull('claude'))!;
    assert.equal(b.id, a.id);
    assert.equal(b.attempt, 2);
  });
});

describe('piloto: a rota é imposta (conta fora da rota = violação)', () => {
  test('executar por uma via diferente da atribuída é 422, vira linha de violação e PARA o piloto', async () => {
    await dispatch({ kind: 'editorial_draft', profileId: 'writer_programas', refId: 'art-r' });
    const a = (await pull('claude', ['editorial_draft']))!;
    const r = await callback(a, { outcome: 'completed', resultRef: 'r', usage: free(a, 'codex', 'gpt-6.2-sol'), trace: trace('draft', 'codex') });
    assert.equal(code(r.body), 'ACCOUNT_OUT_OF_ROUTE');
    assert.deepEqual((await state.get())?.reasons, [STOP.route]);
    assert.equal(code((await handlePull(deps, signed({ workerId: 'w', account: 'claude' }))).body), 'PILOT_STOPPED');
  });

  test('despacho com rota que AMPLIA a padrão, ou redação com mais de uma via, é recusado', async () => {
    assert.equal(code((await dispatch({ kind: 'editorial_draft', route: ['claude', 'codex'] })).body), 'ROUTE_INVALID');
    assert.equal(code((await dispatch({ kind: 'fact_check', route: ['codex', 'claude'] })).body), 'ROUTE_INVALID');
    assert.equal(code((await dispatch({ kind: 'fact_check', route: ['antigravity', 'codex'] })).body), 'ROUTE_INVALID', 'ordem diferente da padrão');
    assert.equal((await dispatch({ kind: 'fact_check', route: ['antigravity'] , refId: 'art-x' })).status, 201, 'restringir é permitido');
  });
});

describe('piloto: parada imediata', () => {
  test('API tarifada (faixa api): linha marcada, piloto parado, nada mais é entregue nem despachado', async () => {
    await dispatch();
    const a = (await pull('opencode'))!;
    const r = ok<CallbackResult>(await callback(a, {
      outcome: 'completed', resultRef: 'r',
      usage: { executionId: 'ex-api', taskId: a.id, leaseId: a.leaseId, model: 'anthropic/claude-sonnet-5.5', promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, generationIds: ['gen-1'], costMicro: 500 },
      trace: trace('triage', 'opencode'),
    }));
    assert.deepEqual(r.pilotStopped, [STOP.api]);
    assert.equal((await rows.all())[0]!.tarifada_api_call, true);
    assert.equal(code((await handlePull(deps, signed({ workerId: 'w', account: 'opencode' }))).body), 'PILOT_STOPPED');
    assert.equal(code((await dispatch({ refId: 'art-novo' })).body), 'PILOT_STOPPED');
  });

  test('tentativa de despachar publicação: 422, linha de violação com published_attempt e piloto parado', async () => {
    const r = await dispatch({ kind: 'create_post', refId: 'art-p' });
    assert.equal(code(r.body), 'KIND_FORBIDDEN');
    const v = (await rows.all()).find((x) => x.task_id.startsWith('violation-'))!;
    assert.equal(v.published_attempt, true);
    assert.deepEqual((await state.get())?.reasons, [STOP.publish]);
    assert.equal(code((await dispatch({ refId: 'outra' })).body), 'PILOT_STOPPED');
  });

  test('segredo em texto vindo do OpenBot: mascarado, linha marcada e piloto parado (o segredo nunca é gravado)', async () => {
    await dispatch();
    const a = (await pull('opencode'))!;
    const leaked = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345678';
    const r = ok<CallbackResult>(await callback(a, {
      outcome: 'failed', error: `falha com a chave ${leaked}`, retryable: false, usage: free(a, 'opencode', 'm'),
      trace: trace('triage', 'opencode', { notes: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789' }),
    }));
    assert.deepEqual(r.pilotStopped, [STOP.secret]);
    const stored = JSON.stringify([await rows.all(), await deps.queue.get(a.id)]);
    assert.equal(stored.includes(leaked), false);
    assert.equal(stored.includes('abcdefghijklmnopqrstuvwxyz0123456789'), false);
    assert.equal((await rows.all())[0]!.secret_in_log, true);
  });

  test('ferramenta fora do contrato relatada pelo OpenBot: piloto parado', async () => {
    await dispatch();
    const a = (await pull('opencode'))!;
    const r = ok<CallbackResult>(await callback(a, { outcome: 'completed', resultRef: 'r', usage: free(a, 'opencode', 'm'), trace: trace('triage', 'opencode', { toolOutsideContract: true }) }));
    assert.deepEqual(r.pilotStopped, [STOP.tool]);
  });

  test('o canDispatchNext do AgentOps recusando as linhas barra pull, heartbeat e despacho e fica parado até retomar', async () => {
    await dispatch();
    await rows.upsert({ task_id: 'x', kind: 'classification', article_id: 'a', source_id: 's', stage: 'triage', account: 'opencode', declared_model: 'm', prompt_version: null, started_at: iso(), ended_at: iso(), attempt: 1, outcome: 'completed', packet_chars: 1, tokens_measured: false, published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: true });
    const r = await handlePull(deps, signed({ workerId: 'w', account: 'opencode' }));
    assert.equal(r.status, 503);
    assert.equal(code(r.body), 'PILOT_STOPPED');
    assert.ok((await state.get())?.reasons.some((m) => m.startsWith(STOP.gate)));
    assert.equal(code((await dispatch({ refId: 'b' })).body), 'PILOT_STOPPED');
  });

  test('retomar exige permissão de administrador e só funciona se o gate voltar a aceitar', async () => {
    await state.stop(STOP.secret, iso());
    await rows.upsert({ task_id: 'x', kind: 'classification', article_id: 'a', source_id: 's', stage: 'triage', account: 'opencode', declared_model: 'm', prompt_version: null, started_at: iso(), ended_at: iso(), attempt: 1, outcome: 'completed', packet_chars: 1, tokens_measured: false, published_attempt: false, tarifada_api_call: false, secret_in_log: true, tool_outside_contract: false });
    assert.equal((await resumePilot(deps, { id: 'x', permissions: [] })).status, 403);
    const still = await resumePilot(deps, ADMIN);
    assert.equal(still.status, 409);
    assert.equal(code(still.body), 'PILOT_STILL_INVALID');
    await rows.patch('x', 1, { secret_in_log: false });
    assert.deepEqual(ok(await resumePilot(deps, ADMIN)), { resumed: true });
    assert.equal(await state.get(), null);
  });

  test('piloto desligado: nenhuma das regras vale (sem trilha obrigatória, sem parada)', async () => {
    deps = { ...deps, pilot: { ...deps.pilot!, enabled: false } };
    await dispatch();
    const t = ok<PullResult>(await handlePull(deps, signed({ workerId: 'w' }))).tasks[0]!;
    const r = ok<CallbackResult>(await handleCallback(deps, signed({ callbackId: 'cb-off', taskId: t.id, leaseId: t.leaseId, outcome: 'completed', usage: free(t, 'opencode', 'm') })));
    assert.equal(r.pilotStopped, undefined);
    assert.equal((await rows.all()).length, 0);
  });

  test('estado: o piloto aparece no status, com parada e quantidade de linhas', async () => {
    await state.stop(STOP.api, iso());
    const s = ok(await getOpenBotStatus(deps, ADMIN));
    assert.deepEqual([s.pilot?.enabled, s.pilot?.stopped?.reasons, s.pilot?.rows], [true, [STOP.api], 0]);
  });
});

describe('planilha e relatório', () => {
  const row = (over: Partial<PilotRow> = {}): PilotRow => ({
    task_id: 't1', kind: 'editorial_draft', article_id: 'a1', source_id: 's', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'editorial-0.2',
    started_at: '2026-11-23T12:00:00.000Z', ended_at: '2026-11-23T12:01:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 100, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  });

  test('CSV com as colunas do AgentOps, na ordem; células seguras contra fórmula e com aspas escapadas', () => {
    const csv = pilotCsv([row({ notes: '=HYPERLINK("http://x")', gate_reasons: ['a', 'b'], limit_message: 'disse "oi", ok' })]);
    const [head, line] = csv.trim().split('\n');
    assert.equal(head, PILOT_CSV_COLUMNS.join(','));
    assert.equal(PILOT_CSV_COLUMNS.length, 28);
    assert.ok(line!.includes("\"'=HYPERLINK(\"\"http://x\"\")\""));
    assert.ok(line!.includes('a | b'));
    assert.ok(line!.includes('"disse ""oi"", ok"'));
    assert.ok(line!.includes(',false,'));
  });

  test('relatório do adaptador: contas, limites e janelas, independência por modelo declarado (Claude via Antigravity não é independente do redator Claude)', () => {
    const rs: PilotRow[] = [
      row({ task_id: 'd', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5' }),
      row({ task_id: 'f1', stage: 'factcheck', account: 'codex', declared_model: 'gpt-6.2-sol' }),
      row({ task_id: 'f2', stage: 'review', account: 'antigravity', declared_model: 'claude-sonnet-4-6', article_id: 'a1' }),
      row({ task_id: 'l', stage: 'triage', account: 'opencode', declared_model: 'm', article_id: 'a2', outcome: 'pending_limit', limit_at: '2026-11-23T12:00:00.000Z', account_resumed_at: '2026-11-23T12:30:00.000Z' }),
    ];
    const rep = adapterReport(rs);
    assert.equal(rep.articles, 2);
    assert.equal(rep.byAccount.opencode?.limitHits, 1);
    assert.deepEqual(rep.limitWindowsMs, [1_800_000]);
    assert.equal(rep.independence.checked, 2);
    assert.equal(rep.independence.independent, 1);
    assert.equal(rep.independence.violations.length, 1);
    assert.ok(rep.independence.violations[0]!.includes('review (antigravity)'));
    assert.ok(rep.notMeasured[0]!.includes('tokens'));
  });

  test('redactText: máscara e-mail e segredos de vários formatos; texto limpo passa intacto', () => {
    assert.deepEqual(redactText('tudo certo'), { text: 'tudo certo', secretFound: false });
    const r = redactText('fale com a@b.com; sk-ABCDEFGHIJKLMNOPQRSTUV; ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123; -----BEGIN RSA PRIVATE KEY-----; password: hunter2hunter2');
    assert.equal(r.secretFound, true);
    for (const s of ['a@b.com', 'sk-ABCDEF', 'ghp_ABCDEF', 'BEGIN RSA', 'hunter2hunter2']) assert.equal(r.text.includes(s), false, s);
  });
});
