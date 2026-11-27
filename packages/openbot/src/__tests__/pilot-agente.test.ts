// DP-71: o agente da linha do piloto vem SÓ do servidor, do lease que a fila validou. A trilha do agente não o escolhe.
import { describe, expect, it } from 'vitest';
import {
  dispatchTask, handleCallback, handlePull, InMemoryCallbackStore, InMemoryCostLedger, InMemoryHealthStore, InMemoryLeaseQueue, InMemoryPilotRowStore, InMemoryPilotState,
  OPENBOT_PERMISSIONS, pilotCsv, PILOT_CSV_COLUMNS, signBody, type OpenBotDeps, type PullResult,
} from '../index';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const SECRET = 'segredo-de-teste-agente';

function mundo() {
  const rows = new InMemoryPilotRowStore();
  const deps: OpenBotDeps = {
    queue: new InMemoryLeaseQueue(), ledger: new InMemoryCostLedger(), health: new InMemoryHealthStore(), callbacks: new InMemoryCallbackStore(),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW,
    pilot: { enabled: true, rows, state: new InMemoryPilotState(), gate: () => ({ allowed: true, reasons: [] }) },
  };
  const sign = (o: unknown) => { const body = JSON.stringify(o); return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() }; };
  return { deps, rows, sign };
}

async function executar(outcome: 'completed' | 'failed', trilhaExtra: Record<string, unknown> = {}, retryable = true) {
  const m = mundo();
  const d = await dispatchTask(m.deps, { id: 'fabrica', permissions: [OPENBOT_PERMISSIONS.dispatch] }, {
    kind: 'fact_check', profileId: 'ln_pilot_checador', refId: 'gw-1', idempotencyKey: 'k-1', dataClass: 'public', maxCostMicro: 1_000, route: ['opencode'],
  });
  expect(d.status).toBeLessThan(400);
  const [t] = ((await handlePull(m.deps, m.sign({ workerId: 'openbot-opencode-checagem', account: 'opencode' }))).body as PullResult).tasks;
  const r = await handleCallback(m.deps, m.sign({
    callbackId: 'cb-1', taskId: t!.id, leaseId: t!.leaseId, outcome, ...(outcome === 'completed' ? { resultRef: 'res-1' } : { error: 'falhou', retryable }),
    usage: { executionId: 'ex-1', taskId: t!.id, leaseId: t!.leaseId, model: 'opencode-go/deepseek-v4-pro', lane: 'opencode', account: 'opencode', costMicro: 0 },
    trace: { stage: 'factcheck', account: 'opencode', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), reviewedDraftTaskId: 'task-redacao', ...trilhaExtra },
  }));
  return { status: r.status, linhas: await m.rows.all() };
}

describe('linha do piloto: agente gravado pelo servidor a partir do lease', () => {
  it('conclusão: a linha leva o workerId de quem puxou a tarefa, e ele sai na planilha', async () => {
    const r = await executar('completed');
    expect(r.status).toBe(200);
    expect(r.linhas.map((l) => l.worker_id)).toEqual(['openbot-opencode-checagem']);
    expect(PILOT_CSV_COLUMNS.at(-1)).toBe('worker_id');
    expect(pilotCsv(r.linhas).trim().split('\n')[1]!.endsWith(',openbot-opencode-checagem')).toBe(true);
  });

  it('o que o agente disser na trilha (worker_id, workerId, agent) não vale', async () => {
    const r = await executar('completed', { worker_id: 'forjado', workerId: 'forjado', agent: 'forjado' });
    for (const l of r.linhas) expect(l.worker_id).toBe('openbot-opencode-checagem');
    expect(JSON.stringify(r.linhas)).not.toContain('forjado');
  });

  it.each([true, false])('falha (retryable=%s): a fila solta o lease, e a linha ainda diz quem executou', async (retryable) => {
    const r = await executar('failed', {}, retryable);
    expect(r.status).toBe(200);
    expect(r.linhas.map((l) => [l.worker_id, l.outcome === 'completed'])).toEqual([['openbot-opencode-checagem', false]]);
  });
});
