import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBrCalendar } from '../src/calendar';
import { loadRegistries } from '../src/config';
import { buildOrganization } from '../src/organization';
import { SectorMemoryService } from '../src/memory';
import { pgDbFromPool } from '../src/pg-adapter';
import { PgStore, type PgDb } from '../src/pg-store';
import { RitualScheduler, StoreInputCollector } from '../src/scheduler';

const sql = readFileSync(join(__dirname, '../sql/001_agentic_org.sql'), 'utf8');

async function makeDb(): Promise<PgDb> {
  const mem = newDb();
  mem.public.none(sql);
  const { Pool } = mem.adapters.createPg();
  return pgDbFromPool(new Pool() as never);
}

const reg = loadRegistries();
const org = buildOrganization(reg);
let store: PgStore;
beforeEach(async () => {
  store = new PgStore(await makeDb());
});

describe('PgStore sobre sql/001_agentic_org.sql (emulador pg-mem)', () => {
  it('memória setorial por editoria: versionada e isolada entre editorias', async () => {
    const mem = new SectorMemoryService(store, org);
    const v1 = await mem.write({ editoria: 'bancos', kind: 'glossary', key: 'cdb', content: { termo: 'CDB' }, author_agent_id: 'editor_bancos', source_refs: ['s1'] });
    const v2 = await mem.write({ editoria: 'bancos', kind: 'glossary', key: 'cdb', content: { termo: 'CDB v2' }, author_agent_id: 'writer_bancos' });
    await mem.write({ editoria: 'crm', kind: 'style', key: 'tom', content: 'direto', author_agent_id: 'director_editorial' });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await mem.read('bancos', 'cdb'))!.content).toEqual({ termo: 'CDB v2' });
    expect(await mem.history('bancos', 'cdb')).toHaveLength(2);
    expect(await mem.list('bancos')).toHaveLength(1);
    expect(await mem.list('crm')).toHaveLength(1);
    expect(await mem.read('crm', 'cdb')).toBeNull();
  });

  it('só editor, redator e diretor editorial da editoria escrevem; editoria/tipo inválidos falham', async () => {
    const mem = new SectorMemoryService(store, org);
    await expect(mem.write({ editoria: 'bancos', kind: 'style', key: 'k', content: 1, author_agent_id: 'writer_crm' })).rejects.toThrow(/não pode escrever/);
    await expect(mem.write({ editoria: 'bancos', kind: 'style', key: 'k', content: 1, author_agent_id: 'publisher' })).rejects.toThrow();
    await expect(mem.write({ editoria: 'esportes', kind: 'style', key: 'k', content: 1, author_agent_id: 'editor_bancos' })).rejects.toThrow();
    await expect(mem.write({ editoria: 'bancos', kind: 'nope' as never, key: 'k', content: 1, author_agent_id: 'editor_bancos' })).rejects.toThrow(/inválido/);
  });

  it('o banco recusa editoria fora da lista (CHECK)', async () => {
    await expect(store.appendMemory({ editoria: 'esportes' as never, kind: 'style', key: 'k', content: 1, source_refs: [], author_agent_id: 'x' })).rejects.toThrow();
  });

  it('ritual completo persistido: ata, decisões, tarefas; reexecução é idempotente', async () => {
    const date = '2026-11-19';
    await store.putInput('D-mercado', date, { agent_id: 'editor_mercado', summary: 'ok', blockers: [], evidence_refs: ['e1'], decisions: [{ text: 'Cobrir X', proposed_by: 'editor_mercado', needs_human_approval: false, evidence_refs: ['e1'], actions: [{ title: 'Apurar X', owner: 'writer_mercado', due_in_business_days: 2 }] }] });
    await store.putInput('D-mercado', date, { agent_id: 'writer_mercado', summary: 'ok', blockers: [], evidence_refs: [], decisions: [] });
    const s = new RitualScheduler({ registries: reg, calendar: createBrCalendar(), store, collector: new StoreInputCollector(store), lookbackDays: 0 });
    const now = new Date('2026-11-19T06:00:00-03:00');
    const t1 = await s.tick(now);
    expect(t1.errors).toEqual([]);
    await s.tick(new Date(now.getTime() + 60_000));
    const runs = await store.listRuns({ meetingId: 'D-mercado' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', local_date: date, model_calls: 0, chair: 'editor_mercado' });
    expect(runs[0]!.participants_present.sort()).toEqual(['editor_mercado', 'writer_mercado']);
    const minutes = await store.getMinutes(runs[0]!.id);
    expect(minutes!.summary).toMatch(/2\/2 presentes/);
    const decisions = await store.listDecisions(runs[0]!.id);
    expect(decisions).toHaveLength(1);
    const actions = await store.listActions({ ownerAgentId: 'writer_mercado' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ due_date: '2026-11-24', status: 'open', decision_id: decisions[0]!.id });
    // conclusão exige evidência também no banco (CHECK)
    await expect(store.updateAction(actions[0]!.id, { status: 'done' })).rejects.toThrow();
    const done = await store.updateAction(actions[0]!.id, { status: 'done', closed_at: now.toISOString(), evidence_ref: 'pr#1' });
    expect(done.status).toBe('done');
  });

  it('saveOutcome roda numa única transação: COMMIT no sucesso, ROLLBACK (sem COMMIT) na falha', async () => {
    // pg-mem não implementa ROLLBACK; a atomicidade real depende do PostgreSQL. Aqui se verifica que
    // todas as escritas passam pela MESMA conexão transacional e que o adaptador desfaz em erro.
    const log: string[] = [];
    let failOn: string | null = null;
    const client = {
      query: async (q: string) => {
        log.push(q.trim().split(/\s+/).slice(0, 3).join(' '));
        if (failOn && q.includes(failOn)) throw new Error('falha simulada');
        return { rows: [] };
      },
      release: () => log.push('release'),
    };
    const fake = pgDbFromPool({ query: async () => ({ rows: [] }), connect: async () => client });
    const run = { id: 'r1', meeting_id: 'D-x', local_date: '2026-11-23', instance: '', scheduled_for: '2026-11-23T09:00:00.000Z', executed_at: '2026-11-23T09:00:00.000Z', status: 'completed' as const, reason: null, route: 'economy', delay_minutes: 0, model_calls: 0, recovered: false, chair: 'a', participants_present: ['a'], participants_absent: [], quorum_minimum: 1 };
    const dec = { id: 'd1', run_id: 'r1', text: 't', proposed_by: 'a', authority: 'x', status: 'approved' as const, needs_human_approval: false, evidence_refs: [] };
    const act = { id: 'a1', decision_id: 'd1', run_id: 'r1', title: 't', owner_agent_id: 'a', due_date: '2026-11-24', status: 'open' as const, created_at: run.executed_at, closed_at: null, evidence_ref: null };
    const rec = { run, minutes: { run_id: 'r1', summary: 's', blockers: [], evidence_refs: [], outputs: [], notes: [] }, decisions: [dec], actions: [act] };

    await new PgStore(fake).saveOutcome(rec);
    expect(log[0]).toBe('BEGIN');
    expect(log.filter((l) => l.startsWith('INSERT'))).toHaveLength(4); // run, ata, decisão, tarefa
    expect(log.at(-2)).toBe('COMMIT');
    expect(log.at(-1)).toBe('release');

    log.length = 0;
    failOn = 'INSERT INTO action_items';
    await expect(new PgStore(fake).saveOutcome(rec)).rejects.toThrow('falha simulada');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
    expect(log.at(-1)).toBe('release');
  });
});
