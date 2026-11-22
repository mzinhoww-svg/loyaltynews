/**
 * Implementação PostgreSQL do `Store` sobre `sql/001_agentic_org.sql`.
 * Independe do driver: recebe um `PgDb` (adaptador fino sobre `pg.Pool`, ver README).
 */
import type { Editoria, ParticipantInput } from './schemas';
import type {
  ActionItem,
  ActionStatus,
  Decision,
  MeetingOutcomeRecord,
  MeetingRun,
  MemoryKind,
  Minutes,
  SectorMemoryEntry,
  Store,
} from './store';
import { idempotencyKey, keyDate } from './store';

export interface PgQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface PgDb extends PgQueryable {
  /** executa `fn` numa transação (BEGIN/COMMIT, ROLLBACK em erro) numa única conexão */
  transaction<T>(fn: (q: PgQueryable) => Promise<T>): Promise<T>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const arr = <T = string>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : typeof v === 'string' ? (JSON.parse(v) as T[]) : []);

function toRun(r: Record<string, unknown>): MeetingRun {
  return {
    id: String(r.id),
    meeting_id: String(r.meeting_id),
    local_date: dateStr(r.local_date),
    instance: String(r.instance ?? ''),
    rescheduled_date: r.rescheduled_date ? dateStr(r.rescheduled_date) : null,
    reschedule_reason: (r.reschedule_reason as MeetingRun['reschedule_reason']) ?? null,
    idempotency_keys: arr(r.idempotency_keys),
    scheduled_for: iso(r.scheduled_for),
    executed_at: iso(r.executed_at),
    status: r.status as MeetingRun['status'],
    reason: (r.reason as MeetingRun['reason']) ?? null,
    route: String(r.route),
    delay_minutes: Number(r.delay_minutes),
    model_calls: Number(r.model_calls),
    recovered: Boolean(r.recovered),
    chair: String(r.chair),
    participants_present: arr(r.participants_present),
    participants_absent: arr(r.participants_absent),
    quorum_minimum: Number(r.quorum_minimum),
  };
}
function toAction(r: Record<string, unknown>): ActionItem {
  return {
    id: String(r.id),
    decision_id: String(r.decision_id),
    run_id: String(r.run_id),
    title: String(r.title),
    owner_agent_id: String(r.owner_agent_id),
    due_date: dateStr(r.due_date),
    status: r.status as ActionStatus,
    created_at: iso(r.created_at),
    closed_at: r.closed_at ? iso(r.closed_at) : null,
    evidence_ref: (r.evidence_ref as string | null) ?? null,
  };
}
function toMemory(r: Record<string, unknown>): SectorMemoryEntry {
  return {
    id: String(r.id),
    editoria: r.editoria as Editoria,
    kind: r.kind as MemoryKind,
    key: String(r.key),
    version: Number(r.version),
    content: r.content, // jsonb já vem parseado pelo driver (inclui strings JSON)
    source_refs: arr(r.source_refs),
    author_agent_id: String(r.author_agent_id),
    created_at: iso(r.created_at),
  };
}
const j = (v: unknown) => JSON.stringify(v);

