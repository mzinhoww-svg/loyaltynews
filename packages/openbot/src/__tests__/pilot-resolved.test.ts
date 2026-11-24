import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ApiError } from '@ln/contracts';
import {
  gateRows, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore, InMemoryLeaseQueue, InMemoryPilotRowStore, InMemoryPilotState, OPENBOT_PERMISSIONS,
  PILOT_PERMISSIONS, pilotRowKey, resumePilot, signBody, STOP, type Caller, type OpenBotDeps, type PilotGate, type PilotRow,
} from '../index';

// Decisão PM-2026-11-23-D: uma violação TRATADA por um admin libera o portão de despacho e a retomada, mas a linha continua gravada (nada é apagado nem editado).
const SECRET = 'segredo-de-teste-resolvidas';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const ADMIN: Caller = { id: 'admin-1', permissions: [OPENBOT_PERMISSIONS.dispatch, OPENBOT_PERMISSIONS.read, PILOT_PERMISSIONS.admin] };
const code = (b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? (b as ApiError).error.code : undefined);
const row = (over: Partial<PilotRow> = {}): PilotRow => ({
  task_id: 't1', kind: 'editorial_draft', article_id: 'a1', source_id: 's', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'p',
  started_at: '2026-11-23T12:00:00.000Z', ended_at: '2026-11-23T12:01:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 100, tokens_measured: false,
  published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
});
/** Mesma semântica de paradas do `canDispatchNext` do AgentOps. */
const gate: PilotGate = (rows) => {
  const reasons = rows.flatMap((r) => [
    ...(r.published_attempt ? [`${r.task_id}: tentativa de publicar`] : []), ...(r.tarifada_api_call ? [`${r.task_id}: API tarifada`] : []),
    ...(r.secret_in_log ? [`${r.task_id}: segredo em log`] : []), ...(r.tool_outside_contract ? [`${r.task_id}: ferramenta fora do contrato`] : []),
  ]);
  return { allowed: reasons.length === 0, reasons };
};
const signed = (obj: unknown) => {
  const body = JSON.stringify(obj);
  return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() };
};
function make(resolved: Set<string> | null) {
  const rows = new InMemoryPilotRowStore();
  const state = new InMemoryPilotState();
  const deps: OpenBotDeps = {
    queue: new InMemoryLeaseQueue(() => 'lease-1'), ledger: new InMemoryCostLedger(), health: new InMemoryHealthStore(), callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW,
    pilot: { enabled: true, rows, state, gate, ...(resolved ? { resolved: async () => resolved } : {}) },
  };
  return { deps, rows, state };
}

describe('piloto: violação tratada por um admin', () => {
  test('gateRows tira só as linhas resolvidas (task_id#attempt); sem `resolved` devolve todas; a store continua com TODAS', async () => {
    const { deps, rows } = make(new Set([pilotRowKey({ task_id: 'violation-1', attempt: 1 })]));
    await rows.upsert(row({ task_id: 'violation-1', secret_in_log: true }));
    await rows.upsert(row({ task_id: 't2' }));
    assert.deepEqual((await gateRows(deps.pilot!)).map((r) => r.task_id), ['t2']);
    assert.equal((await rows.all()).length, 2); // nada apagado
    const { deps: d2, rows: r2 } = make(null);
    await r2.upsert(row({ task_id: 'violation-1', secret_in_log: true }));
    assert.deepEqual((await gateRows(d2.pilot!)).map((r) => r.task_id), ['violation-1']);
    // a tentativa é parte da chave: resolver a tentativa 1 não resolve a 2
    const { deps: d3, rows: r3 } = make(new Set(['t9#1']));
    await r3.upsert(row({ task_id: 't9', attempt: 1, tarifada_api_call: true }));
    await r3.upsert(row({ task_id: 't9', attempt: 2, tarifada_api_call: true }));
    assert.deepEqual((await gateRows(d3.pilot!)).map((r) => `${r.task_id}#${r.attempt}`), ['t9#2']);
  });

  test('retomada: com a violação NÃO tratada o gate recusa (409 PILOT_STILL_INVALID); tratada, retoma e limpa a parada; a linha continua', async () => {
    const naoTratada = make(new Set());
    await naoTratada.rows.upsert(row({ task_id: 'violation-1', secret_in_log: true }));
    await naoTratada.state.stop(STOP.secret, NOW.toISOString());
    const r1 = await resumePilot(naoTratada.deps, ADMIN);
    assert.equal(r1.status, 409);
    assert.equal(code(r1.body), 'PILOT_STILL_INVALID');
    assert.ok(await naoTratada.state.get());

    const tratada = make(new Set(['violation-1#1']));
    await tratada.rows.upsert(row({ task_id: 'violation-1', secret_in_log: true }));
    await tratada.state.stop(STOP.secret, NOW.toISOString());
    const r2 = await resumePilot(tratada.deps, ADMIN);
    assert.equal(r2.status, 200);
    assert.equal(await tratada.state.get(), null);
    assert.equal((await tratada.rows.all())[0]!.secret_in_log, true); // a violação segue na planilha
  });

  test('o portão de despacho (pull) ignora a violação tratada; uma NOVA violação continua parando o piloto', async () => {
    const { deps, rows, state } = make(new Set(['violation-1#1']));
    await rows.upsert(row({ task_id: 'violation-1', secret_in_log: true }));
    const livre = await handlePull(deps, signed({ workerId: 'w', account: 'claude' }));
    assert.notEqual(code(livre.body), 'PILOT_STOPPED');
    assert.equal(await state.get(), null);
    await rows.upsert(row({ task_id: 'violation-2', published_attempt: true })); // nova violação, não tratada
    const parado = await handlePull(deps, signed({ workerId: 'w', account: 'claude' }));
    assert.equal(code(parado.body), 'PILOT_STOPPED');
    assert.ok((await state.get())?.reasons.some((m) => m.includes('violation-2')));
  });
});
