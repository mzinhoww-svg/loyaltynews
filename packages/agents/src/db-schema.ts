/**
 * Tabelas Drizzle da organização agêntica (Frente 07), para o arquiteto incorporar a
 * `packages/db` (re-export em `packages/db/src/schema.ts` e `npm run db:generate`).
 * Espelham `sql/001_agentic_org.sql`; o teste `db-schema.test.ts` gera o DDL a partir daqui
 * (drizzle-kit/api), aplica no PGlite e roda o mesmo PgStore sobre ele.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const sectorMemory = pgTable(
  'sector_memory',
  {
    id: uuid('id').primaryKey(),
    editoria: text('editoria').notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    content: jsonb('content').notNull(),
    sourceRefs: jsonb('source_refs').notNull().default(sql`'[]'::jsonb`),
    authorAgentId: text('author_agent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('sector_memory_editoria_key_version_uq').on(t.editoria, t.key, t.version),
    index('sector_memory_editoria_kind_idx').on(t.editoria, t.kind),
    check('sector_memory_editoria_ck', sql`${t.editoria} IN ('mercado','programas','pontos','bancos','varejo','travel','tech','crm','global','regulacao')`),
    check('sector_memory_kind_ck', sql`${t.kind} IN ('sources','glossary','style','lessons','open_threads','decision')`),
    check('sector_memory_version_ck', sql`${t.version} >= 1`),
  ],
);

export const meetingRuns = pgTable(
  'meeting_runs',
  {
    id: uuid('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    localDate: date('local_date').notNull(),
    instance: text('instance').notNull().default(''),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    route: text('route').notNull(),
    delayMinutes: integer('delay_minutes').notNull().default(0),
    modelCalls: integer('model_calls').notNull().default(0),
    recovered: boolean('recovered').notNull().default(false),
    chair: text('chair').notNull(),
    participantsPresent: jsonb('participants_present').notNull().default(sql`'[]'::jsonb`),
    participantsAbsent: jsonb('participants_absent').notNull().default(sql`'[]'::jsonb`),
    quorumMinimum: integer('quorum_minimum').notNull(),
  },
  (t) => [
    // idempotência: recovery_policy.idempotency_key = meeting_id + local_date (+ instance p/ eventos)
    unique('meeting_runs_idem_uq').on(t.meetingId, t.localDate, t.instance),
    check('meeting_runs_status_ck', sql`${t.status} IN ('completed','status_only','waiting')`),
    check('meeting_runs_reason_ck', sql`${t.reason} IS NULL OR ${t.reason} IN ('no_inputs_or_decisions','quorum_not_met','recovery_window_expired','host_off_previous_day')`),
    check('meeting_runs_delay_ck', sql`${t.delayMinutes} >= 0`),
    check('meeting_runs_model_calls_ck', sql`${t.modelCalls} >= 0`),
    check('meeting_runs_reason_status_ck', sql`(${t.status} = 'status_only' AND ${t.reason} IS NOT NULL) OR (${t.status} <> 'status_only' AND ${t.reason} IS NULL)`),
  ],
);

export const meetingMinutes = pgTable('meeting_minutes', {
  runId: uuid('run_id').primaryKey().references(() => meetingRuns.id),
  summary: text('summary').notNull(),
  blockers: jsonb('blockers').notNull().default(sql`'[]'::jsonb`),
  evidenceRefs: jsonb('evidence_refs').notNull().default(sql`'[]'::jsonb`),
  outputs: jsonb('outputs').notNull().default(sql`'[]'::jsonb`),
  notes: jsonb('notes').notNull().default(sql`'[]'::jsonb`),
});

export const meetingDecisions = pgTable(
  'meeting_decisions',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id').notNull().references(() => meetingRuns.id),
    text: text('text').notNull(),
    proposedBy: text('proposed_by').notNull(),
    authority: text('authority').notNull(),
    status: text('status').notNull(),
    needsHumanApproval: boolean('needs_human_approval').notNull().default(false),
    evidenceRefs: jsonb('evidence_refs').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index('meeting_decisions_run_idx').on(t.runId),
    check('meeting_decisions_status_ck', sql`${t.status} IN ('approved','pending_human','rejected_invalid_authority')`),
  ],
);

export const actionItems = pgTable(
  'action_items',
  {
    id: uuid('id').primaryKey(),
    decisionId: uuid('decision_id').notNull().references(() => meetingDecisions.id),
    runId: uuid('run_id').notNull().references(() => meetingRuns.id),
    title: text('title').notNull(),
    ownerAgentId: text('owner_agent_id').notNull(),
    dueDate: date('due_date').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    evidenceRef: text('evidence_ref'),
  },
  (t) => [
    index('action_items_owner_status_idx').on(t.ownerAgentId, t.status),
    index('action_items_due_idx').on(t.dueDate).where(sql`${t.status} = 'open'`),
    check('action_items_status_ck', sql`${t.status} IN ('open','done','escalated')`),
    // WF16: conclusão exige evidência verificável
    check('action_items_done_evidence_ck', sql`${t.status} <> 'done' OR (${t.closedAt} IS NOT NULL AND ${t.evidenceRef} IS NOT NULL)`),
  ],
);

export const meetingInputs = pgTable(
  'meeting_inputs',
  {
    meetingId: text('meeting_id').notNull(),
    localDate: date('local_date').notNull(),
    instance: text('instance').notNull().default(''),
    agentId: text('agent_id').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.localDate, t.instance, t.agentId] })],
);
