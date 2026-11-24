import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ApiError } from '@ln/contracts';
import {
  adapterReport, awaitingEditorialGate, DP41_ACCOUNTS, dispatchTask, getOpenBotStatus, handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore,
  InMemoryLeaseQueue, InMemoryPilotRowStore, InMemoryPilotState, OpenBotModelGateway, OPENBOT_PERMISSIONS, PILOT_CSV_COLUMNS, PILOT_PERMISSIONS, pilotCsv, redactText,
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
    // a mecânica genérica (rotas, troca de via, limite) é testada com as 4 contas; a DP-41 (só claude e codex) tem a suíte própria abaixo
    pilot: { enabled: true, allowedAccounts: ['claude', 'codex', 'opencode', 'antigravity'], rows, state, gate: (r) => gateImpl(r) },
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
    // chave FALSA montada em tempo de execução (nenhum segredo, nem de mentira, literal no arquivo; DP-37)
    const leaked = 'sk-' + 'A'.repeat(32);
    const r = ok<CallbackResult>(await callback(a, {
      outcome: 'failed', error: `falha com a chave ${leaked}`, retryable: false, usage: free(a, 'opencode', 'm'),
      trace: trace('triage', 'opencode', { notes: `Authorization: Bearer ${'a'.repeat(36)}` }),
    }));
    assert.deepEqual(r.pilotStopped, [STOP.secret]);
    const stored = JSON.stringify([await rows.all(), await deps.queue.get(a.id)]);
    assert.equal(stored.includes(leaked), false);
    assert.equal(stored.includes('a'.repeat(36)), false);
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
    assert.equal(r.status, 423);
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
    assert.equal(PILOT_CSV_COLUMNS.length, 31);
    assert.ok(line!.includes("\"'=HYPERLINK(\"\"http://x\"\")\""));
    assert.ok(line!.includes('a | b'));
    assert.ok(line!.includes('"disse ""oi"", ok"'));
    assert.ok(line!.includes(',false,'));
  });

  test('gravidade dos fatos não suportados (ft/agents 041a74f): as 3 colunas vêm logo depois de unsupported_facts, na ordem do AgentOps, com os valores', () => {
    const cols = [...PILOT_CSV_COLUMNS];
    const i = cols.indexOf('unsupported_facts');
    assert.deepEqual(cols.slice(i, i + 5), ['unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low', 'published_attempt']);
    const [head, line] = pilotCsv([row({ unsupported_facts: 3, unsupported_high: 0, unsupported_medium: 1, unsupported_low: 2 })]).trim().split('\n');
    const h = head!.split(',');
    const v = line!.split(',');
    assert.deepEqual(['unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low'].map((c) => v[h.indexOf(c)]), ['3', '0', '1', '2']);
    // sem gravidade informada, as células ficam vazias (nunca 0 inventado)
    const [, none] = pilotCsv([row({ unsupported_facts: 2 })]).trim().split('\n');
    assert.deepEqual(['unsupported_high', 'unsupported_medium', 'unsupported_low'].map((c) => none!.split(',')[h.indexOf(c)]), ['', '', '']);
  });

  test('o patch da Editorial com a gravidade é gravado e relido (campos opcionais do PilotRow)', async () => {
    const store = new InMemoryPilotRowStore();
    await store.upsert(row({ task_id: 'p1', stage: 'review', account: 'codex', declared_model: 'gpt-5.1-codex' }));
    assert.equal(await store.patch('p1', 1, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true, unsupported_facts: 3, unsupported_high: 0, unsupported_medium: 1, unsupported_low: 2 }), true);
    const [r] = await store.all();
    assert.deepEqual([r!.unsupported_facts, r!.unsupported_high, r!.unsupported_medium, r!.unsupported_low], [3, 0, 1, 2]);
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
    // fixtures FALSAS montadas em tempo de execução (DP-37): nada com cara de segredo fica literal no arquivo
    const sk = 'sk-' + 'A'.repeat(32);
    const gh = 'ghp_' + 'A'.repeat(36);
    const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
    const pass = 'password: ' + 'h'.repeat(16);
    const r = redactText(`fale com a@b.com; ${sk}; ${gh}; ${pem}; ${pass}`);
    assert.equal(r.secretFound, true);
    for (const s of ['a@b.com', sk, gh, 'BEGIN RSA', 'h'.repeat(16)]) assert.equal(r.text.includes(s), false, s.slice(0, 8));
  });
});

