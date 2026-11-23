import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '@ln/auth';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import type { NewTask, PilotRow } from '@ln/openbot';
import { leaseQueueConformanceCases } from '@ln/openbot/testing';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from './openbot-pg';

const NOW = new Date('2026-11-23T12:00:00Z');
const task = (n: number, over: Partial<NewTask> = {}): NewTask => ({
  kind: 'editorial_draft', profileId: 'writer_pontos', refId: `art-${n}`, idempotencyKey: `idem-${n}`, dataClass: 'public', maxCostMicro: 1_000_000, ...over,
});
const usage = (id: string, over: Record<string, unknown> = {}) => ({
  executionId: `exec-${id}`, taskId: id, leaseId: 'l1', model: 'm', generationIds: ['g1'], promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 1000, ...over,
});

// A fila PostgreSQL passa INTEIRA a suíte de conformidade da Integration (a mesma da fila em memória): dedupe, lease, claim em paralelo sem
// duplicar, filtro por via, troca de via no limite sem consumir tentativa, redação que nunca troca, espera da janela, dead/failed.
describe('PgLeaseQueue: conformidade com o contrato do @ln/openbot', () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of closers) await c();
  });
  const make = async () => {
    const t = await createTestDb();
    closers.push(t.close);
    return new PgLeaseQueue(t.db as unknown as Db);
  };
  for (const c of leaseQueueConformanceCases(make)) it(c.name, c.run, 60_000);
});

describe('stores do OpenBot no PostgreSQL', () => {
  it('custos: faixa gratuita sem tokens nem geração (tokens ausentes ficam ausentes, nunca zero), dedupe por executionId, estouro do teto da tarefa e soma só do mês corrente', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const q = new PgLeaseQueue(db);
      const a = (await q.enqueue(task(1, { maxCostMicro: 500 }), NOW)).task;
      const b = (await q.enqueue(task(2), NOW)).task;
      const c = (await q.enqueue(task(3), NOW)).task;
      const ledger = new PgCostLedger(db, () => NOW);
      expect((await ledger.record(usage(a.id) as never, a.maxCostMicro, NOW))).toMatchObject({ recorded: true, entry: { overrun: true, costMicro: 1000, lane: 'api' } });
      expect((await ledger.record(usage(a.id, { costMicro: 9999 }) as never, a.maxCostMicro, NOW))).toMatchObject({ recorded: false, entry: { costMicro: 1000 } });
      await ledger.record(usage(b.id, { costMicro: 2000 }) as never, b.maxCostMicro, new Date('2026-10-15T12:00:00Z')); // mês anterior
      expect(await ledger.totalMicro()).toBe(1000);
      const livre = await ledger.record({ lane: 'subscription', account: 'claude', executionId: 'exec-livre', taskId: c.id, leaseId: 'l', model: 'claude-sonnet', costMicro: 0 }, c.maxCostMicro, NOW);
      expect(livre.entry).toMatchObject({ lane: 'subscription', account: 'claude', costMicro: 0, overrun: false });
      expect(livre.entry.promptTokens).toBeUndefined(); // não medido: ausente
      expect(livre.entry.generationIds).toBeUndefined();
      expect((await ledger.entries()).map((e) => e.executionId).sort()).toEqual([`exec-${a.id}`, 'exec-livre'].sort()); // mesma hora de registro: ordem estável por executionId
      // o banco recusa faixa gratuita com custo e conta/faixa desconhecidas
      await expect(db.execute(sql`UPDATE openbot_cost_entries SET cost_micro = 5 WHERE execution_id = 'exec-livre'`)).rejects.toBeDefined();
      await expect(ledger.record({ lane: 'opencode', account: 'opencode', executionId: 'x1', taskId: c.id, leaseId: 'l', model: 'm', costMicro: 7 }, 1, NOW)).rejects.toBeDefined();
    } finally {
      await t.close();
    }
  });

  it('callbackId: só o primeiro vê como novo; saúde: último pull sobrescreve a linha única', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const cb = new PgCallbackStore(db);
      expect([await cb.firstSeen('c1', NOW), await cb.firstSeen('c1', NOW), await cb.firstSeen('c2', NOW)]).toEqual([true, false, true]);
      const h = new PgHealthStore(db);
      expect(await h.last()).toBeNull();
      await h.markPull('w1', NOW);
      await h.markPull('w2', new Date(NOW.getTime() + 1000));
      expect(await h.last()).toEqual({ workerId: 'w2', at: '2026-11-23T12:00:01.000Z' });
    } finally {
      await t.close();
    }
  });

  const linha = (over: Partial<PilotRow> = {}): PilotRow => ({
    task_id: 't1', kind: 'editorial_draft', article_id: 'a1', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet', prompt_version: 'editorial-0.2',
    started_at: '2026-11-23T12:00:00.000Z', ended_at: '2026-11-23T12:05:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 1200, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  });

  it('trilha do piloto: upsert por (task_id, attempt), patch preserva o resto e só mexe em linha existente, all em ordem de início', async () => {
    const t = await createTestDb();
    try {
      const rows = new PgPilotRowStore(t.db as unknown as Db, () => NOW);
      await rows.upsert(linha({ task_id: 't2', started_at: '2026-11-23T13:00:00.000Z' }));
      await rows.upsert(linha());
      await rows.upsert(linha({ attempt: 2, outcome: 'pending_limit', limit_message: 'limite', limit_at: '2026-11-23T12:10:00.000Z', started_at: '2026-11-23T12:06:00.000Z' }));
      expect((await rows.all()).map((r) => `${r.task_id}#${r.attempt}`)).toEqual(['t1#1', 't1#2', 't2#1']);
      await rows.upsert(linha({ outcome: 'failed' })); // mesma chave: substitui
      expect((await rows.all())[0]).toMatchObject({ outcome: 'failed' });
      expect(await rows.patch('t1', 1, { gate_verdict: 'approved', unsupported_facts: 0, task_id: 'outra', attempt: 9 })).toBe(true);
      const p = (await rows.all())[0]!;
      expect(p).toMatchObject({ task_id: 't1', attempt: 1, gate_verdict: 'approved', unsupported_facts: 0, outcome: 'failed', declared_model: 'claude-sonnet' });
      expect(await rows.patch('nao-existe', 1, { notes: 'x' })).toBe(false);
      await expect(t.db.execute(sql`INSERT INTO openbot_pilot_rows (task_id, attempt, stage, account, outcome, started_at, row, updated_at) VALUES ('z', 1, 'draft', 'claude', 'inventado', now(), '{}', now())`)).rejects.toBeDefined();
    } finally {
      await t.close();
    }
  });

  it('estado do piloto: parada acumula motivos sem repetir, guarda o instante do primeiro, e clear libera', async () => {
    const t = await createTestDb();
    try {
      const st = new PgPilotStateStore(t.db as unknown as Db);
      expect(await st.get()).toBeNull();
      await st.stop('api_tarifada', '2026-11-23T12:00:00.000Z');
      await st.stop('segredo_em_texto', '2026-11-23T12:30:00.000Z');
      await st.stop('api_tarifada', '2026-11-23T12:40:00.000Z');
      expect(await st.get()).toEqual({ reasons: ['api_tarifada', 'segredo_em_texto'], at: '2026-11-23T12:00:00.000Z' });
      await st.clear();
      expect(await st.get()).toBeNull();
    } finally {
      await t.close();
    }
  });

  // Só no PostgreSQL REAL (LN_TEST_PG_URL): conexões simultâneas de verdade disputando as mesmas linhas.
  it.skipIf(!isRealTestDb())('FOR UPDATE SKIP LOCKED: 6 pulls simultâneos sobre 30 tarefas entregam cada tarefa a UM só detentor', async () => {
    const t = await createTestDb();
    try {
      const q = new PgLeaseQueue(t.db as unknown as Db);
      for (let i = 1; i <= 30; i++) await q.enqueue(task(i), NOW);
      const claims = await Promise.all(Array.from({ length: 6 }, (_, w) => q.claim({ workerId: `w${w}`, now: NOW, leaseMs: 60_000, limit: 10 })));
      const ids = claims.flat().map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length); // nenhuma tarefa entregue duas vezes na rodada simultânea
      // SKIP LOCKED pula linha travada por outro, então a rodada pode deixar sobra: uma rodada sequencial recolhe o resto, sem repetir ninguém
      const sobra = await q.claim({ workerId: 'w-final', now: NOW, leaseMs: 60_000, limit: 30 });
      const todos = [...ids, ...sobra.map((x) => x.id)];
      expect(new Set(todos).size).toBe(30);
      expect(todos).toHaveLength(30);
      expect((await q.counts()).leased).toBe(30);
    } finally {
      await t.close();
    }
  }, 30_000);
});

