/**
 * Persistência da organização agêntica. `Store` é a porta; `InMemoryStore` serve a testes e
 * dev; `PgStore` (pg-store.ts) é a implementação PostgreSQL sobre `sql/001_agentic_org.sql`.
 */
import type { Editoria, ParticipantInput, RunStatus, StatusReason } from './schemas';

export const MEMORY_KINDS = ['sources', 'glossary', 'style', 'lessons', 'open_threads', 'decision'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface SectorMemoryEntry {
  id: string;
  editoria: Editoria;
  kind: MemoryKind;
  key: string;
  version: number;
  content: unknown;
  source_refs: string[];
  author_agent_id: string;
  created_at: string; // ISO
}

export interface MeetingRun {
  id: string;
  meeting_id: string;
  local_date: string; // YYYY-MM-DD
  /** '' para rituais agendados; id do evento para rituais por evento (X-incident) */
  instance: string;
  scheduled_for: string; // ISO UTC
  executed_at: string; // ISO UTC
  status: RunStatus;
  reason: StatusReason | null;
  route: string;
  /** chamadas de modelo feitas pelo agendador (sempre 0: ele é determinístico) */
  model_calls: number;
  /** atraso entre o horário agendado e a execução, em minutos */
  delay_minutes: number;
  /** true se rodou depois do horário (atraso acima da tolerância), dentro da janela de recuperação */
  recovered: boolean;
  chair: string;
  participants_present: string[];
  participants_absent: string[];
  quorum_minimum: number;
}

export interface Minutes {
  run_id: string;
  summary: string;
  blockers: string[];
  evidence_refs: string[];
  outputs: string[];
  /** observações do agendador (ex.: decisões rejeitadas por autoridade inválida) */
  notes: string[];
}

export type DecisionStatus = 'approved' | 'pending_human' | 'rejected_invalid_authority';

export interface Decision {
  id: string;
  run_id: string;
  text: string;
  proposed_by: string;
  authority: string;
  status: DecisionStatus;
  needs_human_approval: boolean;
  evidence_refs: string[];
}

export type ActionStatus = 'open' | 'done' | 'escalated';

export interface ActionItem {
  id: string;
  decision_id: string;
  run_id: string;
  title: string;
  owner_agent_id: string;
  due_date: string; // YYYY-MM-DD
  status: ActionStatus;
  created_at: string;
  closed_at: string | null;
  evidence_ref: string | null;
}

export interface MeetingOutcomeRecord {
  run: MeetingRun;
  minutes: Minutes;
  decisions: Decision[];
  actions: ActionItem[];
}

export interface Store {
  getRun(meetingId: string, localDate: string, instance?: string): Promise<MeetingRun | null>;
  listRuns(filter?: { localDate?: string; meetingId?: string }): Promise<MeetingRun[]>;
  /**
   * Grava run + ata + decisões + tarefas atomicamente. Idempotente em (meeting_id, local_date, instance):
   * se já existir run, nada é gravado e devolve `{ created: false, run: existente }`.
   */
  saveOutcome(rec: MeetingOutcomeRecord): Promise<{ created: boolean; run: MeetingRun }>;
  getMinutes(runId: string): Promise<Minutes | null>;
  listDecisions(runId: string): Promise<Decision[]>;
  listActions(filter?: { runId?: string; status?: ActionStatus; ownerAgentId?: string }): Promise<ActionItem[]>;
  updateAction(id: string, patch: Partial<Pick<ActionItem, 'status' | 'closed_at' | 'evidence_ref'>>): Promise<ActionItem>;
  // insumos estruturados enviados pelos participantes (async_structured_first)
  putInput(meetingId: string, localDate: string, input: ParticipantInput, instance?: string): Promise<void>;
  getInputs(meetingId: string, localDate: string, instance?: string): Promise<ParticipantInput[]>;
  // memória setorial por editoria (append-only, versionada)
  appendMemory(e: Omit<SectorMemoryEntry, 'id' | 'version' | 'created_at'>): Promise<SectorMemoryEntry>;
  getMemory(editoria: Editoria, key: string): Promise<SectorMemoryEntry | null>;
  listMemory(editoria: Editoria, kind?: MemoryKind): Promise<SectorMemoryEntry[]>;
  memoryHistory(editoria: Editoria, key: string): Promise<SectorMemoryEntry[]>;
}

export class InMemoryStore implements Store {
  private runs = new Map<string, MeetingRun>();
  private minutes = new Map<string, Minutes>();
  private decisions = new Map<string, Decision>();
  private actions = new Map<string, ActionItem>();
  private inputs = new Map<string, ParticipantInput>();
  private memory: SectorMemoryEntry[] = [];

  private rk = (m: string, d: string, i = '') => `${m}|${d}|${i}`;

  async getRun(meetingId: string, localDate: string, instance = '') {
    return this.runs.get(this.rk(meetingId, localDate, instance)) ?? null;
  }
  async listRuns(f?: { localDate?: string; meetingId?: string }) {
    return [...this.runs.values()].filter((r) => (!f?.localDate || r.local_date === f.localDate) && (!f?.meetingId || r.meeting_id === f.meetingId));
  }
  async saveOutcome(rec: MeetingOutcomeRecord) {
    const k = this.rk(rec.run.meeting_id, rec.run.local_date, rec.run.instance);
    const existing = this.runs.get(k);
    if (existing) return { created: false, run: existing };
    this.runs.set(k, structuredClone(rec.run));
    this.minutes.set(rec.run.id, structuredClone(rec.minutes));
    for (const d of rec.decisions) this.decisions.set(d.id, structuredClone(d));
    for (const a of rec.actions) this.actions.set(a.id, structuredClone(a));
    return { created: true, run: rec.run };
  }
  async getMinutes(runId: string) {
    return this.minutes.get(runId) ?? null;
  }
  async listDecisions(runId: string) {
    return [...this.decisions.values()].filter((d) => d.run_id === runId);
  }
  async listActions(f?: { runId?: string; status?: ActionStatus; ownerAgentId?: string }) {
    return [...this.actions.values()].filter(
      (a) => (!f?.runId || a.run_id === f.runId) && (!f?.status || a.status === f.status) && (!f?.ownerAgentId || a.owner_agent_id === f.ownerAgentId),
    );
  }
  async updateAction(id: string, patch: Partial<Pick<ActionItem, 'status' | 'closed_at' | 'evidence_ref'>>) {
    const a = this.actions.get(id);
    if (!a) throw new Error(`tarefa inexistente: ${id}`);
    Object.assign(a, patch);
    return structuredClone(a);
  }
  async putInput(meetingId: string, localDate: string, input: ParticipantInput, instance = '') {
    this.inputs.set(`${meetingId}|${localDate}|${instance}|${input.agent_id}`, structuredClone(input));
  }
  async getInputs(meetingId: string, localDate: string, instance = '') {
    const p = `${meetingId}|${localDate}|${instance}|`;
    return [...this.inputs.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => structuredClone(v));
  }
  async appendMemory(e: Omit<SectorMemoryEntry, 'id' | 'version' | 'created_at'>) {
    const version = this.memory.filter((m) => m.editoria === e.editoria && m.key === e.key).length + 1;
    const entry: SectorMemoryEntry = { ...structuredClone(e), id: crypto.randomUUID(), version, created_at: new Date().toISOString() };
    this.memory.push(entry);
    return structuredClone(entry);
  }
  async getMemory(editoria: Editoria, key: string) {
    const all = await this.memoryHistory(editoria, key);
    return all.at(-1) ?? null;
  }
  async listMemory(editoria: Editoria, kind?: MemoryKind) {
    const latest = new Map<string, SectorMemoryEntry>();
    for (const m of this.memory) if (m.editoria === editoria && (!kind || m.kind === kind)) latest.set(m.key, m);
    return [...latest.values()].map((m) => structuredClone(m));
  }
  async memoryHistory(editoria: Editoria, key: string) {
    return this.memory.filter((m) => m.editoria === editoria && m.key === key).map((m) => structuredClone(m));
  }
}