describe('DP-41: o piloto só usa as assinaturas Claude e Codex (padrão do piloto)', () => {
  beforeEach(() => {
    deps = { ...deps, pilot: { enabled: true, rows, state, gate: (r) => gateImpl(r) } }; // sem allowedAccounts: vale a DP-41
  });
  const routeOf = async (kind: string, extra: Record<string, unknown> = {}) => {
    const r = await dispatch({ kind, ...extra });
    return r.status < 300 ? (ok<{ task: { route: string[] } }>(r).task.route) : code(r.body);
  };

  test('o padrão é claude e codex', () => {
    assert.deepEqual([...DP41_ACCOUNTS], ['claude', 'codex']);
  });

  test('as rotas padrão perdem opencode e antigravity: pauta só claude; checagem e revisão só codex; redação e social só claude', async () => {
    assert.deepEqual(await routeOf('classification', { idempotencyKey: 'a' }), ['claude']);
    assert.deepEqual(await routeOf('fact_check', { idempotencyKey: 'b' }), ['codex']);
    assert.deepEqual(await routeOf('editorial_review', { idempotencyKey: 'c' }), ['codex']);
    assert.deepEqual(await routeOf('editorial_draft', { idempotencyKey: 'd' }), ['claude']);
    assert.deepEqual(await routeOf('social_copy', { idempotencyKey: 'e' }), ['claude']);
  });

  test('rota pedida com opencode ou antigravity é recusada (422 ROUTE_INVALID) e nada entra na fila', async () => {
    for (const route of [['opencode'], ['opencode', 'claude'], ['claude', 'antigravity']]) {
      assert.equal(await routeOf('classification', { route, idempotencyKey: `r-${route.join('')}` }), 'ROUTE_INVALID', route.join('+'));
    }
    assert.equal(await routeOf('fact_check', { route: ['codex', 'antigravity'], idempotencyKey: 'x' }), 'ROUTE_INVALID');
    assert.equal((await deps.queue.counts()).pending, 0);
  });

  test('pull como opencode ou antigravity: 422 ACCOUNT_OUT_OF_ROUTE, linha de violação e o piloto PARA (423 até o resumePilot); nada é entregue nem a saúde marcada', async () => {
    for (const account of ['opencode', 'antigravity']) {
      state = new InMemoryPilotState();
      rows = new InMemoryPilotRowStore();
      deps = { ...deps, pilot: { ...deps.pilot!, state, rows }, queue: new InMemoryLeaseQueue(() => `lease-${++n}`), health: new InMemoryHealthStore() };
      await dispatch({ idempotencyKey: `p-${account}` });
      const r = await handlePull(deps, signed({ workerId: `agent-${account}`, account }));
      assert.deepEqual([r.status, code(r.body)], [422, 'ACCOUNT_OUT_OF_ROUTE'], account);
      assert.deepEqual((await state.get())?.reasons, [STOP.route], account);
      assert.equal((await rows.all())[0]?.article_id, `conta-${account}`);
      assert.equal(code((await handlePull(deps, signed({ workerId: 'agent-claude', account: 'claude' }))).body), 'PILOT_STOPPED', 'o piloto parado não entrega nem para a via certa');
      assert.equal((await deps.health.last()), null, 'a saúde não foi marcada');
      assert.equal((await deps.queue.counts()).leased, 0);
    }
  });

  test('claude e codex puxam normalmente com o piloto ativo', async () => {
    await dispatch({ idempotencyKey: 'ok-c' });
    await dispatch({ kind: 'fact_check', idempotencyKey: 'ok-f' });
    assert.equal((await pull('claude'))?.kind, 'classification');
    assert.equal((await pull('codex'))?.kind, 'fact_check');
    assert.equal(await state.get(), null);
  });

  test('checagem e revisão só na codex, SEM reserva: no limite a tarefa fica pendente (nextAccount null) e só a codex a retoma depois da janela; nunca claude', async () => {
    for (const kind of ['fact_check', 'editorial_review']) {
      const stage = kind === 'fact_check' ? 'factcheck' : 'review';
      await dispatch({ kind, idempotencyKey: `lim-${kind}` });
      const a = (await pull('codex'))!;
      const r = ok<CallbackResult>(await callback(a, {
        outcome: 'failed', usage: free(a, 'codex', 'gpt-5.1-codex'),
        trace: trace(stage, 'codex', { reviewedDraftTaskId: 'task-rascunho-1', limit: { message: 'limite da codex', at: iso(), resumeAt: iso(600_000) } }),
      }));
      assert.equal(r.nextAccount, null, kind);
      assert.equal(await pull('claude', [kind]), undefined, `${kind}: a claude não herda a checagem`);
      assert.equal(await pull('codex', [kind]), undefined, `${kind}: ainda dentro da janela`);
      tick(601_000);
      const b = (await pull('codex', [kind]))!;
      assert.deepEqual([b.id === a.id, b.attempt, b.account], [true, 2, 'codex'], kind);
      ok(await callback(b, { outcome: 'completed', resultRef: `res-${b.id}-a2`, usage: free(b, 'codex', 'gpt-5.1-codex'), trace: trace(stage, 'codex', { reviewedDraftTaskId: 'task-rascunho-1' }) }));
    }
    assert.equal(await state.get(), null, 'o limite não é violação: o piloto não parou');
  });

  test('allowedAccounts pode ESTREITAR (só claude): a checagem, que é do codex, não tem via e é recusada', async () => {
    deps = { ...deps, pilot: { ...deps.pilot!, allowedAccounts: ['claude'] } };
    assert.equal(await routeOf('fact_check', { idempotencyKey: 'n' }), 'ROUTE_INVALID');
    assert.deepEqual(await routeOf('classification', { idempotencyKey: 'm' }), ['claude']);
  });

  test('sem piloto, nada muda: as rotas padrão continuam com opencode e antigravity (a restrição é só do piloto)', async () => {
    deps = { ...deps, pilot: { ...deps.pilot!, enabled: false } };
    assert.deepEqual(await routeOf('classification', { idempotencyKey: 'z' }), ['opencode', 'claude', 'antigravity']);
  });

  test('gateway no piloto: a checagem vai só ao codex (sem antigravity), a pauta só ao claude; o limite do codex ESPERA (não há via de reserva)', async () => {
    const io = { putInput: async () => undefined, getResult: async () => null };
    const gw = new OpenBotModelGateway({
      deps, io, caller: ADMIN, timeoutMs: 10, pollMs: 1,
      profiles: { triage: 'a', context: 'a', draft: 'a', factcheck: 'a', review: 'a', social_pack: 'a', roles: 'a' },
    });
    const req = (taskClass: 'factcheck' | 'triage', idempotencyKey: string) => ({
      taskClass, route: taskClass, workflow: 'WF02', idempotencyKey, promptVersion: 'p', dataClass: 'public' as const, excludeProviders: [] as string[], input: {},
    });
    await gw.invoke(req('factcheck', 'g1'));
    await gw.invoke(req('triage', 'g2'));
    const claimed = async (account: 'codex' | 'claude' | 'antigravity') => deps.queue.claim({ workerId: 'w', now: clock, leaseMs: 60_000, limit: 5, account });
    const [byCodex, byClaude, byAntigravity] = [await claimed('codex'), await claimed('claude'), await claimed('antigravity')];
    assert.deepEqual([byCodex.map((t) => t.kind), byClaude.map((t) => t.kind), byAntigravity], [['fact_check'], ['classification'], []]);
    assert.deepEqual([(await deps.queue.get(byCodex[0]!.id))?.route, (await deps.queue.get(byClaude[0]!.id))?.route], [['codex'], ['claude']]);
  });
});

