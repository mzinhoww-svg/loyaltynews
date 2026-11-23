import { z } from 'zod';

/**
 * Schema da política de modelos (`contracts/model.policy.json`). Aceita o original 2.1 e as propostas
 * DP-02 v3–v5 (campos novos opcionais; demais campos preservados com `loose`). Pedido da Frente 11.
 * Chamada real de modelo só com `rules.production_enabled === true` E a flag `modelosHabilitados` ligada.
 */
export const ModelProvider = z.enum(['anthropic', 'openai', 'deepseek']);

const PricePerMtok = z.number().nonnegative().nullable();

export const ModelEntry = z.looseObject({
  id: z.string().min(1),
  provider: ModelProvider,
  capabilities: z.array(z.string()).min(1),
  input_peak: PricePerMtok,
  output_peak: PricePerMtok,
  candidate_only: z.boolean().optional(),
  allowed_tasks: z.array(z.string()).optional(),
  budget_allocation_usd: z.number().nonnegative().optional(),
  binding: z
    .looseObject({
      openrouter_id: z.string().min(1).optional(),
      price_usd_per_mtok: z.looseObject({ input: PricePerMtok, output: PricePerMtok }).optional(),
    })
    .optional(),
});
export type ModelEntry = z.infer<typeof ModelEntry>;

export const PolicyRules = z.looseObject({
  production_enabled: z.boolean(),
  block_unknown_cost: z.literal(true),
  hard_monthly_budget_usd: z.literal(50),
  monthly_cap_immutable_by_agents: z.literal(true),
  refill_does_not_increment_monthly_cap: z.literal(true),
  cross_provider_independent_review: z.literal(true),
  prompt_cache_required: z.literal(true),
  budget_allocation_usd: z.record(z.string(), z.number().nonnegative()).optional(),
});
export type PolicyRules = z.infer<typeof PolicyRules>;

/**
 * Modo de qualificação no gateway (T6 do protocolo de qualificação; ADR-021). Só os candidatos do protocolo, tarefa
 * `model_qualification`, classe `public`, ZDR por chamada, sem fallback, teto próprio (até US$ 5) e sem a reserva de
 * auditoria. NÃO é produção: exige `production_enabled=false`. Ligar (`enabled=true`) é mudança protegida.
 */
export const QualificationMode = z.looseObject({
  name: z.literal('qualification'),
  enabled: z.boolean(),
  requires_production_enabled: z.literal(false),
  task: z.literal('model_qualification'),
  data_class: z.literal('public'),
  candidates: z.array(z.string().min(1)).min(1),
  excluded: z.array(z.string().min(1)).default([]),
  provider_zdr_per_call: z.literal(true),
  allow_fallbacks: z.literal(false),
  cap_usd: z.number().positive().max(5),
  uses_audit_reserve: z.literal(false),
});
export type QualificationMode = z.infer<typeof QualificationMode>;

/** Privacidade de produção (DP-26 a): ZDR listado no OpenRouter + política de dados do OpenRouter arquivada. */
export const PrivacyRules = z.looseObject({
  unpublished_requires_listed_zdr: z.literal(true),
  provider_zdr_per_call: z.literal(true),
  openrouter_data_policy_archived_required: z.literal(true),
  openrouter_data_policy_ref: z.string().min(1).nullable(),
});

export const ModelPolicy = z
  .looseObject({
    version: z.string().min(1),
    currency: z.literal('USD'),
    models: z.array(ModelEntry).min(1),
    routes: z.record(z.string(), z.array(z.string())),
    rules: PolicyRules.extend({ privacy: PrivacyRules.optional() }),
    data_classes: z.looseObject({ public: z.array(ModelProvider) }),
    routing_by_task: z.record(z.string(), z.string()),
    qualification: z.looseObject({ mode: QualificationMode.optional() }).optional(),
  })
  .superRefine((p, ctx) => {
    const mode = p.qualification?.mode;
    if (mode) {
      const byId = new Map(p.models.map((m) => [m.id, m]));
      for (const id of mode.candidates) {
        const m = byId.get(id);
        if (!m) ctx.addIssue({ code: 'custom', message: `candidato ${id} inexistente`, path: ['qualification', 'mode', 'candidates'] });
        else if (mode.excluded.includes(id) || (m as { excluded_by?: string }).excluded_by)
          ctx.addIssue({ code: 'custom', message: `candidato ${id} está excluído`, path: ['qualification', 'mode', 'candidates'] });
      }
      if (mode.enabled && p.rules.production_enabled) ctx.addIssue({ code: 'custom', message: 'qualificação só com production_enabled=false', path: ['qualification', 'mode', 'enabled'] });
    }
    const priv = p.rules.privacy;
    if (priv && p.rules.production_enabled && !priv.openrouter_data_policy_ref)
      ctx.addIssue({ code: 'custom', message: 'produção exige a política de dados do OpenRouter arquivada (DP-26 a)', path: ['rules', 'privacy'] });
    const ids = new Set(p.models.map((m) => m.id));
    for (const [route, list] of Object.entries(p.routes)) {
      for (const id of list) {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `rota ${route} cita modelo inexistente ${id}`, path: ['routes', route] });
      }
    }
    const alloc = p.rules.budget_allocation_usd;
    if (alloc) {
      const total = (alloc.openai ?? 0) + (alloc.anthropic ?? 0) + (alloc.images ?? 0) + (alloc.deepseek ?? 0) + (alloc.audit_errata_reserve ?? 0);
      if (total > p.rules.hard_monthly_budget_usd) ctx.addIssue({ code: 'custom', message: 'divisão acima do teto', path: ['rules', 'budget_allocation_usd'] });
    }
  });
export type ModelPolicy = z.infer<typeof ModelPolicy>;

/** Gate de chamada real: política habilitada E flag ligada. Qualquer um desligado bloqueia. */
export function modelCallsAllowed(policy: Pick<ModelPolicy, 'rules'>, flagModelosHabilitados: boolean): boolean {
  return policy.rules.production_enabled === true && flagModelosHabilitados === true;
}

/**
 * Gate do modo de qualificação (ADR-021): modo ligado, produção DESLIGADA, tarefa `model_qualification`, classe `public` e
 * modelo candidato não excluído. O gateway ainda precisa: ZDR por chamada (`provider.zdr`), sem fallback, reserva no pool
 * `qualification` do ledger (ADR-020) dentro de `cap_usd`, kill switch e evidência por chamada.
 */
export function qualificationCallAllowed(
  policy: Pick<ModelPolicy, 'rules' | 'qualification'>,
  req: { model: string; task: string; dataClass: string },
): boolean {
  const m = policy.qualification?.mode;
  return Boolean(
    m && m.enabled === true && policy.rules.production_enabled === false && req.task === m.task && req.dataClass === m.data_class &&
      m.candidates.includes(req.model) && !m.excluded.includes(req.model),
  );
}
