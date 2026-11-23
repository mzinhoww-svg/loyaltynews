/**
 * ESQUEMAS do catálogo (Frente 07), PROPOSTOS pela frente porque o Blueprint e os registros protegidos não os trazem:
 * (1) o formato da ENTRADA de cada ritual (insumo estruturado do participante, por família de ritual);
 * (2) o esquema de cada SAÍDA (artefato) dos 28 rituais, por rótulo de `outputs`;
 * (3) o esquema de EVIDÊNCIA por etapa de workflow;
 * (4) os GATES explícitos dos workflows que o registro deixa sem `auto_gate_*`.
 * Tudo é dado e validação; nada roda. Os contratos protegidos NÃO foram alterados: a ratificação é do Chief Architect.
 */
import { z } from 'zod';
import { IdSchema, ParticipantInputSchema } from './schemas';

const Ref = z.string().min(1);
const Evidence = z.array(Ref).min(1);
const Authority = z.enum(['automatic', 'protected', 'owner_reserved']);

// --- (2) artefatos de saída -----------------------------------------------------------------------------------------------

const priority = z.object({ rank: z.number().int().min(1), subject: z.string().min(1), rationale: z.string().min(1), evidence_refs: Evidence }).strict();
const task = z.object({ title: z.string().min(1), owner: IdSchema, due_in_business_days: z.number().int().min(0).max(60), evidence_refs: Evidence, risk: z.enum(['low', 'medium', 'high']), authority_class: Authority }).strict();
const blocker = z.object({ description: z.string().min(1), owner: IdSchema, evidence_refs: Evidence, escalate_to: IdSchema.optional() }).strict();
const decision = z.object({ text: z.string().min(1), proposed_by: IdSchema, authority_class: Authority, evidence_refs: Evidence }).strict();
const dependency = z.object({ from: IdSchema, to: z.string().min(1), state: z.enum(['ok', 'blocked']), evidence_refs: Evidence }).strict();
const calendarItem = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), subject: z.string().min(1), owner: IdSchema }).strict();
const hypothesis = z.object({ statement: z.string().min(1), test: z.string().min(1), evidence_refs: Evidence }).strict();
const planItem = z.object({ subject: z.string().min(1), owner: IdSchema, due_in_business_days: z.number().int().min(0).max(366), evidence_refs: Evidence }).strict();
const finding = z.object({ subject: z.string().min(1), severity: z.enum(['low', 'medium', 'high']), evidence_refs: Evidence, recommended_action: z.string().optional() }).strict();
const metric = z.object({ metric: z.string().min(1), value: z.number(), period: z.string().min(1), source_ref: Ref }).strict();

export const ARTIFACT_SCHEMAS = {
  priority_list: z.object({ items: z.array(priority).min(1) }).strict(),
  task_list: z.object({ items: z.array(task) }).strict(),
  blocker_list: z.object({ items: z.array(blocker) }).strict(),
  decision_list: z.object({ items: z.array(decision) }).strict(),
  /** `status_only` = regra do silêncio: sem fato novo nem decisão, só registro de status */
  status_report: z.object({ state: z.enum(['status_only', 'changed']), summary: z.string().min(1), evidence_refs: z.array(Ref) }).strict(),
  dependency_list: z.object({ items: z.array(dependency) }).strict(),
  calendar: z.object({ items: z.array(calendarItem).min(1) }).strict(),
  hypothesis_list: z.object({ items: z.array(hypothesis).min(1) }).strict(),
  plan: z.object({ title: z.string().min(1), items: z.array(planItem).min(1) }).strict(),
  proposal: z.object({ title: z.string().min(1), rationale: z.string().min(1), authority_class: Authority, evidence_refs: Evidence, budget_usd: z.number().min(0).optional() }).strict(),
  finding_list: z.object({ items: z.array(finding) }).strict(),
  /** mesma forma de `Minutes` em `store.ts` */
  minutes: z.object({ summary: z.string().min(1), blockers: z.array(z.string()), evidence_refs: z.array(Ref), outputs: z.array(z.string()), notes: z.array(z.string()) }).strict(),
  metric_report: z.object({ items: z.array(metric).min(1) }).strict(),
} as const;
export type ArtifactKind = keyof typeof ARTIFACT_SCHEMAS;

/** Rótulo de `outputs` do registro de rituais → tipo de artefato. Rótulo novo no registro sem tipo aqui = falha do validador. */
export const OUTPUT_LABEL_KIND: Record<string, ArtifactKind> = {
  'pauta priorizada': 'priority_list',
  'tarefas': 'task_list',
  'bloqueios': 'blocker_list',
  'daily brief': 'status_report',
  'decisões': 'decision_list',
  'status': 'status_report',
  'escalonamentos': 'blocker_list',
  'prioridade aprovada': 'priority_list',
  'dependências': 'dependency_list',
  'impedimentos': 'blocker_list',
  'calendário': 'calendar',
  'pautas': 'priority_list',
  'hipóteses': 'hypothesis_list',
  'OKRs': 'plan',
  'alocação proposta': 'proposal',
  'experimentos': 'plan',
  'aprendizados': 'finding_list',
  'recomendações de routing': 'proposal',
  'riscos': 'finding_list',
  'orçamento proposto': 'proposal',
  'achados': 'finding_list',
  'ações corretivas': 'task_list',
  'plano de enriquecimento': 'plan',
  'casos inconclusivos': 'finding_list',
  'ata': 'minutes',
  'decisões sujeitas a aprovação humana': 'decision_list',
  'plano mensal': 'plan',
  'evals': 'metric_report',
  'proposta de promoção ou rollback': 'proposal',
  'forecast': 'metric_report',
  'propostas': 'proposal',
  'ações': 'task_list',
  'contenção': 'plan',
  'decisão': 'decision_list',
  'responsáveis': 'task_list',
};