describe('a linha do piloto agrupa as etapas pela MATÉRIA (trace.articleId)', () => {
  test('article_id vem do trace.articleId; sem ele cai no refId; checagem e rascunho da mesma matéria entram na mesma verificação de independência', async () => {
    await dispatch({ kind: 'editorial_draft', refId: 'gw-d', idempotencyKey: 'k-d', route: ['claude'] });
    const d = (await pull('claude'))!;
    ok(await callback(d, { outcome: 'completed', resultRef: `res-${d.id}-a1`, usage: free(d, 'claude', 'claude-sonnet-5-5'), trace: trace('draft', 'claude', { articleId: 'art-1' }) }));
    await dispatch({ kind: 'fact_check', refId: 'gw-f', idempotencyKey: 'k-f' });
    const f = (await pull('codex'))!;
    ok(await callback(f, { outcome: 'completed', resultRef: `res-${f.id}-a1`, usage: free(f, 'codex', 'gpt-5.1-codex'), trace: trace('factcheck', 'codex', { articleId: 'art-1', reviewedDraftTaskId: d.id }) }));
    const all = await rows.all();
    assert.deepEqual(all.map((r) => r.article_id), ['art-1', 'art-1']);
    const rep = adapterReport(all);
    assert.deepEqual([rep.articles, rep.independence.checked, rep.independence.independent, rep.independence.violations], [1, 1, 1, []]);
    await dispatch({ kind: 'classification', refId: 'gw-sem', idempotencyKey: 'k-s', route: ['claude'] });
    const s2 = (await pull('claude'))!;
    ok(await callback(s2, { outcome: 'completed', resultRef: `res-${s2.id}-a1`, usage: free(s2, 'claude', 'claude-haiku-5-5'), trace: trace('triage', 'claude') }));
    assert.equal((await rows.all()).at(-1)!.article_id, 'gw-sem');
  });
});