describe('PgTaskIo: meta.articleId (DP-41: a planilha do piloto agrupa as etapas pela matéria)', () => {
  it('guarda e devolve articleId e reviewedDraftTaskId, juntos ou separados; sem nenhum dos dois o meta é nulo', async () => {
    const t = await createTestDb();
    try {
      const io = new PgTaskIo(t.db as unknown as Db, () => NOW);
      await io.putInput('gw-a', { x: 1 }, { taskClass: 'draft', promptVersion: 'p', articleId: 'art-1' });
      await io.putInput('gw-b', { x: 1 }, { taskClass: 'factcheck', promptVersion: 'p', reviewedDraftTaskId: 'task-d1', articleId: 'art-1' });
      await io.putInput('gw-c', { x: 1 }, { taskClass: 'factcheck', promptVersion: 'p', reviewedDraftTaskId: 'task-d1' });
      await io.putInput('gw-d', { x: 1 }, { taskClass: 'draft', promptVersion: 'p' });
      expect((await io.getInputFor('gw-a'))!.meta).toEqual({ articleId: 'art-1' });
      expect((await io.getInputFor('gw-b'))!.meta).toEqual({ reviewedDraftTaskId: 'task-d1', articleId: 'art-1' });
      expect((await io.getInputFor('gw-c'))!.meta).toEqual({ reviewedDraftTaskId: 'task-d1' });
      expect((await io.getInputFor('gw-d'))!.meta).toBeNull();
    } finally {
      await t.close();
    }
  });
});
