import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionItem, MeetingRun } from '@ln/contracts';
import { createTestDb } from './testing';
import * as s from './schema';

let t: Awaited<ReturnType<typeof createTestDb>>;
const run = (over: Partial<typeof s.meetingRuns.$inferInsert> = {}) => ({
  id: randomUUID(), meetingId: 'D-mercado', localDate: '2026-12-01', scheduledFor: new Date('2026-12-01T09:00:00Z'),
  executedAt: new Date('2026-12-01T09:01:00Z'), status: 'completed', route: 'economy', chair: 'editor_mercado', quorumMinimum: 2, ...over,
});
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('organização agêntica (0004_agentic_org)', () => {
  it('uma execução por ritual, data e instância (idempotência)', async () => {
    await t.db.insert(s.meetingRuns).values(run());
    await expect(t.db.insert(s.meetingRuns).values(run())).rejects.toThrow();
    await t.db.insert(s.meetingRuns).values(run({ meetingId: 'X-incident', instance: 'inc-1' }));
  });

  it('status_only exige motivo, e só ele', async () => {
    await expect(t.db.insert(s.meetingRuns).values(run({ localDate: '2026-12-02', status: 'status_only' }))).rejects.toThrow();
    await t.db.insert(s.meetingRuns).values(run({ localDate: '2026-12-02', status: 'status_only', reason: 'recovery_window_expired' }));
  });

  it('tarefa concluída exige data e evidência', async () => {
    const r = run({ localDate: '2026-12-03' });
    await t.db.insert(s.meetingRuns).values(r);
    const d = { id: randomUUID(), runId: r.id, text: 'Decisão', proposedBy: 'editor_mercado', authority: 'automatica', status: 'approved' };
    await t.db.insert(s.meetingDecisions).values(d);
    const a = { id: randomUUID(), decisionId: d.id, runId: r.id, title: 'Tarefa', ownerAgentId: 'writer_mercado', dueDate: '2026-12-05', createdAt: new Date() };
    await expect(t.db.insert(s.actionItems).values({ ...a, status: 'done' })).rejects.toThrow();
    await t.db.insert(s.actionItems).values({ ...a, status: 'done', closedAt: new Date(), evidenceRef: 'ev-1' });
  });

  it('memória setorial só nas dez editorias', async () => {
    const m = { id: randomUUID(), kind: 'glossary', key: 'k', version: 1, content: {}, authorAgentId: 'editor_mercado', createdAt: new Date() };
    await t.db.insert(s.sectorMemory).values({ ...m, editoria: 'mercado' });
    await expect(t.db.insert(s.sectorMemory).values({ ...m, id: randomUUID(), editoria: 'esportes' })).rejects.toThrow();
  });

  it('contratos espelham as regras do banco', () => {
    expect(MeetingRun.safeParse({ ...run(), id: randomUUID(), scheduledFor: '2026-12-01T09:00:00Z', executedAt: '2026-12-01T09:01:00Z', instance: '', reason: null, delayMinutes: 0, modelCalls: 0, recovered: false, participantsPresent: [], participantsAbsent: [] }).success).toBe(true);
    const a = { id: randomUUID(), decisionId: randomUUID(), runId: randomUUID(), title: 'T', ownerAgentId: 'x', dueDate: '2026-12-05', status: 'done', createdAt: '2026-12-01T09:00:00Z', closedAt: null, evidenceRef: null };
    expect(ActionItem.safeParse(a).success).toBe(false);
  });
});