// --- (1) entrada por família de ritual -----------------------------------------------------------------------------------

const withPayload = <T extends z.ZodTypeAny>(payload: T) => ParticipantInputSchema.extend({ payload }).strict();

export const RITUAL_FAMILIES = ['newsroom_daily', 'directorate_daily', 'sync', 'weekly', 'monthly', 'event'] as const;
export type RitualFamily = (typeof RITUAL_FAMILIES)[number];

/** Insumo estruturado de um participante: a base `ParticipantInput` do agendador (resumo, bloqueios, evidências, decisões) mais um `payload` da família. */
export const RITUAL_INPUT_SCHEMAS = {
  newsroom_daily: withPayload(z.object({ candidates: z.array(z.object({ topic: z.string().min(1), source_ref: Ref, evidence_refs: Evidence })).max(50) }).strict()),
  directorate_daily: withPayload(z.object({ status: z.string().min(1), kpi_observations: z.array(z.object({ kpi: z.string().min(1), value: z.number() })), escalations: z.array(z.string()) }).strict()),
  sync: withPayload(z.object({ priorities: z.array(z.string()), dependencies: z.array(z.object({ on: z.string().min(1), state: z.enum(['ok', 'blocked']) })) }).strict()),
  weekly: withPayload(z.object({ topics: z.array(z.object({ subject: z.string().min(1), evidence_refs: Evidence })).max(50) }).strict()),
  monthly: withPayload(z.object({ assessment: z.string().min(1), metrics: z.array(z.object({ metric: z.string().min(1), value: z.number(), period: z.string().min(1) })) }).strict()),
  event: withPayload(z.object({ containment_proposals: z.array(z.string()) }).strict()),
} as const;

/** Gatilho do ritual por evento (`X-incident`): o registro traz só o texto "incident / breaking / dependency". */
export const EVENT_TRIGGER_SCHEMA = z.object({ kind: z.enum(['incident', 'breaking', 'dependency']), ref: Ref, raised_at: z.string().min(1), severity: z.enum(['low', 'medium', 'high']).optional() }).strict();

export function ritualFamily(id: string, cycle: 'weekday' | 'weekly' | 'monthly' | 'event'): RitualFamily {
  if (cycle === 'event') return 'event';
  if (cycle === 'weekly') return 'weekly';
  if (cycle === 'monthly') return 'monthly';
  if (id === 'D-sync') return 'sync';
  return id === 'D-editorial' || ['D-creative', 'D-growth', 'D-intelligence', 'D-commercial', 'D-technology', 'D-trust'].includes(id) ? 'directorate_daily' : 'newsroom_daily';
}

// --- (3) evidência por etapa -----------------------------------------------------------------------------------------------

export const STAGE_EVIDENCE_KINDS = ['agent_output', 'deterministic_step', 'gate_verdict'] as const;
export type StageEvidenceKind = (typeof STAGE_EVIDENCE_KINDS)[number];

const BaseEvidence = z.object({
  workflow_id: z.string().regex(/^WF\d{2}$/),
  run_id: Ref,
  step: Ref,
  /** hash do insumo e do resultado da etapa (nada de conteúdo, só hashes) */
  input_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  output_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  evidence_refs: Evidence,
  at: z.string().min(1),
});

/** Registro de evidência de uma etapa; falha fechada: sem referência, hash ou (no gate) veredito, a etapa não conta. */
export const STAGE_EVIDENCE_SCHEMAS = {
  agent_output: BaseEvidence.extend({ actor: IdSchema, declared_model: Ref, output_contract_valid: z.literal(true) }).strict(),
  deterministic_step: BaseEvidence.extend({ actor: z.literal('deterministic'), idempotency_key: Ref }).strict(),
  gate_verdict: BaseEvidence.extend({ actor: z.literal('deterministic'), verdict: z.enum(['pass', 'fail']), blockers: z.array(z.string()) }).strict().refine((g) => (g.verdict === 'pass' ? g.blockers.length === 0 : g.blockers.length > 0), 'pass exige 0 bloqueios; fail exige pelo menos 1'),
} as const;

// --- (4) gates explícitos propostos -------------------------------------------------------------------------------------------

export interface ProposedGate {
  id: string;
  /** o gate entra DEPOIS desta etapa (token do registro) */
  after: string;
  /** subconjunto dos bloqueios do registro que ele cobre */
  blockers: string[];
}

/** Workflows sem `auto_gate_*` no registro protegido; os gates abaixo são PROPOSTA da frente (ratificar com o Chief Architect). */
export const PROPOSED_GATES: Record<string, ProposedGate> = {
  WF01: { id: 'auto_gate_triage', after: 'editor_{editoria}', blockers: ['duplicate', 'rights_unknown'] },
  WF03: { id: 'auto_gate_publish', after: 'validate_revision', blockers: ['stale_approval', 'embargo'] },
  WF09: { id: 'auto_gate_metrics', after: 'aggregate', blockers: ['stale_data', 'provider_unavailable'] },
  WF14: { id: 'auto_gate_alert', after: 'consent_check', blockers: ['unverified_event', 'optout'] },
  WF16: { id: 'auto_gate_actions', after: 'verify_evidence', blockers: ['missing_owner', 'overdue', 'unverified_completion'] },
};