describe('linha concluída que ainda espera o veredito da Editorial não para o piloto', () => {
  // gate com a regra REAL do AgentOps (validatePilotRow): checagem/revisão concluída exige gate_verdict e reviewed_draft_task_id
  const strictGate: PilotGate = (rows) => {
    const reasons = rows.flatMap((r, i) => (['factcheck', 'review', 'check_edit'].includes(r.stage) && r.outcome === 'completed' && !r.gate_verdict ? [`linha ${i + 1} inválida: ${r.stage} concluído exige gate_verdict`] : []));
    return { allowed: reasons.length === 0, reasons };
  };

  test('o callback da checagem grava a linha sem veredito; o pull e o despacho seguintes continuam (nada de parada); depois do patch a linha entra no gate', async () => {
    gateImpl = strictGate;
    await dispatch({ kind: 'fact_check', idempotencyKey: 'fc-1' });
    const a = (await pull('codex'))!;
    const r = ok<CallbackResult>(await callback(a, {
      outcome: 'completed', resultRef: `res-${a.id}-a1`, usage: free(a, 'codex', 'gpt-5.1-codex'),
      trace: trace('factcheck', 'codex', { reviewedDraftTaskId: 'task-rascunho-1', promptVersion: 'editorial-0.3', outputValid: true }),
    }));
    assert.equal(r.pilotStopped, undefined);
    const [row] = await rows.all();
    assert.equal(awaitingEditorialGate(row!), true, 'a linha espera o veredito');
    assert.equal(await state.get(), null);
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'fc-2' })); // o despacho seguinte NÃO é bloqueado
    assert.equal(await state.get(), null);
    await rows.patch(row!.task_id, row!.attempt, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true, unsupported_facts: 0 });
    assert.equal(awaitingEditorialGate((await rows.all())[0]!), false);
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'fc-3' })); // linha completa e válida: segue
  });

  test('a espera NÃO esconde paradas: segredo no texto da mesma linha para o piloto no callback, e linha de triagem concluída nunca "espera"', async () => {
    gateImpl = strictGate;
    assert.equal(awaitingEditorialGate({ stage: 'triage', outcome: 'completed', gate_verdict: undefined }), false);
    assert.equal(awaitingEditorialGate({ stage: 'review', outcome: 'failed', gate_verdict: undefined }), false);
    await dispatch({ kind: 'fact_check', idempotencyKey: 'fc-9' });
    const a = (await pull('codex'))!;
    const r = ok<CallbackResult>(await callback(a, {
      outcome: 'completed', resultRef: `res-${a.id}-a1`, usage: free(a, 'codex', 'gpt-5.1-codex'),
      trace: trace('factcheck', 'codex', { reviewedDraftTaskId: 'task-rascunho-1', notes: `chave ${'sk-' + 'A'.repeat(32)}` }),
    }));
    assert.deepEqual(r.pilotStopped, [STOP.secret]);
    assert.equal((await handlePull(deps, signed({ workerId: 'w', account: 'codex' }))).status, 423);
  });
});

