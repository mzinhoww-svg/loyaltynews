import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import { createBrCalendar } from './calendar';
import { loadRegistries } from './config';
import { buildOrganization } from './organization';
import { SectorMemoryService } from './memory';
import { pgDbFromPGlite, pgDbFromPool } from './pg-adapter';
import { PgStore } from './pg-store';
import { RitualScheduler, StoreInputCollector } from './scheduler';
import type { MeetingOutcomeRecord, MeetingRun } from './store';

// Banco: migrações oficiais de @ln/db (0004_agentic_org + 0005_agents_reschedule) em PGlite = PostgreSQL em WASM.
let t: Awaited<ReturnType<typeof createTestDb>>;
let store: PgStore;
const reg = loadRegistries();
const org = buildOrganization(reg);

beforeAll(async () => {
  t = await createTestDb();
  store = new PgStore(pgDbFromPGlite(t.client as never));
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.client.exec('TRUNCATE action_items, meeting_decisions, meeting_minutes, meeting_runs, meeting_inputs, sector_memory CASCADE');
});

const mkRun = (over: Partial<MeetingRun> = {}): MeetingRun => ({
  id: '00000000-0000-4000-8000-000000000001', meeting_id: 'D-x', local_date: '2026-11-23', instance: '',
  rescheduled_date: null, reschedule_reason: null, idempotency_keys: ['D-x+2026-11-23'],
  scheduled_for: '2026-11-23T09:00:00.000Z', executed_at: '2026-11-23T09:00:00.000Z', status: 'completed', reason: null, route: 'economy',
  delay_minutes: 0, model_calls: 0, recovered: false, chair: 'a', participants_present: ['a'], participants_absent: [], quorum_minimum: 1, ...over,
});
const mkRec = (run: MeetingRun, extra: Partial<MeetingOutcomeRecord> = {}): MeetingOutcomeRecord => ({
  run, minutes: { run_id: run.id, summary: 's', blockers: [], evidence_refs: [], outputs: [], notes: [] }, decisions: [], actions: [], ...extra,
});

