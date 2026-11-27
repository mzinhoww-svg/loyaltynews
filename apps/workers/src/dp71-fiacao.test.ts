// DP-71 pela fila REAL (PostgreSQL de teste): o gateway do piloto devolve o agente que tinha o lease, e a fiação liga a independência por agente.
import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '@ln/auth';
import { createTestDb } from '@ln/db/testing';
import { handleCallback, handlePull, resultRefFor, signBody, type GatewayRequestLike, type OpenBotDeps, type PullResult } from '@ln/openbot';
import { createPilotWiring, pilotWiringImporter, type LoadAgentsKit } from './openbot-wiring';
import { loadPilotWiring, runEditorialAutoral, runEditorialFactory } from './editorial-factory';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from './openbot-pg';

const STAGING = { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1', LN_FLAGS_ON: 'openbotDispatch' } as const;
const SECRET = 'segredo-de-teste-dp71';
const NOW = new Date('2026-11-27T12:00:00.000Z');
const kit: LoadAgentsKit = async () => ({ canDispatchNext: () => ({ allowed: true, reasons: [] }), verdictStreakReasons: () => [], applyRowPatch: ((row: unknown) => ({ row, errors: [] })) as never });

const closers: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of closers) await c(); });
const fresh = async () => { const t = await createTestDb(); closers.push(t.close); return t.db as unknown as Db; };

function agentes(db: Db) {
  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db), ledger: new PgCostLedger(db, () => NOW), health: new PgHealthStore(db), callbacks: new PgCallbackStore(db),
    secrets: () => [SECRET], flags: () => ({ dispatchEnabled: true, kill: false }), now: () => NOW, requireDerivedResultRef: true,
    pilot: { enabled: true, rows: new PgPilotRowStore(db, () => NOW), state: new PgPilotStateStore(db), gate: () => ({ allowed: true, reasons: [] }) },
  };
  const io = new PgTaskIo(db, () => NOW);
  const sign = (o: unknown) => { const body = JSON.stringify(o); return { body, signature: signBody(SECRET, NOW.getTime(), body), timestampMs: NOW.getTime() }; };
  let n = 0;
  return async (workerId: string, stage: string) => {
    const [t] = ((await handlePull(deps, sign({ workerId, account: 'opencode' }))).body as PullResult).tasks;
    if (!t) return;
    await io.putResultFor(resultRefFor(t.id, t.attempt), t.id, { de: workerId });
    const usage = { executionId: `ex-${t.id}`, taskId: t.id, leaseId: t.leaseId, model: 'opencode-go/deepseek-v4-pro', lane: 'opencode' as const, account: 'opencode' as const, costMicro: 0 };
    await handleCallback(deps, sign({
      callbackId: `cb-${++n}-${t.id}`, taskId: t.id, leaseId: t.leaseId, outcome: 'completed', resultRef: resultRefFor(t.id, t.attempt), usage,
      trace: { stage, account: 'opencode', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), articleId: 'art-71', promptVersion: 'editorial-0.3' },
    }));
  };
}
const pedido = (taskClass: GatewayRequestLike['taskClass'], input: unknown = {}): GatewayRequestLike => ({
  taskClass, route: taskClass, workflow: 'WF02', idempotencyKey: `art-71:${taskClass}:1`, promptVersion: 'editorial-0.3', dataClass: 'public', excludeProviders: [], input,
});

describe('piloto: agente da tarefa e independência por agente (DP-71)', () => {
  it('o mesmo provedor com agentes diferentes devolve dois agentes distintos; o mesmo agente aparece como o mesmo', async () => {
    for (const [checador, iguais] of [['openbot-opencode-checagem', false], ['openbot-opencode-redacao', true]] as const) {
      const db = await fresh();
      const agente = agentes(db);
      const passos = [() => agente('openbot-opencode-redacao', 'draft'), () => agente(checador, 'factcheck')];
      const { gateway } = await createPilotWiring({ ...STAGING }, db, { loadKit: kit, now: () => NOW, sleep: async () => { await passos.shift()?.(); } });
      const draft = await gateway.invoke(pedido('draft'));
      if (!draft.ok) throw new Error(JSON.stringify(draft));
      const check = await gateway.invoke(pedido('factcheck', { reviewedDraftTaskId: draft.taskId }));
      if (!check.ok) throw new Error(JSON.stringify(check));
      expect([draft.provider, check.provider]).toEqual(['deepseek', 'deepseek']);
      expect([draft.agent, check.agent]).toEqual(['openbot-opencode-redacao', checador]);
      expect(draft.agent === check.agent).toBe(iguais);
      expect(check.taskId).not.toBe(draft.taskId);
    }
  });

  it('a fiação liga o modo por agente e o carregador da Fábrica o repassa; valor desconhecido não passa', async () => {
    const db = await fresh();
    const env = { ...STAGING } as Record<string, string>;
    const w = await loadPilotWiring(env, pilotWiringImporter(db, { loadKit: kit }));
    expect(w?.independence).toBe('agent');
    const gw = { invoke: async () => ({ ok: false as const, refusal: 'model_disabled' as const }) };
    for (const v of [undefined, 'provider', 'qualquer']) {
      const x = await loadPilotWiring(env, async () => ({ createPilotWiring: async () => ({ gateway: gw, independence: v }) }));
      expect(x && 'independence' in x, String(v)).toBe(false);
    }
  });

  it('independência por agente é recusada sem o gateway e a planilha do piloto (nunca no gateway tarifado)', async () => {
    const db = await fresh();
    const gw = { invoke: async () => ({ ok: false as const, refusal: 'model_disabled' as const }) };
    const sink = { patch: async () => undefined };
    const flags = { editorialCollector: true, editorialPipeline: true };
    await expect(runEditorialFactory({ db, flags, dryRun: false, independence: 'agent', gateway: {} as never })).rejects.toThrow(/só vale no piloto/);
    await expect(runEditorialFactory({ db, flags, dryRun: false, independence: 'agent', modelGateway: gw })).rejects.toThrow(/só vale no piloto/);
    await expect(runEditorialAutoral({ db, flags, independence: 'agent', gateway: {} as never, pilotSink: sink })).rejects.toThrow(/só vale no piloto|gateway/);
  });
});
