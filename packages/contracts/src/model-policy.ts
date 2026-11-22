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

export const ModelPolicy = z
  .looseObject({
    version: z.string().min(1),
    currency: z.literal('USD'),
    models: z.array(ModelEntry).min(1),
    routes: z.record(z.string(), z.array(z.string())),
    rules: PolicyRules,
    data_classes: z.looseObject({ public: z.array(ModelProvider) }),
    routing_by_task: z.record(z.string(), z.string()),
  })
  .superRefine((p, ctx) => {
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