async function findRun(q: PgQueryable, meetingId: string, originalDate: string, instance: string): Promise<MeetingRun | null> {
  const { rows } = await q.query(
    'SELECT * FROM meeting_runs WHERE meeting_id = $1 AND instance = $3 AND (local_date = $2 OR idempotency_keys ? $4)',
    [meetingId, originalDate, instance, idempotencyKey(meetingId, originalDate, instance)],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

export class PgStore implements Store {
  constructor(private readonly db: PgDb) {}

  /** Acha pela data ORIGINAL: chave primária (`local_date`) ou qualquer chave registrada em colisão. */
  async getRun(meetingId: string, originalDate: string, instance = '') {
    return findRun(this.db, meetingId, originalDate, instance);
  }

  async listRuns(f?: { localDate?: string; meetingId?: string }) {
    const { rows } = await this.db.query('SELECT * FROM meeting_runs ORDER BY scheduled_for, meeting_id', []);
    return rows.map(toRun).filter((r) => (!f?.localDate || r.local_date === f.localDate) && (!f?.meetingId || r.meeting_id === f.meetingId));
  }

  async saveOutcome(rec: MeetingOutcomeRecord) {
    return this.db.transaction(async (q) => {
      for (const date of [rec.run.local_date, ...rec.run.idempotency_keys.map(keyDate)]) {
        const existing = await findRun(q, rec.run.meeting_id, date, rec.run.instance);
        if (existing) return { created: false, run: existing };
      }
      const r = rec.run;
      await q.query(
        `INSERT INTO meeting_runs (id, meeting_id, local_date, instance, rescheduled_date, reschedule_reason, idempotency_keys, scheduled_for, executed_at, status, reason, route, delay_minutes, model_calls, recovered, chair, participants_present, participants_absent, quorum_minimum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [r.id, r.meeting_id, r.local_date, r.instance, r.rescheduled_date, r.reschedule_reason, j(r.idempotency_keys), r.scheduled_for, r.executed_at, r.status, r.reason, r.route, r.delay_minutes, r.model_calls, r.recovered, r.chair, j(r.participants_present), j(r.participants_absent), r.quorum_minimum],
      );
      const m = rec.minutes;
      await q.query('INSERT INTO meeting_minutes (run_id, summary, blockers, evidence_refs, outputs, notes) VALUES ($1,$2,$3,$4,$5,$6)', [m.run_id, m.summary, j(m.blockers), j(m.evidence_refs), j(m.outputs), j(m.notes)]);
      for (const d of rec.decisions) {
        await q.query(
          'INSERT INTO meeting_decisions (id, run_id, text, proposed_by, authority, status, needs_human_approval, evidence_refs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [d.id, d.run_id, d.text, d.proposed_by, d.authority, d.status, d.needs_human_approval, j(d.evidence_refs)],
        );
      }
      for (const a of rec.actions) {
        await q.query(
          'INSERT INTO action_items (id, decision_id, run_id, title, owner_agent_id, due_date, status, created_at, closed_at, evidence_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [a.id, a.decision_id, a.run_id, a.title, a.owner_agent_id, a.due_date, a.status, a.created_at, a.closed_at, a.evidence_ref],
        );
      }
      return { created: true, run: rec.run };
    });
  }

  async getMinutes(runId: string): Promise<Minutes | null> {
    const { rows } = await this.db.query('SELECT * FROM meeting_minutes WHERE run_id = $1', [runId]);
    const r = rows[0];
    return r ? { run_id: String(r.run_id), summary: String(r.summary), blockers: arr(r.blockers), evidence_refs: arr(r.evidence_refs), outputs: arr(r.outputs), notes: arr(r.notes) } : null;
  }

  async listDecisions(runId: string): Promise<Decision[]> {
    const { rows } = await this.db.query('SELECT * FROM meeting_decisions WHERE run_id = $1', [runId]);
    return rows.map((r) => ({
      id: String(r.id), run_id: String(r.run_id), text: String(r.text), proposed_by: String(r.proposed_by), authority: String(r.authority),
      status: r.status as Decision['status'], needs_human_approval: Boolean(r.needs_human_approval), evidence_refs: arr(r.evidence_refs),
    }));
  }

  async listActions(f?: { runId?: string; status?: ActionStatus; ownerAgentId?: string }) {
    const { rows } = await this.db.query('SELECT * FROM action_items ORDER BY due_date, id', []);
    return rows.map(toAction).filter((a) => (!f?.runId || a.run_id === f.runId) && (!f?.status || a.status === f.status) && (!f?.ownerAgentId || a.owner_agent_id === f.ownerAgentId));
  }

  async updateAction(id: string, patch: Partial<Pick<ActionItem, 'status' | 'closed_at' | 'evidence_ref'>>) {
    const cur = await this.db.query('SELECT * FROM action_items WHERE id = $1', [id]);
    if (!cur.rows[0]) throw new Error(`tarefa inexistente: ${id}`);
    const next = { ...toAction(cur.rows[0]), ...patch };
    await this.db.query('UPDATE action_items SET status = $2, closed_at = $3, evidence_ref = $4 WHERE id = $1', [id, next.status, next.closed_at, next.evidence_ref]);
    return next;
  }

  async putInput(meetingId: string, localDate: string, input: ParticipantInput, instance = '') {
    await this.db.transaction(async (q) => {
      await q.query('DELETE FROM meeting_inputs WHERE meeting_id = $1 AND local_date = $2 AND instance = $3 AND agent_id = $4', [meetingId, localDate, instance, input.agent_id]);
      await q.query('INSERT INTO meeting_inputs (meeting_id, local_date, instance, agent_id, payload) VALUES ($1,$2,$3,$4,$5)', [meetingId, localDate, instance, input.agent_id, j(input)]);
    });
  }

  async getInputs(meetingId: string, localDate: string, instance = '') {
    const { rows } = await this.db.query('SELECT payload FROM meeting_inputs WHERE meeting_id = $1 AND local_date = $2 AND instance = $3 ORDER BY agent_id', [meetingId, localDate, instance]);
    return rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as ParticipantInput);
  }

  async appendMemory(e: Omit<SectorMemoryEntry, 'id' | 'version' | 'created_at'>) {
    return this.db.transaction(async (q) => {
      const cur = await q.query('SELECT version FROM sector_memory WHERE editoria = $1 AND key = $2', [e.editoria, e.key]);
      const version = cur.rows.reduce((mx, r) => Math.max(mx, Number(r.version)), 0) + 1;
      const entry: SectorMemoryEntry = { ...e, id: crypto.randomUUID(), version, created_at: new Date().toISOString() };
      await q.query(
        'INSERT INTO sector_memory (id, editoria, kind, key, version, content, source_refs, author_agent_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [entry.id, entry.editoria, entry.kind, entry.key, entry.version, j(entry.content), j(entry.source_refs), entry.author_agent_id, entry.created_at],
      );
      return entry;
    });
  }

  async memoryHistory(editoria: Editoria, key: string) {
    const { rows } = await this.db.query('SELECT * FROM sector_memory WHERE editoria = $1 AND key = $2 ORDER BY version', [editoria, key]);
    return rows.map(toMemory);
  }
  async getMemory(editoria: Editoria, key: string) {
    return (await this.memoryHistory(editoria, key)).at(-1) ?? null;
  }
  async listMemory(editoria: Editoria, kind?: MemoryKind) {
    const { rows } = await this.db.query('SELECT * FROM sector_memory WHERE editoria = $1 ORDER BY key, version', [editoria]);
    const latest = new Map<string, SectorMemoryEntry>();
    for (const r of rows.map(toMemory)) if (!kind || r.kind === kind) latest.set(r.key, r);
    return [...latest.values()];
  }
}
