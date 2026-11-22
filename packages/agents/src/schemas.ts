/**
 * Schemas (zod) da organização agêntica.
 *
 * OWNERSHIP: contratos compartilhados pertencem a `@ln/contracts` (Chief Architect): `AgentProfile`,
 * `Workflow`, `Ritual`, `EDITORIAS` e as flags vêm de lá e são aplicados em `config.ts`
 * (`parseRegistries`). Os schemas deste arquivo são MAIS ESTRITOS (strict, enums de ferramentas,
 * formato de horário) e cobrem campos que o contrato frouxo (`looseObject`) não cobre; não
 * duplicam nem substituem os do arquiteto. Persistência e insumos de ritual são específicos desta frente.
 */
import { EDITORIAS as CONTRACT_EDITORIAS, EditoriaSlug } from '@ln/contracts';
import { z } from 'zod';

export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id deve ser snake_case minúsculo');

export const ROUTES = [
  'deterministic',
  'economy',
  'review',
  'premium',
  'strategic',
  'image_fast',
  'image_premium',
] as const;
export const RouteSchema = z.enum(ROUTES);
export type Route = z.infer<typeof RouteSchema>;

/** As 10 editorias vêm de `@ln/contracts` (fonte única; Chief Architect). */
export const EDITORIAS = CONTRACT_EDITORIAS.map((e) => e.slug) as unknown as readonly [
  (typeof CONTRACT_EDITORIAS)[number]['slug'],
  ...(typeof CONTRACT_EDITORIAS)[number]['slug'][],
];
export const EditoriaSchema = EditoriaSlug;
export type Editoria = z.infer<typeof EditoriaSchema>;

export const DEPARTMENTS = [
  'executivo',
  'editorial',
  'creative',
  'growth',
  'intelligence',
  'commercial',
  'technology',
  'trust',
] as const;
export const DepartmentSchema = z.enum(DEPARTMENTS);
export type Department = z.infer<typeof DepartmentSchema>;

/** As 7 diretorias (departamentos com diretor; `executivo` é o Publisher/CEO). */
export const DIRECTORATES = DEPARTMENTS.filter((d) => d !== 'executivo');
export type Directorate = Exclude<Department, 'executivo'>;

export const ToolSchema = z.enum([
  'read_evidence',
  'review',
  'draft',
  'assign',
  'read_metrics',
  'propose_policy',
  'read_approved',
  'execute_scoped',
]);

/** Subconjunto estrito do JSON Schema usado pelos contratos de saída dos perfis. */
export const OutputContractSchema = z
  .object({
    type: z.literal('object'),
    required: z.array(z.string()).min(1),
    additionalProperties: z.literal(false),
    properties: z
      .object({
        agent_id: z.object({ const: IdSchema }).strict(),
        artifact_type: z.object({ const: z.string() }).strict(),
        result: z
          .object({
            type: z.literal('object'),
            additionalProperties: z.literal(false),
            required: z.array(z.string()).min(1),
            properties: z.record(z.string(), z.unknown()),
          })
          .strict(),
      })
      .passthrough(),
  })
  .passthrough();

export const AgentProfileSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    department: DepartmentSchema,
    reports_to: IdSchema.nullable(),
    mission: z.string().min(1),
    allowed_tools: z.array(ToolSchema).min(1),
    kpi: z.string().min(1),
    scope: z.union([EditoriaSchema, z.literal('internal')]),
    enabled: z.boolean(),
    tools_policy: z.string().min(1),
    output_contract: OutputContractSchema,
    activation: z.string(),
    default_route_hint: RouteSchema,
    routing: z.string(),
    required_result_fields: z.array(z.string()).min(1),
  })
  .strict();
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const AgentsRegistrySchema = z
  .object({
    schema_version: z.literal('2.1'),
    format: z.string(),
    agents: z.array(AgentProfileSchema),
  })
  .strict();
export type AgentsRegistry = z.infer<typeof AgentsRegistrySchema>;

export const WorkflowSchema = z
  .object({
    id: z.string().regex(/^WF\d{2}$/),
    name: z.string().min(1),
    trigger: z.string().min(1),
    owner: IdSchema,
    steps: z.string().min(1),
    output: z.string().min(1),
    blockers: z.array(z.string()).min(1),
    enabled: z.boolean(),
    policy: z.string().optional(),
    provider: z.string().optional(),
    instagram_enabled: z.boolean().optional(),
    channel_enabled: z.boolean().optional(),
  })
  .strict();
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowsRegistrySchema = z
  .object({ format: z.string(), workflows: z.array(WorkflowSchema) })
  .strict();

export const MEETING_CYCLES = ['weekday', 'weekly', 'monthly', 'event'] as const;
export const MeetingCycleSchema = z.enum(MEETING_CYCLES);
export type MeetingCycle = z.infer<typeof MeetingCycleSchema>;