describe('critério 3 do PM: o patch do veredito falha 2 vezes seguidas e o piloto PARA (423 PILOT_STOPPED)', () => {
  // gate estrito (linha concluída de checagem/revisão sem veredito é inválida) e a regra do AgentOps para a sequência (verdictStreakReasons, limite 2)
  const strictGate: PilotGate = (rows) => {
    const reasons = rows.flatMap((r, i) => (['factcheck', 'review', 'check_edit'].includes(r.stage) && r.outcome === 'completed' && !r.gate_verdict ? [`linha ${i + 1} inválida: ${r.stage} concluído exige gate_verdict`] : []));
    return { allowed: reasons.length === 0, reasons };
  };
  const streakOf = (rows: readonly PilotRow[]): string[] => {
    const ind = rows.filter((r) => ['factcheck', 'review', 'check_edit'].includes(r.stage) && r.outcome === 'completed').sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    let run = 0;
    let best = 0;
    for (const r of ind) {
      run = r.gate_verdict ? 0 : run + 1;
      best = Math.max(best, run);
    }
    return best >= 2 ? [`patch do veredito falhou ${best} vezes seguidas (parada conservadora do PM)`] : [];
  };
  let streakInput: PilotRow[][];
  let gateInput: PilotRow[][];
  beforeEach(() => {
    streakInput = [];
    gateInput = [];
    gateImpl = (r) => { gateInput.push([...r]); return strictGate(r); };
    deps.pilot = { ...deps.pilot!, verdictStreak: (r) => { streakInput.push([...r]); return streakOf(r); } };
  });
  /** Uma checagem concluída pelo codex, SEM o patch da Editorial (a linha fica esperando o veredito). */
  async function factcheckDone(key: string) {
    tick(60_000);
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: key }));
    const a = (await pull('codex'))!;
    ok<CallbackResult>(await callback(a, {
      outcome: 'completed', resultRef: `res-${a.id}-a1`, usage: free(a, 'codex', 'gpt-5.1-codex'),
      trace: trace('factcheck', 'codex', { reviewedDraftTaskId: 'task-rascunho-1', promptVersion: 'editorial-0.3', outputValid: true }),
    }));
  }
  const patchAll = async () => {
    for (const r of await rows.all()) if (r.gate_verdict === undefined) await rows.patch(r.task_id, r.attempt, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true, unsupported_facts: 0 });
  };

  test('UMA linha esperando o veredito não para; DUAS seguidas param o despacho e o pull com 423 PILOT_STOPPED, e a parada fica gravada com o motivo', async () => {
    await factcheckDone('v-1');
    assert.equal(await state.get(), null);
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'v-2' })); // com 1 linha esperando, o despacho segue
    const a = (await pull('codex'))!;
    ok<CallbackResult>(await callback(a, {
      outcome: 'completed', resultRef: `res-${a.id}-a1`, usage: free(a, 'codex', 'gpt-5.1-codex'),
      trace: trace('factcheck', 'codex', { reviewedDraftTaskId: 'task-rascunho-1', promptVersion: 'editorial-0.3', outputValid: true }),
    }));
    assert.equal((await rows.all()).filter((r) => r.gate_verdict === undefined).length, 2);
    const blocked = await dispatch({ kind: 'fact_check', idempotencyKey: 'v-3' });
    assert.equal(blocked.status, 423);
    assert.equal(code(blocked.body), 'PILOT_STOPPED');
    assert.match(String((await state.get())?.reasons.join(' ')), new RegExp(STOP.verdictStreak));
    assert.equal((await handlePull(deps, signed({ workerId: 'w', account: 'codex' }))).status, 423);
    assert.equal(code((await handlePull(deps, signed({ workerId: 'w', account: 'claude' }))).body), 'PILOT_STOPPED');
  });

  test('o critério recebe TODAS as linhas (inclusive as que esperam o veredito) e o gate continua recebendo só as que não esperam', async () => {
    await factcheckDone('w-1');
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'w-2' }));
    assert.equal(streakInput.at(-1)!.length, 1);
    assert.equal(awaitingEditorialGate(streakInput.at(-1)![0]!), true, 'a linha que espera o veredito chegou ao critério');
    assert.equal(gateInput.at(-1)!.length, 0, 'o gate não vê a linha que espera');
  });

  test('o veredito entre duas falhas zera a sequência: falha, patch, falha não para', async () => {
    await factcheckDone('z-1');
    await patchAll();
    await factcheckDone('z-2');
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'z-3' }));
    assert.equal(await state.get(), null);
  });

  test('depois da parada, a retomada só vale com os vereditos gravados (patch) e o piloto volta a despachar', async () => {
    await factcheckDone('r-1');
    await factcheckDone('r-2');
    assert.equal((await dispatch({ kind: 'fact_check', idempotencyKey: 'r-3' })).status, 423);
    assert.equal(code((await resumePilot(deps, ADMIN)).body), 'PILOT_STILL_INVALID'); // as 2 linhas seguem sem veredito
    await patchAll();
    assert.deepEqual(ok(await resumePilot(deps, ADMIN)), { resumed: true });
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 'r-4' }));
  });

  test('sem a porta `verdictStreak` o critério não é avaliado (compatibilidade dos testes antigos); a ligação real a exige (rotas e Fábrica)', async () => {
    deps.pilot = { ...deps.pilot!, verdictStreak: undefined };
    gateImpl = (r) => ({ allowed: true, reasons: r.length ? [] : [] });
    await factcheckDone('s-1');
    await factcheckDone('s-2');
    ok(await dispatch({ kind: 'fact_check', idempotencyKey: 's-3' }));
    assert.equal(await state.get(), null);
  });
});
