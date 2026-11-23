/**
 * ESQUEMAS do catálogo (Frente 07), RATIFICADOS COM AJUSTES pelo Chief Architect (`fast-track/decisoes/ratificacao-G-P1-catalogo.md`):
 * (1) o formato da ENTRADA de cada ritual (insumo estruturado do participante, por família de ritual);
 * (2) o esquema de cada SAÍDA (artefato) dos 28 rituais, por rótulo de `outputs`;
 * (3) o esquema de EVIDÊNCIA por etapa de workflow;
 * (4) os GATES explícitos dos workflows que o registro deixa sem `auto_gate_*`.
 * Tudo é dado e validação; nada roda. Os contratos protegidos (`contracts/*.registry.json`) NÃO foram alterados: os gates valem como
 * contrato de código (`PROPOSED_GATES`) até o ato raiz que os formalize no registro.
 */
import { z } from 'zod';
import { IdSchema, ParticipantInputSchema } from './schemas';

const Ref = z.string().min(1);
const Evidence = z.array(Ref).min(1);
const Authority = z.enum(['automatic', 'protected', 'owner_reserved']);

/** Data ISO 8601 COM fuso (Z ou ±hh:mm), validada: string livre não passa. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const IsoWithZone = z.string().refine((s) => ISO_WITH_ZONE.test(s) && !Number.isNaN(Date.parse(s)), 'data ISO 8601 com fuso (ex.: 2026-11-24T08:00:00-03:00)');

/**
 * Número sempre com origem (regra do projeto: sem dado é "— / não disponível", nunca zero falso): `source_ref` obrigatório, e o valor
 * pode ser `null` somente com `unavailable_reason`; um valor numérico não traz motivo de indisponibilidade.
 */
const sourcedValue = <S extends z.ZodRawShape>(shape: S) =>
  z.object({ ...shape, value: z.number().nullable(), source_ref: Ref, unavailable_reason: z.string().min(1).optional() }).strict().superRefine((raw, ctx) => {
    const m = raw as { value: number | null; unavailable_reason?: string };
    if (m.value === null && !m.unavailable_reason) ctx.addIssue({ code: 'custom', message: 'value null exige unavailable_reason (nunca zero falso)', path: ['unavailable_reason'] });
    if (m.value !== null && m.unavailable_reason) ctx.addIssue({ code: 'custom', message: 'unavailable_reason só vale com value null', path: ['unavailable_reason'] });
  });

// --- (2) artefatos de saída -----------------------------------------------------------------------------------------------

const priority = z.object({ rank: z.number().int().min(1), subject: z.string().min(1), rationale: z.string().min(1), evidence_refs: Evidence }).strict();
const task = z.object({ title: z.string().min(1), owner: IdSchema, due_in_business_days: z.number().int().min(0).max(60), evidence_refs: Evidence, risk: z.enum(['low', 'medium', 'high']), authority_class: Authority }).strict();
const blocker = z.object({ description: z.string().min(1), owner: IdSchema, evidence_refs: Evidence, escalate_to: IdSchema.optional() }).strict();
/** `owner_reserved` só vale para os atos que continuam do responsável (D01) e NUNCA executa sozinho. */
const decision = z.object({ text: z.string().min(1), proposed_by: IdSchema, authority_class: Authority, executes_alone: z.boolean(), evidence_refs: Evidence }).strict()
  .refine((d) => d.authority_class !== 'owner_reserved' || d.executes_alone === false, { message: 'decisão owner_reserved nunca executa sozinha (D01)', path: ['executes_alone'] });
const dependency = z.object({ from: IdSchema, to: z.string().min(1), state: z.enum(['ok', 'blocked']), evidence_refs: Evidence }).strict();
const calendarItem = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), subject: z.string().min(1), owner: IdSchema }).strict();
const hypothesis = z.object({ statement: z.string().min(1), test: z.string().min(1), evidence_refs: Evidence }).strict();
const planItem = z.object({ subject: z.string().min(1), owner: IdSchema, due_in_business_days: z.number().int().min(0).max(366), evidence_refs: Evidence }).strict();
const finding = z.object({ subject: z.string().min(1), severity: z.enum(['low', 'medium', 'high']), evidence_refs: Evidence, recommended_action: z.string().optional() }).strict();
const metric = sourcedValue({ metric: z.string().min(1), period: z.string().min(1) });
/** `budget_usd` é só proposta: não reserva nem gasta (ADR-015); qualquer gasto passa pelo BalanceGuard e pelo ledger. */
const proposal = z.object({ title: z.string().min(1), rationale: z.string().min(1), authority_class: Authority, evidence_refs: Evidence, budget_usd: z.number().min(0).optional(), reserves_budget: z.literal(false) }).strict();

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
  proposal,
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
  /** KPI sempre com origem; valor `null` só com `unavailable_reason` */
  directorate_daily: withPayload(z.object({ status: z.string().min(1), kpi_observations: z.array(sourcedValue({ kpi: z.string().min(1) })).max(50), escalations: z.array(z.string()) }).strict()),
  sync: withPayload(z.object({ priorities: z.array(z.string()), dependencies: z.array(z.object({ on: z.string().min(1), state: z.enum(['ok', 'blocked']) })) }).strict()),
  weekly: withPayload(z.object({ topics: z.array(z.object({ subject: z.string().min(1), evidence_refs: Evidence })).max(50) }).strict()),
  monthly: withPayload(z.object({ assessment: z.string().min(1), metrics: z.array(sourcedValue({ metric: z.string().min(1), period: z.string().min(1) })).max(50) }).strict()),
  /** cada proposta de contenção traz o texto e as evidências, como nas outras famílias */
  event: withPayload(z.object({ containment_proposals: z.array(z.object({ text: z.string().min(1), evidence_refs: Evidence })).max(50) }).strict()),
} as const;