export const MeetingSchema = z
  .object({
    id: z.string().regex(/^[DWMX]-[a-z]+$/),
    title: z.string().min(1),
    cycle: MeetingCycleSchema,
    timezone: z.literal('America/Sao_Paulo'),
    /** "HH:MM" | "MON HH:MM" | "FIRST_BUSINESS_DAY HH:MM" | texto livre p/ evento */
    schedule_local: z.string().min(1),
    chair: IdSchema,
    participants: z.array(IdSchema).min(1),
    purpose: z.string(),
    outputs: z.array(z.string()).min(1),
    route: RouteSchema,
    max_cost_usd_example: z.number().nullable(),
    enabled: z.boolean(),
    mode: z.literal('async_structured_first'),
    quorum: z.object({ minimum: z.number().int().min(1), chair_required: z.boolean() }).strict(),
    max_rounds: z.number().int().min(1),
    holiday_calendar: z.string(),
    silence_rule: z.string(),
    authority: z.string(),
    activate_after: z.string(),
    workflow: z.string().regex(/^WF\d{2}$/).optional(),
    depends_on: z.array(z.string()).optional(),
  })
  .strict();
export type Meeting = z.infer<typeof MeetingSchema>;

export const RecoveryPolicySchema = z
  .object({
    decision: z.string(),
    window_minutes: z.number().int().positive(),
    window_inclusive: z.boolean(),
    timezone: z.literal('America/Sao_Paulo'),
    same_business_day: z.boolean(),
    late_outcome: z.string(),
    idempotency_key: z.string(),
    holiday: z.string(),
    dependencies: z.object({ 'D-sync': z.array(z.string()), rule: z.string(), consistency: z.string().optional() }).passthrough(),
    boundary_tests: z.array(z.string()),
    rescheduling: z
      .object({ holiday_move: z.string(), collision: z.string(), supersession: z.string() })
      .strict(),
  })
  .strict();
export type RecoveryPolicy = z.infer<typeof RecoveryPolicySchema>;

export const MeetingsRegistrySchema = z
  .object({
    version: z.string(),
    format: z.string(),
    recovery_policy: RecoveryPolicySchema,
    meetings: z.array(MeetingSchema),
  })
  .strict();
export type MeetingsRegistry = z.infer<typeof MeetingsRegistrySchema>;

// ---------------------------------------------------------------------------
// Organização derivada (diretorias, redações, interações)
// ---------------------------------------------------------------------------

export const DirectorateConfigSchema = z
  .object({
    id: z.string(),
    department: z.enum(['editorial', 'creative', 'growth', 'intelligence', 'commercial', 'technology', 'trust']),
    director: IdSchema,
    members: z.array(IdSchema),
    reports_to: z.literal('publisher'),
    daily_meeting: z.string().nullable(),
    weekly_meeting: z.string().nullable(),
  })
  .strict();
export type DirectorateConfig = z.infer<typeof DirectorateConfigSchema>;

export const NewsroomInteractionSchema = z
  .object({
    directorate: z.string(),
    agents: z.array(IdSchema),
    workflows: z.array(z.string()),
    nature: z.string(),
  })
  .strict();

export const NewsroomConfigSchema = z
  .object({
    editoria: EditoriaSchema,
    name: z.string(),
    editor: IdSchema,
    writer: IdSchema,
    director: IdSchema,
    daily_meeting: z.string(),
    /** chave da memória setorial no PostgreSQL (tabela sector_memory.editoria) */
    memory_scope: EditoriaSchema,
    interactions: z.array(NewsroomInteractionSchema).min(1),
  })
  .strict();
export type NewsroomConfig = z.infer<typeof NewsroomConfigSchema>;

// ---------------------------------------------------------------------------
// Persistência de rituais (atas, decisões, tarefas)
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ['completed', 'status_only', 'waiting'] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const STATUS_REASONS = [
  'no_inputs_or_decisions', // regra do silêncio
  'quorum_not_met',
  'recovery_window_expired', // host desligado além de +120 min
  'host_off_previous_day', // dia anterior não executado
] as const;
export const StatusReasonSchema = z.enum(STATUS_REASONS);
export type StatusReason = z.infer<typeof StatusReasonSchema>;

export const DecisionInputSchema = z
  .object({
    text: z.string().min(1),
    proposed_by: IdSchema,
    /**
     * Alçada da decisão (D01): `automatic` (aprovada dentro da política e do orçamento), `protected`
     * (decisão protegida de governança: vai ao verificador, sem aprovação humana de rotina) e
     * `owner_reserved` (ato reservado ao responsável: legal ou contratual; aguarda o humano).
     */
    authority_class: z.enum(['automatic', 'protected', 'owner_reserved']).default('automatic'),
    evidence_refs: z.array(z.string()).default([]),
    actions: z
      .array(
        z.object({
          title: z.string().min(1),
          owner: IdSchema,
          /** prazo em dias úteis a partir da data local do ritual (padrão 1) */
          due_in_business_days: z.number().int().min(0).max(60).default(1),
        }),
      )
      .default([]),
  })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

/** Insumo estruturado de um participante (async_structured_first). */
export const ParticipantInputSchema = z
  .object({
    agent_id: IdSchema,
    summary: z.string(),
    blockers: z.array(z.string()).default([]),
    evidence_refs: z.array(z.string()).default([]),
    decisions: z.array(DecisionInputSchema).default([]),
  })
  .strict();
export type ParticipantInput = z.infer<typeof ParticipantInputSchema>;
