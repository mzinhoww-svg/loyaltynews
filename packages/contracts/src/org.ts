import { z } from 'zod';
import { Id, IsoDate, TIMEZONE } from './common';

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

/** Decisão de ata: gera tarefa idempotente com responsável, prazo, evidência, risco e alçada. */
export const Decision = z.object({
  id: Id,
  meetingId: Id,
  texto: z.string().min(1),
  responsavel: z.string().min(1),
  prazo: IsoDate,
  evidenciaExigida: z.string().min(1),
  risco: z.enum(['baixo', 'medio', 'alto']),
  /** Decisão protegida vai ao verificador; nunca é aprovada pelo próprio ritual. */
  alcada: z.enum(['automatica', 'protegida']),
  idempotencyKey: z.string().min(8),
});
export type Decision = z.infer<typeof Decision>;

export const Meeting = z.object({
  id: Id,
  ritualId: z.string().min(1),
  data: IsoDate,
  status: z.enum(['agendada', 'realizada', 'somente_status', 'cancelada']),
  quorumAtingido: z.boolean(),
  rodadas: z.number().int().min(0).max(2),
  decisoes: z.array(Decision).default([]),
});
export type Meeting = z.infer<typeof Meeting>;