/**
 * Gatilho do ritual por evento (`X-incident`): `raised_at` em ISO com fuso; `severity` obrigatória no `incident`.
 * A idempotência do gatilho é `kind + ref` (`eventTriggerKey`): o mesmo incidente não abre dois rituais.
 */
export const EVENT_TRIGGER_SCHEMA = z.object({ kind: z.enum(['incident', 'breaking', 'dependency']), ref: Ref, raised_at: IsoWithZone, severity: z.enum(['low', 'medium', 'high']).optional() }).strict()
  .refine((t) => t.kind !== 'incident' || t.severity !== undefined, { message: 'incident exige severity', path: ['severity'] });
export type EventTrigger = z.infer<typeof EVENT_TRIGGER_SCHEMA>;

export const eventTriggerKey = (t: Pick<EventTrigger, 'kind' | 'ref'>): string => `${t.kind}+${t.ref}`;

/** `breaking` decide contenção e prioridade e NÃO dispensa os gates editoriais: a publicação continua por WF02 e WF03. */
export const EVENT_KIND_RULES = {
  incident: { decides: ['containment', 'priority'], bypasses_editorial_gates: false },
  breaking: { decides: ['containment', 'priority'], bypasses_editorial_gates: false, still_requires: ['WF02', 'WF03'] },
  dependency: { decides: ['containment', 'priority'], bypasses_editorial_gates: false },
} as const;

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
  at: IsoWithZone,
});

/** Registro de evidência de uma etapa; falha fechada: sem referência, hash, provedor, custo ou (no gate) veredito coerente, a etapa não conta. */
export const STAGE_EVIDENCE_SCHEMAS = {
  /** provider e account permitem verificar a independência por etapa e a DP-41; `cost_ref` concilia a evidência com o gasto (openbot_cost_entries ou ledger do gateway) */
  agent_output: BaseEvidence.extend({ actor: IdSchema, declared_model: Ref, provider: z.enum(['anthropic', 'openai']), account: z.enum(['claude', 'codex']), cost_ref: Ref, output_contract_valid: z.literal(true) }).strict()
    .refine((e) => (e.account === 'claude') === (e.provider === 'anthropic'), { message: 'conta e provedor incoerentes (claude↔anthropic, codex↔openai)', path: ['provider'] }),
  deterministic_step: BaseEvidence.extend({ actor: z.literal('deterministic'), idempotency_key: Ref }).strict(),
  /** `blockers` tem de ser subconjunto dos bloqueios do registro para o workflow (`validateStageEvidence`) */
  gate_verdict: BaseEvidence.extend({ actor: z.literal('deterministic'), verdict: z.enum(['pass', 'fail']), blockers: z.array(z.string()) }).strict()
    .refine((g) => (g.verdict === 'pass' ? g.blockers.length === 0 : g.blockers.length > 0), 'pass exige 0 bloqueios; fail exige pelo menos 1'),
} as const;

// --- (4) gates explícitos propostos (ratificados com ajustes) ----------------------------------------------------------------

export interface ProposedGate {
  id: string;
  /** o gate entra DEPOIS desta etapa (token do registro) */
  after: string;
  /** bloqueios DUROS do registro: o gate falha (`fail`) se algum ocorrer */
  blockers: string[];
  /** bloqueios do registro que NÃO param nada: o item sai como "não disponível", com o motivo (nunca zero falso) */
  soft?: Record<string, 'mark_unavailable'>;
  /** bloqueios do registro que viram desvio para uma etapa do workflow, em vez de parada */
  routes?: Record<string, string>;
  /** condições em que o gate falha mesmo com bloqueios brandos, cada uma ligada a um bloqueio do registro (o `verdict` só cita bloqueios do registro) */
  fail_conditions?: { id: string; blocker: string }[];
  /** etapas que NUNCA passam por este gate (têm de vir depois dele) */
  never_gated?: string[];
}

/** Workflows sem `auto_gate_*` no registro protegido; valem como contrato de código até o ato raiz que os formalize. */
export const PROPOSED_GATES: Record<string, ProposedGate> = {
  WF01: { id: 'auto_gate_triage', after: 'editor_{editoria}', blockers: ['duplicate', 'rights_unknown'] },
  /** a despublicação (`unpublish_if_failed`) é determinística e nunca passa por este gate nem pelo teto (ADR-015) */
  WF03: { id: 'auto_gate_publish', after: 'validate_revision', blockers: ['stale_approval', 'embargo'], never_gated: ['unpublish_if_failed'] },
  /** métrica velha ou sem provedor sai "não disponível" sem bloquear o snapshot; o gate falha só com valor velho apresentado como atual ou sem nenhuma métrica válida */
  WF09: {
    id: 'auto_gate_metrics', after: 'aggregate', blockers: [],
    soft: { stale_data: 'mark_unavailable', provider_unavailable: 'mark_unavailable' },
    fail_conditions: [{ id: 'stale_value_presented_as_current', blocker: 'stale_data' }, { id: 'no_valid_metric', blocker: 'provider_unavailable' }],
  },
  WF14: { id: 'auto_gate_alert', after: 'consent_check', blockers: ['unverified_event', 'optout'] },
  /** `overdue` não é parada: é desvio para `escalate_overdue`; os bloqueios duros são `missing_owner` e `unverified_completion` */
  WF16: { id: 'auto_gate_actions', after: 'verify_evidence', blockers: ['missing_owner', 'unverified_completion'], routes: { overdue: 'escalate_overdue' } },
};