describe('PgStore sobre as migrações oficiais de @ln/db (PGlite)', () => {
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
    await store.putInput('D-mercado', date, { agent_id: 'editor_mercado', summary: 'ok', blockers: [], evidence_refs: ['e1'], decisions: [{ text: 'Cobrir X', proposed_by: 'editor_mercado', authority_class: 'automatic', evidence_refs: ['e1'], actions: [{ title: 'Apurar X', owner: 'writer_mercado', due_in_business_days: 2 }] }] });
    await store.putInput('D-mercado', date, { agent_id: 'writer_mercado', summary: 'ok', blockers: [], evidence_refs: [], decisions: [] });
    const s = new RitualScheduler({ registries: reg, calendar: createBrCalendar(), store, collector: new StoreInputCollector(store), flags: { rituais: true }, lookbackDays: 0 });
    const now = new Date('2026-11-19T06:00:00-03:00');
    const t1 = await s.tick(now);
    expect(t1.errors).toEqual([]);
    await s.tick(new Date(now.getTime() + 60_000));
    const runs = await store.listRuns({ meetingId: 'D-mercado' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', local_date: date, model_calls: 0, chair: 'editor_mercado', rescheduled_date: null, idempotency_keys: ['D-mercado+2026-11-19'] });
    expect(runs[0]!.participants_present.sort()).toEqual(['editor_mercado', 'writer_mercado']);
    expect((await store.getMinutes(runs[0]!.id))!.summary).toMatch(/2\/2 presentes/);
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

  it('P5 v2 no banco: ocorrência movida por feriado guarda a chave ORIGINAL e rescheduled_date; reinício não duplica', async () => {
    // segunda 15/11/2027 é feriado: W-cross (MON 09:00) vai para terça 16/11, chave = 2027-11-15
    const m = reg.meetings.find((x) => x.id === 'W-cross')!;
    for (const p of m.participants) await store.putInput('W-cross', '2027-11-15', { agent_id: p, summary: '', blockers: [], evidence_refs: p === m.chair ? ['e'] : [], decisions: [] });
    const s = new RitualScheduler({ registries: reg, calendar: createBrCalendar(), store, collector: new StoreInputCollector(store), flags: { rituais: true }, lookbackDays: 0 });
    await s.tick(new Date('2027-11-16T09:00:00-03:00'));
    await s.tick(new Date('2027-11-16T09:30:00-03:00')); // segundo reinício
    const runs = await store.listRuns({ meetingId: 'W-cross' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ local_date: '2027-11-15', rescheduled_date: '2027-11-16', reschedule_reason: 'holiday_move', idempotency_keys: ['W-cross+2027-11-15'], status: 'completed' });
    expect((await store.getMinutes(runs[0]!.id))!.notes.join(' ')).toMatch(/reagendado por feriado.*2027-11-15.*2027-11-16/);
    // achado pela data original, pela chave registrada e NÃO pela data efetiva
    expect(await store.getRun('W-cross', '2027-11-15')).not.toBeNull();
    expect(await store.getRun('W-cross', '2027-11-16')).toBeNull();
  });

  it('o banco recusa reagendamento incoerente (data não posterior, sem motivo) e duplicata da chave original', async () => {
    await expect(store.saveOutcome(mkRec(mkRun({ rescheduled_date: '2026-11-22', reschedule_reason: 'holiday_move' })))).rejects.toThrow(); // anterior à original
    await expect(store.saveOutcome(mkRec(mkRun({ id: '00000000-0000-4000-8000-000000000002', rescheduled_date: '2026-11-24', reschedule_reason: null })))).rejects.toThrow();
    const ok = mkRun({ id: '00000000-0000-4000-8000-000000000003', rescheduled_date: '2026-11-24', reschedule_reason: 'holiday_move' });
    await expect(store.saveOutcome(mkRec(ok))).resolves.toMatchObject({ created: true });
    // mesma chave original de novo (mesmo com outro id): idempotente, nada novo gravado
    await expect(store.saveOutcome(mkRec({ ...ok, id: '00000000-0000-4000-8000-000000000004' }))).resolves.toMatchObject({ created: false });
    expect(await store.listRuns({ meetingId: 'D-x' })).toHaveLength(1);
  });

  it('colisão: as duas chaves ficam registradas e qualquer uma encontra a execução única', async () => {
    const r = mkRun({ id: '00000000-0000-4000-8000-000000000005', meeting_id: 'W-y', rescheduled_date: '2026-12-07', reschedule_reason: 'holiday_move', local_date: '2026-11-27', idempotency_keys: ['W-y+2026-11-27', 'W-y+2026-12-04'] });
    await store.saveOutcome(mkRec(r));
    expect((await store.getRun('W-y', '2026-11-27'))!.id).toBe(r.id);
    expect((await store.getRun('W-y', '2026-12-04'))!.id).toBe(r.id);
    expect(await store.getRun('W-y', '2026-12-11')).toBeNull();
    // gravar de novo cobrindo uma das chaves já usadas não cria segunda execução
    const dup = mkRun({ id: '00000000-0000-4000-8000-000000000006', meeting_id: 'W-y', local_date: '2026-12-04', idempotency_keys: ['W-y+2026-12-04'] });
    await expect(store.saveOutcome(mkRec(dup))).resolves.toMatchObject({ created: false });
  });

  it('o banco recusa status_only sem motivo e completed com motivo (CHECK)', async () => {
    const mk = (status: 'completed' | 'status_only', reason: 'quorum_not_met' | null, n: number) =>
      mkRec(mkRun({ id: `00000000-0000-4000-8000-00000000010${n}`, meeting_id: 'D-y', instance: `i${n}`, idempotency_keys: [`D-y+2026-11-23#i${n}`], status, reason, participants_present: [] }));
    await expect(store.saveOutcome(mk('status_only', null, 1))).rejects.toThrow();
    await expect(store.saveOutcome(mk('completed', 'quorum_not_met', 2))).rejects.toThrow();
    await expect(store.saveOutcome(mk('status_only', 'quorum_not_met', 3))).resolves.toMatchObject({ created: true });
  });

  it('saveOutcome é atômico no PostgreSQL: falha numa tarefa desfaz run, ata e decisões', async () => {
    const run = mkRun();
    const dec = { id: '00000000-0000-4000-8000-000000000002', run_id: run.id, text: 't', proposed_by: 'a', authority: 'x', status: 'approved' as const, needs_human_approval: false, evidence_refs: [] };
    const bad = { id: '00000000-0000-4000-8000-000000000003', decision_id: dec.id, run_id: run.id, title: 't', owner_agent_id: 'a', due_date: '2026-11-24', status: 'done' as const, created_at: run.executed_at, closed_at: null, evidence_ref: null };
    await expect(store.saveOutcome(mkRec(run, { decisions: [dec], actions: [bad] }))).rejects.toThrow();
    expect(await store.getRun('D-x', '2026-11-23')).toBeNull();
    expect(await store.listDecisions(run.id)).toEqual([]);
  });

  it('decisão protegida vai ao verificador (pending_verifier), sem aprovação humana de rotina', async () => {
    const run = mkRun();
    const d = { id: '00000000-0000-4000-8000-000000000009', run_id: run.id, text: 'mudar política', proposed_by: 'a', authority: 'x', status: 'pending_verifier' as const, needs_human_approval: false, evidence_refs: [] };
    await store.saveOutcome(mkRec(run, { decisions: [d] }));
    expect((await store.listDecisions(run.id))[0]).toMatchObject({ status: 'pending_verifier', needs_human_approval: false });
  });

  it('saveOutcome roda numa única transação: COMMIT no sucesso, ROLLBACK (sem COMMIT) na falha', async () => {
    // Contrato do adaptador de pg.Pool (BEGIN/COMMIT/ROLLBACK e release), com cliente simulado.
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
    const run = mkRun({ id: 'r1' });
    const dec = { id: 'd1', run_id: 'r1', text: 't', proposed_by: 'a', authority: 'x', status: 'approved' as const, needs_human_approval: false, evidence_refs: [] };
    const act = { id: 'a1', decision_id: 'd1', run_id: 'r1', title: 't', owner_agent_id: 'a', due_date: '2026-11-24', status: 'open' as const, created_at: run.executed_at, closed_at: null, evidence_ref: null };
    const rec = mkRec(run, { decisions: [dec], actions: [act] });

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
