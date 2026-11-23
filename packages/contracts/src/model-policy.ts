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
 * `model_qualification`, classe `public`, sem fallback, teto próprio (até US$ 5) e sem a reserva de auditoria. ZDR por
 * chamada: obrigatório na v6 (DP-26 a), preferência na v7 (DP-27). NÃO é produção: exige `production_enabled=false`.
 * Ligar (`enabled=true`) é mudança protegida.
 */
export const QualificationMode = z.looseObject({
  name: z.literal('qualification'),
  enabled: z.boolean(),
  requires_production_enabled: z.literal(false),
  task: z.literal('model_qualification'),
  data_class: z.literal('public'),
  candidates: z.array(z.string().min(1)).min(1),
  excluded: z.array(z.string().min(1)).default([]),
  provider_zdr_per_call: z.boolean(),
  allow_fallbacks: z.literal(false),
  /** v6: teto único (até US$ 5). */
  cap_usd: z.number().positive().max(5).optional(),
  /** v7 (decisão do PM, T10): teto POR ETAPA — etapa 1 US$ 5, etapa 2 US$ 10; nenhuma etapa acima de 10. */
  stage_caps_usd: z.partialRecord(z.enum(['1', '2']), z.number().positive()).optional(),
  uses_audit_reserve: z.literal(false),
  /** T11: rotulagem do golden set sai da verba OpenAI (allocation), nunca da reserva de auditoria. */
  golden_set_labeling_budget: z.literal('openai_allocation').optional(),
}).refine((m) => m.cap_usd !== undefined || (m.stage_caps_usd !== undefined && Object.keys(m.stage_caps_usd).length > 0), {
  message: 'modo de qualificação precisa de teto (cap_usd ou stage_caps_usd)',
  path: ['cap_usd'],
});
export type QualificationMode = z.infer<typeof QualificationMode>;

/**
 * Privacidade de produção. v6 (DP-26 a): ZDR listado + política do OpenRouter arquivada, ambos exigidos. v7 (DP-27): ZDR
 * não exigido (retenção aceita pelo proprietário); a referência arquivada fica, sem bloquear. Quando
 * `openrouter_data_policy_archived_required` é true, produção sem a referência é recusada.
 */
export const PrivacyRules = z.looseObject({
  unpublished_requires_listed_zdr: z.boolean(),
  provider_zdr_per_call: z.boolean(),
  openrouter_data_policy_archived_required: z.boolean(),
  openrouter_data_policy_ref: z.string().min(1).nullable(),
});

/**
 * Canais de execução (v7, DP-27): principal = agentes do OpenBot nas assinaturas (fora do teto), complemento = API
 * tarifada (OpenRouter) dentro do teto de US$ 50. O complemento usa as rotas da política; nunca muda o teto.
 */
export const ExecutionChannels = z.looseObject({
  primary: z.looseObject({
    channel: z.literal('openbot_subscription'),
    outside_monthly_cap: z.literal(true),
    /** Conta e provedor por tarefa (estruturado): o autor distinto da checagem é verificável no contrato. */
    by_task: z.record(
      z.string(),
      z.looseObject({ account: z.enum(['claude', 'codex']), provider: z.enum(['anthropic', 'openai']), note: z.string().optional() }),
    ),
    evidence_required: z.array(z.string().min(1)).min(1),
  }),
  complement: z.looseObject({
    channel: z.literal('openrouter_metered'),
    inside_monthly_cap_usd: z.number().positive(),
  }),
  never: z.array(z.string().min(1)).min(1),
});
export type ExecutionChannels = z.infer<typeof ExecutionChannels>;

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
    execution: ExecutionChannels.optional(),
  })
  .superRefine((p, ctx) => {
    const mode = p.qualification?.mode;
    if (mode) {
      // T10 (decisão do PM): etapa 1 até US$ 5, etapa 2 até US$ 10. Política v7 (com `execution`) exige teto por etapa.
      const TETO_DA_ETAPA = { '1': 5, '2': 10 } as const;
      for (const [etapa, v] of Object.entries(mode.stage_caps_usd ?? {}))
        if (v > TETO_DA_ETAPA[etapa as '1' | '2'])
          ctx.addIssue({ code: 'custom', message: `etapa ${etapa} acima de US$ ${TETO_DA_ETAPA[etapa as '1' | '2']}`, path: ['qualification', 'mode', 'stage_caps_usd', etapa] });
      if (p.execution && !mode.stage_caps_usd)
        ctx.addIssue({ code: 'custom', message: 'política v7 exige teto por etapa (stage_caps_usd), não só o teto único', path: ['qualification', 'mode', 'stage_caps_usd'] });
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
    if (priv && priv.openrouter_data_policy_archived_required && p.rules.production_enabled && !priv.openrouter_data_policy_ref)
      ctx.addIssue({ code: 'custom', message: 'produção exige a política de dados do OpenRouter arquivada (DP-26 a)', path: ['rules', 'privacy'] });
    if (priv && priv.unpublished_requires_listed_zdr && !priv.provider_zdr_per_call)
      ctx.addIssue({ code: 'custom', message: 'ZDR exigido no não publicado precisa de provider.zdr por chamada', path: ['rules', 'privacy'] });
    const ex = p.execution;
    if (ex && ex.complement.inside_monthly_cap_usd > p.rules.hard_monthly_budget_usd)
      ctx.addIssue({ code: 'custom', message: 'complemento acima do teto mensal', path: ['execution', 'complement'] });
    if (ex) {
      const bt = ex.primary.by_task;
      const PROVEDOR_DA_CONTA = { claude: 'anthropic', codex: 'openai' } as const;
      for (const [k, t] of Object.entries(bt)) {
        if (PROVEDOR_DA_CONTA[t.account] !== t.provider)
          ctx.addIssue({ code: 'custom', message: `${k}: conta ${t.account} não é do provedor ${t.provider}`, path: ['execution', 'primary', 'by_task', k] });
      }
      const draft = bt.editorial_draft;
      if (!draft || !bt.fact_check)
        ctx.addIssue({ code: 'custom', message: 'canal principal precisa de redação e checagem definidas', path: ['execution', 'primary', 'by_task'] });
      else {
        for (const k of ['fact_check', 'editorial_review'] as const) {
          const t = bt[k];
          if (t && (t.provider === draft.provider || t.account === draft.account))
            ctx.addIssue({ code: 'custom', message: `${k} do mesmo provedor da redação (autor distinto obrigatório)`, path: ['execution', 'primary', 'by_task', k] });
        }
      }
    }
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
