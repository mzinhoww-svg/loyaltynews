import { z } from 'zod';
import { IsoDate, TIMEZONE } from './common';

/**
 * Contratos lógicos da organização agêntica. Os campos seguem os registros oficiais
 * (`contracts/agents.registry.json`, `workflows.registry.json`, `meetings.registry.json`),
 * em snake_case, e aceitam campos adicionais do registro (`loose`).
 */
export const Department = z.enum([
  'executivo',
  'editorial',
  'creative',
  'growth',
  'intelligence',
  'commercial',
  'technology',
  'trust',
]);

export const RouteHint = z.enum(['deterministic', 'economy', 'review', 'premium', 'strategic', 'image_fast', 'image_premium']);

export const AgentProfile = z.looseObject({
  id: z.string().regex(/^[a-z_]+$/),
  name: z.string().min(1),
  department: Department,
  reports_to: z.string().nullable(),
  mission: z.string().min(1),
  allowed_tools: z.array(z.string()),
  kpi: z.string().min(1),
  scope: z.string().min(1),
  enabled: z.boolean(),
  output_contract: z.looseObject({ type: z.literal('object') }),
  default_route_hint: RouteHint,
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const Workflow = z.looseObject({
  id: z.string().regex(/^WF\d{2}$/),
  name: z.string().min(1),
  trigger: z.string().min(1),
  owner: z.string().min(1),
  steps: z.string().min(1),
  blockers: z.array(z.string()),
  enabled: z.boolean(),
});
export type Workflow = z.infer<typeof Workflow>;

/** Quórum mínimo = máx(2, ⌈2n/3⌉) com chair obrigatório (Blueprint §3; ADR-005). */
export function expectedQuorum(participants: number): number {
  return Math.max(2, Math.ceil((2 * participants) / 3));
}

export const Ritual = z
  .looseObject({
    id: z.string().min(1),
    title: z.string().min(1),
    cycle: z.enum(['weekday', 'weekly', 'monthly', 'event']),
    timezone: z.literal(TIMEZONE),
    schedule_local: z.string().min(1),
    chair: z.string().min(1),
    participants: z.array(z.string()).min(2),
    route: RouteHint,
    enabled: z.boolean(),
    quorum: z.object({ minimum: z.number().int().min(2), chair_required: z.literal(true) }),
    max_rounds: z.literal(2),
  })
  .refine((r) => r.quorum.minimum === expectedQuorum(r.participants.length), {
    message: 'quórum diferente de máx(2, ⌈2n/3⌉)',
    path: ['quorum', 'minimum'],
  })
  .refine((r) => r.participants.includes(r.chair), { message: 'chair fora dos participantes', path: ['chair'] });
export type Ritual = z.infer<typeof Ritual>;

/*
 * Persistência dos rituais (Frente 07, packages/db/src/schema/agents.ts). Decisão do Chief Architect
 * (rodada de integração 2): o modelo do banco prevalece; os contratos espelham as tabelas.
 * Mapeamento dos tipos antigos do scaffold (sem uso por nenhuma frente):
 *   Meeting.status agendada     -> sem linha (ainda não executado) | realizada -> completed
 *                  somente_status -> status_only (com reason)       | cancelada -> não existe; usar status_only
 *                  (novo) waiting -> aguardando dependência (D-sync, P5)
 *   Meeting.decisoes            -> meeting_decisions (run_id)
 *   Decision.responsavel/prazo/evidenciaExigida -> action_items (owner_agent_id, due_date, evidence_ref)
 *   Decision.alcada automatica  -> meeting_decisions.status approved
 *                  protegida    -> pending_human (atos reservados ao responsável; o verificador cuida de aceites)
 *   Decision.idempotencyKey     -> unique (meeting_id, local_date, instance) em meeting_runs
 */
export const MeetingRunStatus = z.enum(['completed', 'status_only', 'waiting']);
export const MeetingRunReason = z.enum(['no_inputs_or_decisions', 'quorum_not_met', 'recovery_window_expired', 'host_off_previous_day']);

export const MeetingRun = z
  .object({
    id: z.uuid(),
    meetingId: z.string().min(1),
    localDate: IsoDate,
    /** '' = ocorrência agendada; id do evento para X-incident. */
    instance: z.string().default(''),
    scheduledFor: z.iso.datetime({ offset: true }),
    executedAt: z.iso.datetime({ offset: true }),
    status: MeetingRunStatus,
    reason: MeetingRunReason.nullable(),
    route: RouteHint,
    delayMinutes: z.number().int().min(0),
    modelCalls: z.number().int().min(0),
    recovered: z.boolean(),
    chair: z.string().min(1),
    participantsPresent: z.array(z.string()),
    participantsAbsent: z.array(z.string()),
    quorumMinimum: z.number().int().min(2),
  })
  .refine((r) => (r.status === 'status_only') === (r.reason !== null), {
    message: 'status_only exige motivo; demais estados não têm motivo',
    path: ['reason'],
  });
export type MeetingRun = z.infer<typeof MeetingRun>;

export const MeetingDecision = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  text: z.string().min(1),
  proposedBy: z.string().min(1),
  authority: z.string().min(1),
  status: z.enum(['approved', 'pending_human', 'rejected_invalid_authority']),
  needsHumanApproval: z.boolean(),
  evidenceRefs: z.array(z.string()),
});
export type MeetingDecision = z.infer<typeof MeetingDecision>;

/** Tarefa gerada por decisão (WF16): conclusão exige data e evidência verificável. */
export const ActionItem = z
  .object({
    id: z.uuid(),
    decisionId: z.uuid(),
    runId: z.uuid(),
    title: z.string().min(1),
    ownerAgentId: z.string().min(1),
    dueDate: IsoDate,
    status: z.enum(['open', 'done', 'escalated']),
    createdAt: z.iso.datetime({ offset: true }),
    closedAt: z.iso.datetime({ offset: true }).nullable(),
    evidenceRef: z.string().min(1).nullable(),
  })
  .refine((a) => a.status !== 'done' || (a.closedAt !== null && a.evidenceRef !== null), {
    message: 'conclusão exige closedAt e evidência',
    path: ['evidenceRef'],
  });
export type ActionItem = z.infer<typeof ActionItem>;

/** Memória setorial versionada por editoria (append-only). */
export const SectorMemoryEntry = z.object({
  id: z.uuid(),
  editoria: z.enum(['mercado', 'programas', 'pontos', 'bancos', 'varejo', 'travel', 'tech', 'crm', 'global', 'regulacao']),
  kind: z.enum(['sources', 'glossary', 'style', 'lessons', 'open_threads', 'decision']),
  key: z.string().min(1),
  version: z.number().int().min(1),
  content: z.unknown(),
  sourceRefs: z.array(z.string()),
  authorAgentId: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});
export type SectorMemoryEntry = z.infer<typeof SectorMemoryEntry>;
